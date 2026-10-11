# LayerCut

> **面向多层实体视觉设计的非破坏性 2D 图层遮挡与分层导出工具。**

LayerCut 管理多图层的 Z 轴遮挡关系，并把视觉上的遮挡转换成真正可独立输出的图层结果：

```text
Layer[i]_visible = Layer[i] − Union(All Visible Layers Above i)
```

上层移动后，下层被遮挡区域实时恢复（非破坏性，源数据永不修改）。

## 功能（MVP 0.1 + 0.2）

- **导入**：PNG / SVG（工具栏按钮或拖入画布；SVG 第一阶段按浏览器栅格化参与遮挡，保留矢量原文供第二阶段 Vector Boolean 使用）
- **SVG 图层改色**：选中导入的 SVG 后，可在属性面板分别覆盖已有填充色和描边色，并可分别恢复原色。改色属于图层属性，支持撤销、工程保存以及普通/遮挡预览和 PNG/SVG 导出；原本为 `none` 的绘制通道保持不绘制，原始 SVG 素材不变。含复杂 CSS 样式的 SVG 仍受现有矢量安全限制。
- **图案绘制（简单图形）**：工具栏的图案工具组可直接在画布上拖拽绘制 **矩形 / 椭圆 / 直线 / 多边形 / 星形**（快捷键 `R` / `O` / `L` / `P` / `S`，`V` 回到选择工具）。绘制结果是一张普通 SVG 图层（单个 `<path>`），因此**遮挡、双预览、PNG 导出、SVG 矢量导出、改色、工程保存全部沿用现有链路，工程文件格式不变**。拖拽修饰键：`Shift` 等比（正方形 / 正圆 / 45° 直线）、`Alt` 从中心绘制；`Esc` 取消本次绘制或退出工具；单击不拖拽会生成默认 200px 的图形。工具下方出现的选项行提供填充色 / 描边色（都可关闭）、描边宽度与边数（多边形 / 星形 3–12，星形内径比固定 0.5）。直线不填充；生成时 viewBox 按描边半宽外扩，描边不会被裁切。工具启用期间画布只用于绘制（图层不可拖动、不显示变换手柄、左键不平移，平移仍可用空格 / 中键 / 右键），退出工具后即可正常移动 / 缩放 / 旋转 / 改色 / 参与遮挡；几何在创建时烘焙进 SVG，不能回头改边数或圆角，需要就重画一个。
- **图层系统**：单选 / Shift、Ctrl 多选、拖拽或 ▲▼ 调整 Z 序、重命名（双击）、显示 / 隐藏、隐藏时保留遮挡、锁定 / 解锁、复制、删除、缩略图。隐藏时保留遮挡独立于显示开关：该层本身不预览或单独导出，但仍裁切下方图层；旧工程默认关闭。
- **合并**：图层面板的「合并」将当前整组图层的裁切结果按 Z 序烘焙为一张画布尺寸的透明 PNG，再以单个图层替换原图层；隐藏且保留遮挡的图层只贡献镂空，不绘制自身。合并是有损编辑，支持一步撤销恢复原图层；画布背景不写进 PNG。
- **变换**：画布拖拽 / 缩放 / 旋转（Konva Transformer）、属性面板数值输入 X / Y / W / H / 旋转 / 不透明度、重置变换。首次导入并选中素材后即可拖动变换手柄，无需切换预览模式。单图层可切换长宽等比锁定；开启后修改宽、高或拖动缩放都会保持当前比例；旧工程默认关闭。
- **遮挡引擎**：Alpha 模式 `destination-out`，一次自顶向下扫描即产出全部图层的可见结果与累积遮挡蒙版（预览与批量导出走同一套算法，各自执行一次扫描，不做跨调用缓存）；隐藏但保留遮挡的图层仅累积遮挡蒙版，不输出自身结果。
- **双预览模式**：普通预览 / 遮挡预览（含爆炸视图滑杆，检查每层裁切后的实际输出）
- **导出**：当前层 / 选中层 / 全部图层 / 合成图；1x / 2x / 4x / 自定义倍率；命名 `{序号}_{图层名}.png`，**输出文件名可在导出对话框里直接改名**（只改主名，扩展名随 PNG / SVG 格式自动切换，可一键「恢复默认名」）；**同一批导出内重名会自动追加 `(1)`、`(2)`…**，去重按导出顺序、大小写不敏感；逐层导出为透明背景，合成图按画布设置烘焙背景（透明画布则为透明底）；优先调用系统「选择文件夹」保存，不支持时自动回退 ZIP 下载
- **编辑体验**：Undo / Redo（一次拖拽 = 一步历史）、滚轮指向缩放、空格 / 中键 / 右键拖动平移、Fit（Ctrl+0）、对齐吸附（拖动图层时吸附画布边缘 / 中心与其他图层的边缘 / 中心；变换手柄缩放旋转暂不支持吸附）、快捷键
- **工程系统（MVP 0.3）**：**全屏工程控制台（起始页）**——启动软件默认进入，集中管理项目：新建工程（名称 + 画布预设 + 背景）、最近工程卡片墙（缩略图 / 打开 / 删除 / 从文件打开）、上次会话自动恢复横幅；编辑器中点击左上角 LayerCut 品牌返回控制台；保存 / 打开 `.layercut` 工程文件（JSON，全部素材以 base64 内嵌，跨设备可用）、自动保存（IndexedDB 防抖 1.5s）、导出配置记忆、标题栏与状态栏显示未保存状态（● / Ctrl+S 保存）
- **工程保存的 PNG 来源**：导入时保留原始 PNG 文件 Blob；工程保存和自动保存直接读取原始字节，不依赖预览用 `blob:` URL 的网络请求。桌面版 CSP 禁止 `fetch(blob:)`，因此预览 URL 只能用于显示，不能作为保存真源。
- **工程读取的内嵌素材**：`.layercut` 内的 base64 素材直接解码为 Blob；桌面版不通过受 CSP 限制的 `fetch(data:)` 读取。
- **桌面工程保存**：桌面版弹出系统「另存为」对话框，选定 `.layercut` 路径后写入文件；取消或写入失败不会标记为已保存。Web 版继续使用浏览器下载。
- **界面布局**：左右面板拖拽调宽（190–460px）、双击或箭头收起 / 展开，布局状态持久化；统一输入控件套件（`src/ui/controls`：文本 / 数字 / 滑杆 / 颜色拾取，焦点光晕、自绘滑杆填充、无原生 spinner），全部输入点共用一套视觉
- **矢量管线（v0.4–v0.6）**：导出对话框可选 **SVG 矢量** 格式——每层输出 `Layer[i] − Union(上方参与遮挡的图层)` 的真实矢量结果（Paper.js 路径布尔，曲线保留、viewBox 与画布一致、可按倍率缩放）。条件：参与输出或遮挡的图层均为 SVG 且不含暂不支持元素（**`<use>`** / text / image / filter / mask / clipPath / pattern / style / SMIL 会禁用该选项）；参与遮挡的 PNG 不可用（§7.3）。`<use>` 暂不支持是因为 Paper.js 的导入器在这条调用路径下会把它解析成空图形，此前门禁放行会导致导出结果**静默缺少该层的裁切**，故现在改为明确禁用并提示。已知限制：布尔只作用于填充几何，描边保留但不会被遮挡裁切。
- **中英双语**界面（右上角切换，记住偏好）

### 快捷键

| 按键 | 功能 |
| --- | --- |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | 撤销 / 重做 |
| Delete / Backspace | 删除选中图层 |
| Ctrl+D / Ctrl+A | 复制 / 全选 |
| 方向键（+Shift） | 微调 1px（10px） |
| Ctrl+= / Ctrl+- / Ctrl+0 | 放大 / 缩小 / 适配窗口 |
| V / R / O / L / P / S | 选择 / 矩形 / 椭圆 / 直线 / 多边形 / 星形工具 |
| Space + 拖拽 / 中键拖拽 / 右键拖拽 | 平移画布 |
| Esc | 取消选择（图案工具启用时先退出工具；绘制中取消本次绘制） |

## 运行

```bash
npm install
npm run dev        # Web 版，http://localhost:5173
npm run build      # Web 版产物在 dist/

npm run app:dev    # 桌面版开发（Tauri，自动起 vite）
npm run app:build  # 桌面版构建
```

**桌面应用（Tauri 2）**：`npm run app:build` 产出

- 独立可执行文件 `src-tauri/target/release/layercut.exe`
- NSIS 安装包 `src-tauri/target/release/bundle/nsis/LayerCut_0.4.1_x64-setup.exe`（按用户级安装，中文/英文安装界面）

> 国内网络提示：Tauri 打包器首次会从 GitHub 下载 NSIS 工具包（`nsis-3.11.zip` 与 `nsis_tauri_utils-v0.5.3.dll`）。若 `github.com` 不可达，可经镜像（如 `https://ghfast.top/` 前缀）下载这两个文件，SHA1 分别为 `EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D`、`75197FEE3C6A814FE035788D1C34EAD39349B860`，将 zip 解压重命名为 `%LOCALAPPDATA%\tauri\NSIS`（makensis.exe 在其根目录），dll 放入 `NSIS\Plugins\x86-unicode\additional\` 后重新执行 `npm run app:build`。

桌面版使用系统 WebView2（Windows 11 自带），安装包体积小，无需打包 Chromium。窗口配置 `dragDropEnabled: false` 以保留 HTML5 原生拖放导入；导出窗口可选择「选择文件夹」或「ZIP 压缩包」。文件夹选择依赖 WebView2 的 File System Access API，系统或敏感目录可能被拒绝；建议选择专用输出子目录，遇到限制可直接选择 ZIP 并解压到目标位置。取消文件夹选择不会记为导出成功，不支持文件夹选择时默认 ZIP。构建需要 Rust (MSVC) 工具链。

桌面启动依赖正式构建的 `custom-protocol` feature。Vite 将 `paper` 的运行时入口统一映射到 `paper/dist/paper-core.js`：本项目只使用 JavaScript 矢量 API，不使用 PaperScript。默认的 `paper-full` 会在初始化时动态编译 PaperScript，被桌面 CSP 拦截后导致首页黑屏；保持当前 CSP 并使用 core 构建即可避免该初始化错误。修改构建配置后须重新执行 `npm run app:build`，已有 exe 不会自动更新。

桌面开发启动使用 `npm run app:dev -- --no-watch`。Vite 不监视 `src-tauri/target/` 的 Rust 构建产物，避免 Windows 上监视临时可执行文件时触发 `EBUSY`；Cargo 构建依赖显式启用 `indexmap` 的 `std` feature，以满足 Tauri 依赖链中 `schemars` 的有序 Map 类型。

要求现代浏览器 / WebView2（Chrome / Edge 最佳）。

## 许可 / License

采用自研的 **LayerCut 商用告知许可（LCNL）1.1**（见 [LICENSE](./LICENSE)），要点：

- 免费使用、修改、再分发，**允许一切商用**（网络服务 / 商业产品售卖 / 随商品赠送 / **产出文件商用**——用 LayerCut 导出的文件做实体制作、印刷、切割后出售等，同样只需告知）
- **唯一的使用条件**：开始商用之时发送一封电子邮件告知原作者（地址见 LICENSE），同步生效——**无需原作者确认**
- **Apache-2.0 式配套条款齐备**：完整专利授权（含防御性终止）、贡献提交自动授权、再分发条件（变更声明 / 保留署名 / NOTICE / 源码与目标码形式）、商标豁免、保修转嫁、完整责任限制
- 非商业性的个人学习与本地使用无需告知
- 详见 LICENSE 文件（中英双语，以中文为准）

## 技术栈

Vite · React 18 · TypeScript · Konva.js（react-konva）· zustand · JSZip

## 目录结构

```text
src/
├─ editor/     画布编辑器（Stage、视口缩放平移、Transformer、吸附、快捷键、图案绘制手势与预览）
├─ layers/     图层数据模型、store（含撤销历史）、图层面板
├─ shapes/     图案绘制（纯几何 → 单 path SVG → 普通 svg 图层）
├─ assets/     源素材仓库（位图 / SVG 原文，独立于撤销历史）
├─ import/     PNG / SVG 导入
├─ renderer/   栅格化渲染
├─ occlusion/  遮挡引擎（destination-out + 累积 mask）、AlphaMask（预留 Binary 模式接口）
├─ export/     导出（命名、单层 / 批量 / 合成、文件夹选择 + ZIP 兜底）
├─ ui/         工具栏、属性面板、状态栏、对话框、图标
├─ i18n/       中英字典
└─ utils/
```

## 设计说明

- **非破坏性**：所有遮挡结果都是 Derived Data，源图层完整保留；移动上层后下层被挡区域实时重现。
- **图案绘制的接入方式**：绘制的图形不是新的图层类型，而是一张按拖拽位置现算的单 `path` SVG，作为普通素材进入 `assetStore`，再包成一个普通 `svg` 图层。因此遮挡引擎、两种预览、PNG/SVG 导出、工程读写都不需要图案分支，源数据同样永不修改（图层改色仍是图层属性覆盖）。代价是几何在创建时烘焙，不支持回头改边数/圆角，需要就重新画一个。
- **导出命名**：文件名由 `planExportFiles()` 统一规划，导出对话框的预览列表和写入器读的是**同一份计划**，所以改名和自动 `(1)` 不可能出现「预览与实际写出的文件不一致」。去重只作用于**一次导出内部**（目标文件夹里已存在的同名文件仍按原有行为覆盖）；大小写不敏感，因为 Windows / macOS 文件系统不区分大小写，`Logo.png` 与 `logo.png` 会互相覆盖。改名是对话框内的一次性编辑，不写进工程文件，重新打开对话框即回到默认命名。
- **性能**：第一版主线程 + Canvas 足够（文档 §15）；遮挡引擎接口已按 `computeOcclusion(layers, canvas, assets, scale)` 收敛，后续可平移到 Web Worker + OffscreenCanvas。
- **抗锯齿边缘**：Alpha 模式下，导出图层重新叠放时仅在形状抗锯齿边缘（半透明像素）与普通预览存在理论性差异，完全不透明区域像素级一致；实体制作场景可启用后续规划的 Binary 遮挡模式（接口已预留于 `occlusion/AlphaMask.ts`）。
- **SVG**：第一阶段栅格化参与遮挡（导出 PNG 时按倍率重新栅格化保持清晰）；SVG Vector Boolean 见原规划第二阶段。

## 测试素材

**一条命令跑全部回归**：

```bash
npm test          # 4 个 Node harness + 6 个浏览器 harness
npm run test:node # 只跑 Node 侧（不需要浏览器）
```

`npm test` 会自动探测 Edge / Chrome 并起一个临时 dev server 无头执行 6 个浏览器 harness，逐条打印 `PASS/FAIL`。找不到浏览器时跳过（退出码 0），可用 `BROWSER_PATH` 指定路径、`HARNESS_PORT` 换端口。此前这 6 个 harness 只能手开浏览器 URL，实际上没人跑——`<use>` 那个静默错误的缺陷正是活在这个盲区里，所以现在把它们接进了 `npm test`。

`scripts/make-fixtures.mjs` 生成 `fixtures/`（3 张带透明通道的 PNG + 1 个 SVG），可用于手工验收：导入 → 任意变换 → 遮挡预览 → 批量导出 → 将导出图层按原坐标叠放，与普通预览对比。

需要单独看某个 harness 时，`npm run dev` 后打开对应 URL：

- `scripts/export-naming-regressions.html` — 非法字符清理、改名、重名 `(1)/(2)`、大小写不敏感冲突、空白改名回退、导出计划，以及**「预览文件名 == 实际写入文件名」**（PNG / SVG / 合成图）。
- `scripts/layer-visibility-regressions.html` — 隐藏遮挡、等比锁定、合并透明孔洞。
- `scripts/canvas-pan-regressions.html` — 右键 / 中键 / 普通左键平移，图案工具期间不平移，以及**空格平移时图层不被拖动**（直接读 Konva 节点的 `draggable`）。
- `scripts/shape-regressions.html` — 图案绘制几何（含描边外扩、反向拖拽、边数钳制）、拖拽修饰键、栅格与遮挡像素、矢量导出、撤销/重做与工程往返。
- `scripts/svg-paint-regressions.html` — 改色（填充 / 描边 / none 保持不绘制）、**改色优先于作者 CSS**、两图层各自配色、工程往返、源不变、撤销/重做。
- `scripts/vector-regressions.html` — viewBox / preserveAspectRatio、不透明度门禁、多色填充、**`<use>` 被门禁拒绝**、**各长度单位下的固有尺寸**。

Node 侧：`scripts/export-regressions.cjs`（导出保存方式，含 `svg_partial_opacity` 两条门禁分支）、`scripts/project-regressions.cjs`（工程历史、读入校验、自动保存）、`scripts/project-blob-regressions.cjs`（桌面 CSP 下的 PNG 原始字节保存）、`scripts/history-regressions.cjs`（撤销/重做边界）。

已知构建提示：Vite 对现有约 851 kB 的主包给出 500 kB 分包建议；该提示不影响本轮功能与构建，但主包拆分需独立性能验收。
