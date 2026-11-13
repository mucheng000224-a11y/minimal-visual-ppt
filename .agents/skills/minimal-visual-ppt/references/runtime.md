# Runtime modes and material contract

Run from any working directory using an absolute skill path:

```text
node <skill-dir>/scripts/run.mjs [generate|plan|images|build|animate|render|qa] --input <input-file> --output <output-directory>
```

`generate` is the default. `plan` writes `deck-plan.json`; later stages default to the plan/assets/build manifest in the output directory. `--plan` and `--assets` select explicit existing manifests. `render` only requires `deck.pptx`. `animate` requires the corresponding plan and deck. `qa` checks the deck plus all manifests and existing backend reports, and can shrink measured overflowing text to the 16 pt body floor and re-render it.

Options: `--config <json>`, `--provider pexels|local|none`, `--local-assets <json>`, `--python <executable>`, `--no-animate`, `--no-render`, `--strict`. Exit 0: generation/checks completed under the selected mode; exit 1: input/runtime error; exit 2: quality/strict capability failure. Read reports even on exit 0: subjective visual review is separately required.

Environment: `PEXELS_API_KEY`, `MVP_LOCAL_ASSETS`, `MVP_PYTHON`, `MVP_SOFFICE`, optional `MVP_POWERPOINT` for the genuine Microsoft executable. `.env` is read from the current working directory. JSON configuration uses keys in `src/types.ts` Config; catalogue paths in the config resolve relative to that file. CLI values override config; config overrides environment/defaults. Never write keys into output reports.

Example configuration:

```json
{"provider":"local","localAssets":"photos.json","python":"python","timeoutMs":20000,"maxImageBytes":20971520,"animate":true,"render":true,"strict":false}
```

Local photograph catalogue (array, or `{"assets":[...]}`):

```json
[{"path":"photos/wind.jpg","keywords":["wind","风能"],"author":"Photographer name","url":"https://source.example/photo","license":"License or user-provided rights statement","licenseUrl":"https://source.example/license"}]
```

Paths resolve relative to the catalogue. With no author/license supplied, provenance clearly labels user-provided material and unconfirmed rights. Candidates must match query/keywords; unrelated images are rejected. Pexels/search request errors, rejected downloads and failed decodes appear in `assets.json.warnings`. Candidate ranking is an explicit heuristic: API/lexical relevance, ratio, resolution, edge-energy subject/quiet-space proxies and mean-RGB palette similarity. It does not recognize named subjects or certify rights.

Markdown supports `#` deck title and `##` slide headings; optional `[L01]`–`[L06]` prefixes select layouts, `<!-- image: English and Chinese search keywords -->` selects a query, and `<!-- local: relative/image.jpg -->` selects local material. A fenced `data` block contains the data object from the plan contract. Word headings are extracted through Mammoth; PDF uses a local text layer; PPTX reads native text in presentation order. These modes transform content, not the original visual layout. Scanned PDFs need separate local OCR. Embedded source-document photography must be supplied or selected explicitly.

Output: `deck.pptx`, `deck-plan.json`, `assets.json`, `images/` original+PNG layers, `build-manifest.json`, `animation-report.json`, `render-report.json`, `office-inspection.json`, `qa-report.json`, `qa-report.md`, `previews/slide-001.png`, `contact-sheet.png`, `index.html`, `run-report.json`. Source images remain traceable even after native Office saves. Actual preview export requires Microsoft PowerPoint or LibreOffice+PyMuPDF; no synthetic preview is substituted.

Photographic refinements can also be expressed in Markdown: `<!-- focal: 0.5,0.58 -->` sets the normalized subject focus, `<!-- fade-width: 0.28 -->` adjusts feather width, and `<!-- image-motion: float -->` requests a gentle native drift. JSON plans expose the complete gradient/animation configuration. Keep one data block per section; split multiple datasets into distinct sections.

Provider extensions implement `ImageProvider` in `src/providers/types.ts` and pass it to `processImages`' optional provider override; adapt the provider factory/config to expose a new CLI provider. Keep download/author/license fields and fallback behavior intact.
