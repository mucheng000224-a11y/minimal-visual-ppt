# Plan contract

The authoritative JSON Schema is [deck-plan.schema.json](../schema/deck-plan.schema.json). All stages share the types in `src/types.ts`. The CLI validates both schema and semantic constraints before using a plan (unique slide IDs, matching bar labels/values, valid animation targets).

```json
{
  "schemaVersion": "1.0",
  "title": "风能课程",
  "language": "zh-CN",
  "source": "User supplied outline",
  "warnings": [],
  "style": {"background":"F6F4EF","foreground":"263332","accent":"52776C","fontFace":"Microsoft YaHei"},
  "slides": [{
    "id":"s001", "type":"content", "title":"从风中理解能量转换",
    "body":["风轮驱动发电机，将机械能转换为电能。"], "layout":"L01",
    "image":{"required":true,"query":"wind turbine renewable energy","keywords":["wind","turbine"],"focalPoint":{"x":0.65,"y":0.7}},
    "gradient":{"mode":"fade-left","width":0.42,"opacity":1,"position":0},
    "animations":[
      {"target":"title","effect":"fade","trigger":"on-click","duration":0.5,"delay":0},
      {"target":"body-1","effect":"fade","trigger":"after-previous","duration":0.35,"delay":0.08},
      {"target":"image","effect":"fade","trigger":"with-previous","duration":0.65,"delay":0}
    ]
  }]
}
```

`type`: cover/content/data/process/comparison/closing. `layout`: L01–L06. `image.localPath` is optional and resolves relative to the input file; direct paths are explicitly user-supplied material. Use a catalogue when author/license/source information is known. `image.required` requests photography but still permits a declared text fallback when none is available.

Gradient modes: `fade-left`, `fade-right`, `fade-top`, `soft-overlay`. Width is the normalized ramp extent (0,1]; position is its normalized starting point [0,1]; opacity is its maximum alpha [0,1]. A cubic smoothstep creates a feathered transition. `soft-overlay` feathers all four edges. Main subjects should lie outside the fading text-adjacent region.

Optional `data`:

```json
{"kind":"bar","labels":["基线","试点"],"values":[120,108],"unit":"模拟 kWh"}
```
```json
{"kind":"process","labels":["采集","复核","反馈"]}
```
```json
{"kind":"comparison","labels":["方案 A","方案 B"],"columns":[["特点一","特点二"],["特点一","特点二"]]}
```

Use L06 for data. Process supports 1–6 steps; comparison supports 2–4 columns. Keep labels concise; split longer processes or comparison content into multiple slides. Bar charts include editable workbook data. All numbers must come from supplied evidence, with simulation clearly labelled.

Animation targets are `title`, `body-1`, `body-2`, …, `image`; the actual native name prefixes the slide ID plus `__`. Trigger is on-click/with-previous/after-previous. `float` adds a native 1.2%-slide-height upward drift combined with fade. Duration 0.1–10 seconds; delay 0–60 seconds. Keep slide IDs stable when revising content.

The deterministic planner uses the same `contentBoxes` and text fit functions as the builder. Dense bodies become continuation slides without truncating glyphs. Overlong headings or impossible agent-authored plans fail with an actionable error; edit the plan rather than discarding content. Data annotations continue on L04 when necessary.
