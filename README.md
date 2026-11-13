# minimal-visual-ppt

一个可被 Codex 发现和显式调用、也能独立运行的本地 Agent Skill。将主题/大纲、Markdown、TXT、Word、文字层 PDF 和 PPTX 内容转换为 Minimal Editorial 风格的可编辑 PowerPoint。核心为 TypeScript + PptxGenJS + Sharp；Windows 上使用 Python pywin32 + **Microsoft PowerPoint** 写入并读回验证原生动画。

Skill 位于 [`.agents/skills/minimal-visual-ppt/`](.agents/skills/minimal-visual-ppt/SKILL.md)。它包含完整运行代码、Schema、配置、测试、可执行入口和分支参考资料，可整目录复制安装。没有远程模型调用，也没有任何上传文档或发布仓库的步骤；Pexels 请求只发送规划中的图片搜索词。

## GitHub 下载

- [Skill 安装包](https://github.com/mucheng000224-a11y/minimal-visual-ppt/releases/latest/download/minimal-visual-ppt-skill.zip)：解压后将 `minimal-visual-ppt` 文件夹放到项目的 `.agents/skills/`，在该 Skill 文件夹运行 `npm install`，刷新 Codex 后使用 `$minimal-visual-ppt`。
- [完整源码包](https://github.com/mucheng000224-a11y/minimal-visual-ppt/releases/latest/download/minimal-visual-ppt-source.zip)：包含工作区依赖配置、测试与样例输入。
- [完整交付包](https://github.com/mucheng000224-a11y/minimal-visual-ppt/releases/latest/download/minimal-visual-ppt-delivery.zip)：另含三组真实 PPT、12 页预览、摄影来源和验收报告。

本仓库为私有仓库，需要登录有访问权限的 GitHub 账号后下载。

## 安装

需要 Node.js 22+；推荐 Python 3.10+。静态生成不要求 Office；PDF 提取需要 PyMuPDF。原生动画要求 Windows + 已安装并可启动的 Microsoft PowerPoint。实际执行环境和验证结果见交付目录中的验收报告。

```powershell
npm install
python -m pip install -r .agents/skills/minimal-visual-ppt/requirements.txt
Copy-Item .env.example .env
```

如宿主只带 Node、不带 npm，可运行 `node scripts/setup.mjs`，从官方 npm registry 获取固定版本 npm、校验 SHA-512 并安装依赖。此项目依赖已在当前工作区安装，可直接使用不依赖 npm 命令的入口：

```powershell
node .agents/skills/minimal-visual-ppt/scripts/run.mjs --help
```

将 `PEXELS_API_KEY` 写入本地 `.env` 即可联网检索。密钥不进入输出报告；不要把含密钥的配置加入版本管理。没有密钥时，可提供本地摄影目录；仍然缺图的页面会明确降级到 L04。

## 一条命令完整生成

```powershell
npm run deck -- --input examples/course-report.md --output outputs/course-report --provider local --local-assets examples/assets/manifest.json --strict
```

不使用 npm 命令的等效调用：

```powershell
node .agents/skills/minimal-visual-ppt/scripts/run.mjs --input examples/course-report.md --output outputs/course-report --provider local --local-assets examples/assets/manifest.json --strict
```

默认 Provider 为 Pexels。`--strict` 将不可用的必需后端及质量错误作为失败；跨平台生成可省略 strict，或明确使用 `--no-animate`。若只要静态文件且不需预览，添加 `--no-animate --no-render`，报告会记录禁用状态。

## 分步命令

```powershell
npm run deck -- plan --input examples/course-report.md --output outputs/course-report
npm run deck -- images --output outputs/course-report --provider local --local-assets examples/assets/manifest.json
npm run deck -- build --output outputs/course-report
npm run deck -- animate --output outputs/course-report
npm run deck -- render --output outputs/course-report
npm run deck -- qa --output outputs/course-report
```

完整生成也可写 `generate`。每一步均可通过 `--plan`/`--assets` 指定已有规划/图片清单。返回码：0 完成所选步骤，1 输入或运行错误，2 质量检查或 strict 能力要求失败。返回 0 不代表主观视觉检查已通过；请阅读报告。

## 内容与版式

六种真实版式：L01 左文右图/左渐隐，L02 右文左图/右渐隐，L03 上文下图/上渐隐，L04 纯文字留白，L05 全幅图/原生半透明文字区，L06 原生数据图、流程或比较。默认 16:9、暖白和低饱和配色、微软雅黑。正文按页面实际区域分页；不通过删字消除溢出。

Markdown 用 `## [L01] 标题` 指定版式；`<!-- image: wind turbine 风能 -->` 指定检索词；`<!-- local: photos/wind.jpg -->` 直接使用本地图片。原生数据图/流程/比较使用 fenced `data` JSON，三份 examples 展示完整写法。

Codex 可先针对受众和叙事编写 `deck-plan.json`，再交给 CLI 执行。独立 CLI 的确定性规划器保留给定内容并分页，不凭主题自动编造结论、数字或引用。只有主题时，Codex 应先形成有依据的大纲。详细字段及示例见 [规划契约](.agents/skills/minimal-visual-ppt/references/plan-contract.md)，JSON Schema 是各模块共享的校验依据。

本地素材清单见 `examples/assets/manifest.json`：相对路径、关键词、作者、来源 URL、许可。检索接口可替换；Pexels 和本地 Provider 共用同一接口。筛选包含相关性、宽高比、分辨率、边缘显著性/留白、全稿平均色距离，均标明是启发式，不能替代主体语义判断。

## 动画、渲染与检查

标题、正文、图片均有稳定对象名，通过名称写入淡入、顺序触发、时长和延迟；可选 `float` 为真实的轻微原生位移。Markdown 可用 `<!-- image-motion: float -->` 指定。保存后重新打开，逐目标比较动画设置，并独立检查 OOXML timing/shape IDs。静态图片不能替代动画验证。

如 WPS 接管了默认 COM 注册，后端会直接启动已安装的 Microsoft `POWERPNT.EXE` 并精确绑定工作副本，不修改系统注册。也可通过 `MVP_POWERPOINT` 指定真实 Microsoft 可执行文件。使用已有 Office 实例时保留用户文档和原有提示设置。

原生文字、图形、图片和图表独立可选中，条形图含可编辑数据。质量检查独立读取 PPTX 内部对象、关系、文字、几何、图片比例、实际 Alpha 和来源；Office 检查实际文字边界，必要时缩小到正文最低 16 pt 后重渲染。主观审美、照片主体和内容真实性单独要求逐页查看，不给虚假综合评分。

预览优先由真实 Microsoft PowerPoint 导出；跨平台可配置 `MVP_SOFFICE`，通过 LibreOffice 导出 PDF 再由 PyMuPDF 渲染。缺少渲染器时明确报告 unavailable，不生成伪预览。

每份输出包含 `deck.pptx`、规划、原图和融合 PNG、来源清单、构建清单、动画/渲染/Office 检查报告、逐页 PNG、联系表、`index.html`、JSON/Markdown 质量报告和运行报告。

## Codex 调用

在本项目中开启/刷新一个 Codex 会话，输入：

```text
使用 $minimal-visual-ppt，把 examples/course-report.md 转为可编辑极简图文 PPT，使用 examples/assets/manifest.json 的真实摄影，输出到 outputs/my-report，检查动画和每页预览。
```

`.agents/skills/` 是项目级发现位置；`agents/openai.yaml` 提供显示名和显式调用示例。迁移到其他项目时复制整个 Skill 目录，并在目标 Skill 文件夹运行 `npm install`。当前会话的技能目录可能已在启动时缓存，新安装的技能需要新会话或宿主刷新后出现在选择器。已执行官方格式校验及独立代理按 Skill 指引运行的前向测试；这与宿主 UI 的重新扫描是两个检查。

## 测试

```powershell
npm test
npm run typecheck
npm run test:integration
```

集成测试真实执行三份样例，验证全部六种版式、原生文本/图表、真实 Alpha、来源、逐页渲染和 Microsoft 原生动画。默认 strict；没有 Office 的机器可设 `MVP_INTEGRATION_STRICT=0` 检验静态生成与明确降级，但它不表示原生动画验收通过。

## 已知限制

- Word/PDF/PPTX 导入用于提取并重组内容，不重建原文件视觉排版。扫描 PDF 需先本地 OCR；复杂分栏、公式和嵌入图表需人工审阅，源文档图片需明确选择提供。
- 自动主体和留白分析是图像启发式，不是视觉语义模型。可在规划中设置焦点、替换照片或调整版式；必须检查真实预览。
- 直接传入的超长标题、过密的自写 JSON 规划会返回可操作错误；Markdown 长正文可以自动分页。流程最多 6 步，比较 2–4 列；每个 `##` 节最多一个数据块，多组数据请分节。数据页使用 L06，避免数据被无图文版式隐藏。
- Pexels 配额、网络及授权取决于用户账号。当前未提供 API 密钥，线上成功检索未作账号实测；请求协议已做测试，真实样例采用已核实来源的本地 Pexels 摄影。
- 不同 Office/字体环境可能产生细微变化；预览是静态最终画面，动画验证记录原生时间线，不导出动画视频。

## 主要依据

[Agent Skills 官方格式](https://agentskills.io/specification)、[PptxGenJS](https://gitbrent.github.io/PptxGenJS/)、[Sharp 合成](https://sharp.pixelplumbing.com/api-composite/)、[Pexels API](https://www.pexels.com/api/documentation/)、[Microsoft 原生动画接口](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.sequence.addeffect)。示例照片的作者、许可和原始页面见 [素材来源](examples/assets/SOURCES.md)。
