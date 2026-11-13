"""Real LibreOffice PDF export and PyMuPDF rasterization; never synthesizes slide previews."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--soffice")
    args = parser.parse_args()
    result = {"backend": "libreoffice-pymupdf", "status": "unavailable", "warnings": [], "errors": []}
    executable = args.soffice or shutil.which("soffice") or shutil.which("libreoffice")
    if not executable:
        result["reason"] = "Neither PowerPoint COM nor LibreOffice is available; no previews were generated."
    else:
        try:
            import pymupdf
            with tempfile.TemporaryDirectory(prefix="mvp-render-") as temp:
                profile = Path(temp, "profile").as_uri()
                process = subprocess.run([executable, f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf", "--outdir", temp, str(Path(args.input).resolve())], capture_output=True, text=True, timeout=120)
                pdf = Path(temp, Path(args.input).stem + ".pdf")
                if process.returncode or not pdf.exists():
                    raise RuntimeError("LibreOffice PDF export failed: " + process.stderr[-1500:])
                output = Path(args.output).resolve()
                output.mkdir(parents=True, exist_ok=True)
                files = []
                with pymupdf.open(pdf) as document:
                    for i, page in enumerate(document, 1):
                        path = output / f"slide-{i:03d}.png"
                        page.get_pixmap(matrix=pymupdf.Matrix(1600/page.rect.width, 1600/page.rect.width), alpha=False).save(path)
                        files.append(str(path))
                result.update(status="passed", files=files, slideCount=len(files), warnings=["LibreOffice rendering may differ from Microsoft PowerPoint; native animations are not previewed."])
        except ImportError as exc:
            result["reason"] = f"PyMuPDF unavailable: {exc}"
        except Exception as exc:
            result.update(status="failed", errors=[str(exc)])
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "report": args.report}))
    return int(result["status"] == "failed")


if __name__ == "__main__":
    raise SystemExit(main())
