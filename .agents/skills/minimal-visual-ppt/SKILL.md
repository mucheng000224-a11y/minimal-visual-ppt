---
name: minimal-visual-ppt
description: Create editable Minimal Editorial PowerPoint presentations from a topic, outline, Word, PDF or PowerPoint, using real photography, feathered image blending, six layouts and verified native PowerPoint animations. Use for 极简图文PPT、真实摄影汇报、文字可编辑演示文稿 and slide generation with source tracking.
metadata:
  version: "1.0.0"
  runtime: "Node.js 22+; Python 3.10+ for PDF/Office; Windows and Microsoft PowerPoint for native animation; Pexels API key or local photography"
---

# Minimal Visual PPT

Create the actual `.pptx`, editable text and data, photograph provenance, per-slide previews, and honest machine-readable quality reports. Resolve this skill directory from the loaded SKILL.md path; the user's current directory need not be the project root.

## Execute

1. Inspect the user's input and desired audience. For a topic or rough outline, develop an evidence-grounded narrative as a `deck-plan.json` using [the plan contract](references/plan-contract.md). Preserve supplied facts and label unverified assumptions. For complete content, the bundled deterministic planner preserves text and paginates to the builder's measured regions. It does not invent research results.
2. If dependencies are missing, run `npm install` in this skill directory, or in its containing workspace when it is a workspace package. Install `requirements.txt` using the configured Python when Office/PDF processing is needed. Keep secrets in environment variables or an untracked configuration file.
3. Run `node <skill-dir>/scripts/run.mjs --input <absolute-input> --output <absolute-output-dir>`. For local photography, add `--provider local --local-assets <catalogue.json>`. For a reviewed plan, use that JSON file as `--input`. See [runtime modes](references/runtime.md) for individual stages, configuration and material formats.
4. Read `qa-report.json`, `animation-report.json`, and `render-report.json`; inspect every real preview in `index.html` or `previews/`. Correct content, crop/focal point, photo choice or layout in the plan and rerun the affected stages. Report unavailable backends and unresolved visual concerns explicitly.
5. Deliver `deck.pptx`, previews and reports. State whether native animation was verified using Microsoft PowerPoint. A disabled/unavailable backend is a documented degradation, never animation success.

## Editorial decisions

- Use warm white, restrained typography, meaningful hierarchy and generous whitespace. Default font is Microsoft YaHei (微软雅黑); ordinary text, shapes and supported charts remain native editable objects.
- Choose L01 left text/right photo; L02 right text/left photo; L03 top text/lower photo; L04 text/whitespace; L05 full photograph/readability panel; L06 native data/process/comparison. Select photographs only where they explain the content.
- Prefer Pexels API, then relevant local material. Keep source URL, author, license and original file. With no suitable photograph, use L04 and record the fallback. Never substitute an unrelated stock image.
- The photograph is one separately selectable image object, processed with Sharp. Alpha masks affect photography alone. Text and page backgrounds stay editable. Inspect main subjects after crop; automatic saliency and palette matching are heuristics.
- Use `image.focalPoint` or another image/layout when a main subject is cut off. A native semi-transparent rectangle in L05 provides readable text over photography.
- Keep animation restrained: title fade, body items in order, image fade; add `float` only for a small native drift. Match targets by stable `slideId__target` names.

## Completion evidence

Successful generation requires a structurally valid PPTX, all planned native text, complete used-photo sources, valid geometry, and no detected text overflow. Visual review is separate from programmable checks. Exact text bounds/opening and animation verification require the corresponding Office backend; static generation remains usable without it. `--strict` rejects missing required animation/render capabilities or failed quality checks. Never represent skipped, disabled or unavailable checks as passed.
