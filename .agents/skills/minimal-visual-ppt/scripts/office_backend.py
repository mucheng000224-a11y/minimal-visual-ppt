"""PowerPoint automation in an isolated process; reports distinguish unavailable from failure.

Writes only a working copy before successful reopen verification. A user's already
open presentation is never closed. Run --help for the JSON-based CLI contract.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import zipfile
import xml.etree.ElementTree as ET


def microsoft_executable():
    """Find the installed Microsoft binary, even when another suite owns the ProgID."""
    import winreg
    candidates = [os.environ.get("MVP_POWERPOINT", "")]
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for access in (winreg.KEY_READ | winreg.KEY_WOW64_64KEY, winreg.KEY_READ | winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\POWERPNT.EXE", 0, access) as key:
                    candidates.append(winreg.QueryValue(key, None).strip('"'))
            except OSError:
                pass
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if base:
            for suffix in ("root/Office16", "Office16", "Office15", "Office14", "Office12"):
                candidates.append(str(Path(base, "Microsoft Office", suffix, "POWERPNT.EXE")))
    return next((str(Path(p).resolve()) for p in candidates if p and Path(p).is_file()), None)


def launch_native_presentation(executable, working):
    """Bind the exact working-file ROT moniker, avoiding a hijacked COM class registration."""
    import pythoncom
    import win32com.client
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    process = subprocess.Popen([executable, str(working)], startupinfo=startup,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    expected = os.path.normcase(str(working.resolve()))
    deadline = time.monotonic() + 45
    last_error = "No presentation moniker was registered"
    while time.monotonic() < deadline:
        pythoncom.PumpWaitingMessages()
        rot, ctx = pythoncom.GetRunningObjectTable(), pythoncom.CreateBindCtx(0)
        enum = rot.EnumRunning()
        while True:
            monikers = enum.Next()
            if not monikers:
                break
            moniker = monikers[0]
            try:
                if os.path.normcase(moniker.GetDisplayName(ctx, None)) != expected:
                    continue
                presentation = win32com.client.Dispatch(rot.GetObject(moniker).QueryInterface(pythoncom.IID_IDispatch))
                application = presentation.Application
                if "kingsoft" in str(application.Path).lower():
                    raise RuntimeError("Working presentation bound to WPS instead of Microsoft PowerPoint")
                # Only the isolated working presentation is hidden; other user documents stay untouched.
                try:
                    for i in range(1, presentation.Windows.Count + 1):
                        presentation.Windows.Item(i).Visible = False
                except Exception:
                    pass
                return application, presentation, process.pid
            except Exception as exc:
                last_error = str(exc)
        time.sleep(.2)
    # Do not terminate an Office process: it may have joined a user's existing instance.
    raise RuntimeError(f"Could not bind Microsoft PowerPoint to the isolated working file: {last_error}; launcher PID {process.pid}")


def application_pid(application):
    try:
        import win32process
        return win32process.GetWindowThreadProcessId(int(application.HWND))[1]
    except Exception:
        return None


def write_report(path, report):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "report": str(path)}, ensure_ascii=False))


def shapes_of(slide):
    return [slide.Shapes.Item(i) for i in range(1, slide.Shapes.Count + 1)]


def effect_snapshot(pres):
    rows = []
    for i in range(1, pres.Slides.Count + 1):
        slide = pres.Slides.Item(i)
        seq = slide.TimeLine.MainSequence
        effects = []
        for j in range(1, seq.Count + 1):
            e = seq.Item(j)
            effects.append({"name": str(e.Shape.Name), "shapeId": int(e.Shape.Id),
                            "effectType": int(e.EffectType), "duration": float(e.Timing.Duration),
                            "trigger": int(e.Timing.TriggerType), "delay": float(e.Timing.TriggerDelayTime),
                            "motionBehaviors": sum(1 for k in range(1, e.Behaviors.Count + 1)
                                                   if e.Behaviors.Item(k).Type == 1)})
        rows.append({"index": i, "effects": effects})
    return rows


def timing_xml(path):
    ns = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main"}
    rows = []
    with zipfile.ZipFile(path) as z:
        names = sorted([n for n in z.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")],
                       key=lambda x: int(Path(x).stem[5:]))
        for name in names:
            root = ET.fromstring(z.read(name))
            rows.append({"slide": name, "hasTiming": root.find("p:timing", ns) is not None,
                         "targetShapeIds": sorted(set(x.get("spid") for x in root.findall(".//p:spTgt", ns))),
                         "motionCount": len(root.findall(".//p:animMotion", ns))})
    return rows


def inspect_text(pres, fix=False):
    slides, repairs, errors = [], [], []
    width, height = float(pres.PageSetup.SlideWidth), float(pres.PageSetup.SlideHeight)
    for index in range(1, pres.Slides.Count + 1):
        slide = pres.Slides.Item(index)
        objects = []
        for shape in shapes_of(slide):
            row = {"name": str(shape.Name), "id": int(shape.Id), "type": int(shape.Type),
                   "x": float(shape.Left), "y": float(shape.Top), "w": float(shape.Width), "h": float(shape.Height)}
            if row["x"] < -0.6 or row["y"] < -0.6 or row["x"] + row["w"] > width + 0.6 or row["y"] + row["h"] > height + 0.6:
                errors.append(f"Slide {index}: {row['name']} lies outside slide bounds")
            if shape.HasTextFrame and shape.TextFrame2.HasText:
                tf = shape.TextFrame2
                tr = tf.TextRange
                row["text"] = str(tr.Text)
                row["editableText"] = True
                row["fontFace"] = str(tr.Font.Name)
                row["fontSize"] = float(tr.Font.Size)
                available_h = float(shape.Height - tf.MarginTop - tf.MarginBottom)
                available_w = float(shape.Width - tf.MarginLeft - tf.MarginRight)

                def overflowing():
                    return float(tr.BoundHeight) > available_h + 1.0 or float(tr.BoundWidth) > available_w + 1.2

                before = float(tr.Font.Size)
                if fix and overflowing() and before >= 16:
                    # Keep the text intact; reduce within the editorial legibility floor.
                    for _ in range(20):
                        current = float(tr.Font.Size)
                        if not overflowing() or current <= 16:
                            break
                        ratio = min(available_h / max(float(tr.BoundHeight), 1),
                                    available_w / max(float(tr.BoundWidth), 1), 0.97)
                        tr.Font.Size = max(16, round(current * ratio * 0.98, 1))
                    if float(tr.Font.Size) < before:
                        repairs.append(f"Slide {index}: shrank {row['name']} from {before:g} to {float(tr.Font.Size):g} pt")
                row["fontSize"] = float(tr.Font.Size)
                row["boundWidth"] = float(tr.BoundWidth)
                row["boundHeight"] = float(tr.BoundHeight)
                row["boundLeft"] = float(tr.BoundLeft)
                row["boundTop"] = float(tr.BoundTop)
                row["availableWidth"] = available_w
                row["availableHeight"] = available_h
                row["overflow"] = overflowing()
                if row["overflow"]:
                    errors.append(f"Slide {index}: text overflow in {row['name']}")
            objects.append(row)
        slides.append({"index": index, "objects": objects})
    return {"slides": slides, "repairs": repairs, "errors": errors,
            "slideWidthPt": width, "slideHeightPt": height}


def run(args):
    base = {"backend": "powerpoint-com", "action": args.action, "input": str(Path(args.input).resolve()),
            "status": "unavailable", "warnings": [], "errors": []}
    if os.name != "nt":
        base["reason"] = "Native PowerPoint COM requires Windows and Microsoft PowerPoint."
        return base
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        base["reason"] = f"pywin32 is unavailable: {exc}"
        return base
    app, pres = None, None
    original_alerts = None
    owned_pids, owns_registered_app = set(), False
    workdir = Path(tempfile.mkdtemp(prefix="mvp-office-", dir=Path(args.input).resolve().parent))
    working = workdir / "working.pptx"
    pythoncom.CoInitialize()
    try:
        shutil.copy2(args.input, working)
        executable = microsoft_executable()
        try:
            if executable:
                app, pres, launched_pid = launch_native_presentation(executable, working)
                if application_pid(app) == launched_pid:
                    owned_pids.add(launched_pid)
                base["binding"] = "microsoft-executable-and-exact-file-ROT"
                base["executable"] = executable
            else:
                try:
                    win32com.client.GetActiveObject("PowerPoint.Application")
                except Exception:
                    owns_registered_app = True
                app = win32com.client.DispatchEx("PowerPoint.Application")
                if "kingsoft" in str(app.Path).lower():
                    base["reason"] = "PowerPoint COM is registered to WPS; Microsoft PowerPoint was not found. Native Microsoft animation is unavailable."
                    base["detectedApplicationPath"] = str(app.Path)
                    return base
                pres = app.Presentations.Open(str(working), False, False, False)
                base["binding"] = "registered-microsoft-powerpoint-COM"
            original_alerts = app.DisplayAlerts
            app.DisplayAlerts = 1
        except Exception as exc:
            base["reason"] = f"Microsoft PowerPoint COM could not open the working presentation: {exc}"
            return base
        base["opened"] = True
        base["powerPointVersion"] = str(app.Version)
        base["applicationPath"] = str(app.Path)
        base["applicationName"] = str(app.Name)
        base["slideCount"] = int(pres.Slides.Count)
        if args.action == "animate":
            plan = json.loads(Path(args.plan).read_text(encoding="utf-8-sig"))
            if len(plan["slides"]) != pres.Slides.Count:
                raise ValueError("Plan slide count differs from presentation; rebuild before animation")
            expected = []
            for i, slide_plan in enumerate(plan["slides"], 1):
                slide = pres.Slides.Item(i)
                shape_map = {str(s.Name): s for s in shapes_of(slide)}
                seq = slide.TimeLine.MainSequence
                while seq.Count:
                    seq.Item(1).Delete()
                for animation in slide_plan["animations"]:
                    name = slide_plan["id"] + "__" + animation["target"]
                    if name not in shape_map:
                        if animation["target"] == "image":
                            base["warnings"].append(f"Slide {i}: omitted image animation because the page has no matching photo")
                            continue
                        raise ValueError(f"Slide {i}: animation target does not exist: {name}")
                    trigger = {"on-click": 1, "with-previous": 2, "after-previous": 3}[animation["trigger"]]
                    effect = seq.AddEffect(shape_map[name], 10, 0, trigger)  # genuine msoAnimEffectFade
                    effect.Timing.Duration = float(animation["duration"])
                    effect.Timing.TriggerDelayTime = float(animation["delay"])
                    motion = animation["effect"] == "float"
                    if motion:
                        # A 1.2%-screen-height upward drift, beginning below and ending at the authored position.
                        behavior = effect.Behaviors.Add(1)
                        behavior.MotionEffect.Path = "M 0 0.012 L 0 0 E"
                        behavior.Timing.Duration = float(animation["duration"])
                    expected.append({"slide": i, "name": name, "duration": float(animation["duration"]),
                                     "delay": float(animation["delay"]), "trigger": trigger, "motion": motion})
            pres.Save()
            pres.Close()
            pres = None
            if executable:
                # A hidden PowerPoint can release its last-document server after Close;
                # bind the file again instead of trusting a stale Application proxy.
                if original_alerts is not None:
                    try:
                        app.DisplayAlerts = original_alerts
                    except Exception:
                        pass
                app, pres, launched_pid = launch_native_presentation(executable, working)
                original_alerts = app.DisplayAlerts
                app.DisplayAlerts = 1
                if application_pid(app) == launched_pid:
                    owned_pids.add(launched_pid)
            else:
                pres = app.Presentations.Open(str(working), True, False, False)
            actual = effect_snapshot(pres)
            for target in expected:
                found = [e for e in actual[target["slide"] - 1]["effects"] if e["name"] == target["name"]]
                if not found:
                    raise ValueError(f"Animation was not retained after reopening: {target['name']}")
                effect = found.pop(0)
                if effect["effectType"] != 10 or abs(effect["duration"] - target["duration"]) > .03 or effect["trigger"] != target["trigger"] or abs(effect["delay"] - target["delay"]) > .03:
                    raise ValueError(f"Reopened animation settings mismatch: {target['name']}")
                if target["motion"] and effect["motionBehaviors"] < 1:
                    raise ValueError(f"Native motion missing after reopening: {target['name']}")
            base["slides"] = actual
            base["expectedEffectCount"] = len(expected)
            base["actualEffectCount"] = sum(len(s["effects"]) for s in actual)
            pres.Close()
            pres = None
            xml = timing_xml(working)
            for i, target in enumerate(actual):
                ids = set(xml[i]["targetShapeIds"])
                for effect in target["effects"]:
                    if str(effect["shapeId"]) not in ids:
                        raise ValueError(f"OOXML timing target absent for {effect['name']}")
            base["xmlVerification"] = xml
            dest = Path(args.output or args.input).resolve()
            os.replace(working, dest)
            base["output"] = str(dest)
            base["reopenedVerification"] = True
        elif args.action == "render":
            out = Path(args.output).resolve()
            out.mkdir(parents=True, exist_ok=True)
            files = []
            for i in range(1, pres.Slides.Count + 1):
                target = out / f"slide-{i:03d}.png"
                pres.Slides.Item(i).Export(str(target), "PNG", 1600, 900)
                if not target.exists() or target.stat().st_size < 100:
                    raise RuntimeError(f"PowerPoint failed to render slide {i}")
                files.append(str(target))
            base["files"] = files
            base["width"] = 1600
            base["height"] = 900
        elif args.action == "inspect":
            result = inspect_text(pres, args.fix)
            base.update(result)
            if result["repairs"]:
                pres.Save()
                pres.Close()
                pres = None
                os.replace(working, Path(args.input).resolve())
                base["savedRepairs"] = True
            if result["errors"]:
                base["status"] = "failed"
                return base
        base["status"] = "passed"
        return base
    except Exception as exc:
        base["status"] = "failed"
        base["errors"].append(f"{type(exc).__name__}: {exc}")
        base["traceback"] = traceback.format_exc()
        return base
    finally:
        if pres is not None:
            try:
                pres.Close()
            except Exception:
                pass
        # PowerPoint may share the application singleton with an existing UI session.
        # Quit only when no other presentation remains open.
        if app is not None:
            if original_alerts is not None:
                try:
                    app.DisplayAlerts = original_alerts
                except Exception:
                    pass
            try:
                if app.Presentations.Count == 0 and (owns_registered_app or application_pid(app) in owned_pids):
                    app.Quit()
            except Exception:
                pass
        pres, app = None, None
        gc.collect()
        pythoncom.CoUninitialize()
        shutil.rmtree(workdir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["animate", "render", "inspect"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output")
    parser.add_argument("--plan")
    parser.add_argument("--report", required=True)
    parser.add_argument("--fix", action="store_true")
    args = parser.parse_args()
    if not Path(args.input).is_file():
        write_report(args.report, {"status": "failed", "errors": ["Input presentation does not exist"]})
        return 1
    if args.action == "animate" and not args.plan:
        parser.error("animate requires --plan")
    if args.action == "render" and not args.output:
        parser.error("render requires --output")
    result = run(args)
    write_report(args.report, result)
    return 1 if result["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
