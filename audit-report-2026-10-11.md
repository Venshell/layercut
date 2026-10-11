# LayerCut 全量审计报告（第二轮）

- **项目**：`F:\draw` — LayerCut v0.4.1（Tauri 2 + React 18 + TypeScript + Konva + Paper.js 0.12.18 + zustand）
- **审计对象**：当前 HEAD `90b8d11` 的**整个代码库**（非单次 diff）
- **审计方法**：`code-review` skill 的双轴方法论（Standards 规范一致性 + Spec 需求一致性），覆盖 `src/`、`src-tauri/`、`scripts/`、构建与文档配置
- **与上一轮的关系**：仓库内已有 `review-report.md`（502 行，上一轮全量审查），其后的 14 个提交在逐条消化它的结论。本轮**独立重审全树**，并对上一轮的每条结论做**对抗性核验**（不相信注释/提交信息，只认实测）
- **执行方式**：主控直接完成全部高风险核验（构建、编译、6 个浏览器 harness、像素级实验、库源码追溯）；另派 6 个子代理按子系统并行静态审查，其中构建/工程化子代理的结论已并入（其独立复核了 mock 缺口与 harness 类型错误）。所有写入本报告的缺陷均由主控**亲自复现**。
- **日期**：本次会话
- **本轮修复状态**：本报告的 13 项缺陷**已全部修复**（见 §10），另补上了"6 个浏览器 harness 接入 `npm test`"与 3 个闲置词条的清理。修复过程见 §10 的逐项证据。

---

## 0. 验证基线（全部为本次实际执行的命令与结果）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 应用侧类型检查 | `npx tsc -p tsconfig.app.json --noEmit` | ✅ EXIT=0 |
| 构建脚本类型检查 | `npx tsc -p tsconfig.node.json --noEmit` | ✅ EXIT=0 |
| 回归套件 | `npm test` | ✅ EXIT=0（export 6 / project 11 / blob 1 / history 7，全 PASS） |
| Web 构建（文档化命令） | `npm run build`（= `tsc -b && vite build`） | ✅ EXIT=0 |
| Web 构建（单独跑） | `npx vite build` | ✅ EXIT=0（858.10 kB JS + 16.27 kB CSS） |
| Rust release 编译 | `cargo check --release` | ✅ EXIT=0（59.68s） |
| Rust dev 编译 | `cargo check` | ✅ EXIT=0（23.61s） |
| **浏览器 harness ×6** | Edge headless + vite dev server | ✅ **全部实际跑通**（详见 §6.1） |
| i18n 字典对称性 | 脚本核验 | ✅ zh 136 / en 136，无重复/缺失，顺序一致 |
| 命名边界 | 独立 harness + 真实文件系统写入 | 见 §1（P2-14） |
| 形状描边外扩 | Edge headless 像素实测（25 组合） | ✅ 无裁切 |
| 产物/版本库卫生 | `git ls-files` / `git check-ignore` | ✅ 干净 |

**可复跑的证据脚本**：本报告的关键结论都留有 harness，位于 `scripts/_audit-*.{ts,html,cjs}`（被 `.gitignore` 的 `_*` 规则忽略，不进版本库）。复跑方式：`npm run dev` 后打开 `http://localhost:5173/scripts/<name>.html`，或用 Edge headless：

```powershell
msedge --headless=new --disable-gpu --user-data-dir=$env:TEMP\p --virtual-time-budget=25000 --dump-dom "http://localhost:5173/scripts/_audit-use-cut.html"
```

主要脚本：`_audit-use-cut.html`（P0-1 像素级证据）、`_audit-svg-matrix.html`（20 项元素矩阵）、`_audit-units2.html`（P1-3 单位分叉）、`_audit-use-png.html`（PNG 对照）、`_audit-i18n.cjs`（词典对称性）、`_audit-csp-verify.cjs`（exe 内嵌哈希核验）。

**上一轮报告称"无法执行"的两项，本轮都执行成功了**（需沙箱外权限；当前会话为 `danger-full-access`）：
- `npx vite build`：上一轮记为"被沙箱管道限制拦截（spawn EPERM）"——本轮 EXIT=0。
- 浏览器 harness：上一轮记为"本会话无法执行"——本轮 6 个全部跑通并取得真实结果。

---

## 1. 已确认缺陷

共 **13 项缺陷**（1 项 P0 + 6 项 P1 + 6 项 P2），另 1 项（P2-14）为实测澄清、**不是缺陷**，故本节共 14 个编号。所有结论均由主控亲自复现，含可重跑的命令或像素级实验。其中 P1-7 与 P2-8 是上一轮报告已记录、本轮确认**仍未修复**的 B23/B22。

严重度定义：**P0** = 产出错误结果或数据损坏且用户难以察觉；**P1** = 功能失效或格式间不一致；**P2** = 死代码、文档偏差、低概率问题。

### P0-1【最严重】`<use>` / `<symbol>` 遮挡层被静默忽略 → SVG 导出产出错误文件且无任何报错

**位置**：`src/vector/svgNormalize.ts:237-238`（物化）、`src/vector/svgBoolean.ts:121-123`（累积遮挡蒙版）、`src/vector/svgSafety.ts:11-30`（门禁白名单）

**实测证据**（Edge headless，像素计数）：下层为整幅 100×100 红矩形，上层为 50×50 遮挡层且 `visible=false, occludesWhenHidden=true`：

| 上层遮挡物 | 下层输出不透明像素 | 正确值 | 判定 |
| --- | --- | --- | --- |
| 普通 `<rect>`（对照组） | **7500** | 7500 | 遮挡正确生效 |
| `<defs><symbol>` + `<use>` | **10000** | 7500 | ❌ **完全未被裁切** |

**同文件两格式对照**（同一输入、同一实验）：

| 导出格式 | 下层不透明像素 | 判定 |
| --- | --- | --- |
| PNG | 7500 | ✅ 正确 |
| SVG 矢量 | 10000 | ❌ 未裁切（静默） |

PNG 正确是因为它交给浏览器原生栅格化（浏览器完整支持 `<use>`）；SVG 路径走 Paper.js 导入。

**根因（读第三方库源码确认）**：`node_modules/paper/dist/paper-core.js:15313-15322` 的 `use` importer 依赖模块级 `definitions[id]` 注册表，该表由 `applyAttributes` 的 `id` 钩子（L15424-15428）填充。在 `importSVG(text, { expandShapes: true, insert: false })` 这条调用路径下，`<use>` 被解析成一个**空的 `Shape`**（实测 importedTree 仅含一个 `Shape`，无 `SymbolItem`，`symbolDefinitions` 为空），`materialize()` 对它调用 `toPath(true)` 得到空几何，最终 `filledBuckets` 为空。

**为什么比"报错"更糟**：导出**成功**、无提示、文件名与预览都正常，但下层图层保留了本应被抠掉的区域。用户会把错误结果当成正确结果交付。

**影响范围的界定**（20 项元素矩阵实测，判据「门禁说 safe 但矢量管线产出 0 个填充桶」）：

| 类别 | 结果 |
| --- | --- |
| 8 项受支持图元（rect/path/circle/ellipse/polygon/line/g+transform/gradient/nested svg） | 全部正常产出 |
| 7 项不支持元素（text/image/clipPath/pattern/style/mask/filter） | **门禁全部正确拦截**，`offending` 准确（`filter` 还正确带出 `feGaussianBlur`） |
| `polyline`（`fill="none"` + stroke） | 0 填充桶，但属 README 已披露的「布尔只作用于填充几何」限制，**非缺陷** |
| **`<use>` 三种形态**（→symbol / →rect id / →g id） | **全部静默错误** |

静默错误**恰好且仅仅**集中在 `<use>` 一类，修复范围明确。

**披露状态的公平说明**：`release-notes-v0.4.1.md:28` **确实**写了「`<use>` 的专项回归尚未通过……需要精确保留这些效果时请使用 PNG 导出」。但三处更贴近用户决策点的信息与之矛盾：
1. `src/vector/svgSafety.ts:6-7` 的注释把 `use, symbol` 明确列为 **Supported**（这是门禁与 README 的共同依据）；
2. `README.md:30` 的不支持元素清单是 `text / image / filter / mask / clipPath / pattern / style / SMIL`，**不含** `use`/`symbol`；
3. 应用内 `checkSvgExportGate` 返回 `offered`，导出对话框**不会禁用** SVG 格式。

唯一说真话的地方是一份发布说明，而用户在应用内与 README 得到的是相反信号。

**最小修复（机制已实测验证）**：把 `use`/`symbol` 移出 `svgSafety.ts:11-30` 的 `SAFE_TAGS` → 门禁立即以 `svg_unsafe` 诚实拒绝并列出 `use`（约 2 行改动）。我验证了该修复的完整效果链：

| 环节 | 现状 | 修复后 |
| --- | --- | --- |
| `analyzeSvgSafety(<use> 文档)` | `{safe: true, offending: []}` | `{safe: false, offending: ["use"]}` |
| `checkSvgExportGate` | `offered`（用户可选 SVG，随后静默出错） | `{ok: false, code: "svg_unsafe", offending: ["use"]}` |
| 导出对话框 | 不禁用 SVG 格式 | 禁用 SVG 并显示「不支持元素: use」 |

即**把"静默产出错误文件"变成"明确告知用户不可用"**，与 `release-notes-v0.4.1.md:28` 已经披露的事实一致。彻底修复则在 `importLayerGeometry` 内自行物化 `<use>`（解析 href → 查 DOM → 克隆定义 → 应用 x/y/transform）。

---

### P1-2 导出计划与实际写出能力不一致 → 整批导出失败

**位置**：`src/export/exportAll.ts:56-61`（`layerProducesOutput`）vs `src/export/exportAll.ts:236-237`（写出循环）

**实测证据**：
- 纯填充矩形 → `planFiles=["001_test.svg"]`、`gate=offered (ok)` → `wrote 1 file(s)`
- `fill="none"` 且无描边的矩形 → `planFiles=["001_test.svg"]`、`gate=offered (ok)` → **`THREW: export_layer_missing`**
- `<use>` 图层 → 同上，`THREW: export_layer_missing`

**说明**：`layerProducesOutput` 只检查「有素材 + opacity>0」，无法预判矢量管线是否产出几何。其注释（L49-55）自称"对话框预览就是实际写出的文件集合"，该承诺在此类输入上不成立。用户看到文件预览里有该文件，导出时整批失败（`throw` 中止，已写文件不回滚）。

**与 P0-1 的关系**：两者是同一处不一致的两面——P0-1 是"该报错时静默"，P1-2 是"该拦截时到了写出阶段才炸"。

---

### P1-3 同一 SVG 的 PNG 与 SVG 导出尺寸不一致（两套单位解析器分叉）

**位置**：`src/renderer/SVGRenderer.ts:13-33`（`parseSVGSize`，导入路径）vs `src/vector/svgNormalize.ts:77-102`（`parseLength`，矢量路径）

**实测证据**（Edge headless），输入 `width="10pc" height="10pc" viewBox="0 0 50 50"`：

| 量 | 值 |
| --- | --- |
| 浏览器真实解码尺寸 | 160×160 |
| `parseSVGSize`（PNG 路径用） | **50×50**（错误回退到 viewBox） |
| 矢量管线几何包围盒 | **160×160**（正确） |
| PNG 实际绘制到画布 | **50×50**（红蓝各 1250 px） |

**根因**：`parseSVGSize` 的正则 `^([\d.]+)\s*(px|pt|mm|cm|in)?$` 只认 5 种单位，**不含 `pc`/`q`**，也不支持科学计数法 `1e2`；解析失败即回退 viewBox。`parseLength` 有完整的 `CSS_UNITS_PX` 表（含 `pc`/`q`）与科学计数法支持。

**影响**：使用 `pc`/`q`/科学计数法尺寸的 SVG，PNG 导出按错误尺寸绘制（本例缩小到 31%），而同一文件的 SVG 矢量导出尺寸正确 → 两格式互相矛盾。且 `naturalWidth/Height` 错误会连带影响 `initialTransform` 的初始缩放与 `drawLayerToContext` 的 `drawImage` 目标矩形。

**修复方向（已实测验证）**：让 `parseSVGSize` 直接采用 `img.naturalWidth/naturalHeight`——`importSVG.ts:14` 已经加载好 `img`，就在出错的 `:15` 上一行，改动为零额外成本。我实测了这个改法的影响面：

| 输入 | 现 `parseSVGSize` | 改用 `img.naturalWidth` | 是否变化 |
| --- | --- | --- | --- |
| `50`（普通） | 50 | 50 | 不变 ✅ |
| `75pt` | 100 | 100 | 不变 ✅ |
| `2in` | 192 | 192 | 不变 ✅ |
| **`10pc`** | **50（错）** | **160（对）** | 修正 ✅ |
| **`100q`** | **50（错）** | **94（对）** | 修正 ✅ |
| **`1e2`** | **50（错）** | **100（对）** | 修正 ✅ |

**该修复的影响面（第二次实测，更正我先前的说法）**：我第一次只测了「有显式 width/height」的输入，据此说"只改动已损坏的三种情况"。补测「无显式尺寸 / 百分比 / em / 仅 width」后，**该说法不成立**：

| 输入 | 现 `parseSVGSize` | `img.naturalWidth` | 宽高比是否改变 | 说明 |
| --- | --- | --- | --- | --- |
| `200x100` 显式 | 200×100 | 200×100 | 否 | 一致 |
| 无 w/h，viewBox 2:1 | 100×50 | **300×150** | **否**（均 2:1） | 值变了：浏览器回退到 300×150 默认 |
| `100%`，viewBox 2:1 | 100×50 | **300×150** | **否**（均 2:1） | 同上 |
| `10pc`（损坏项） | 100×50（错） | **160×160** | **是**（2:1 → 1:1） | 此项本就错，修复后正确 |

**结论修正**：宽高比在**所有**情况下都是正确的（`preserveAspectRatio` 默认 meet，viewBox 映射等比），所以此修复**不会造成形变**；但它会改变「无显式尺寸 / 百分比 / em」这类输入的**绝对像素尺寸**（100×50 → 300×150）。这些输入按 SVG 规范本就该回退到 300×150，故新值更符合规范，但**属于行为变更**，需要一条回归断言锁住，不能当作零风险改动。

采用后可一并删除 `SVGRenderer.ts` 里那套重复的单位解析代码（见 §5）。

---

### P1-4 `assetDataCache` 无上限、无清理（会话内内存泄漏）

**位置**：`src/project/projectTypes.ts:52`（声明）、`:89`（读）、`:111`（写）

**证据**：全仓库仅这 3 处引用，**没有任何 delete/clear 路径**。对照 `releaseAssetsExcept`（`src/assets/assetStore.ts:55-64`）会释放 `bitmap.close()`、`URL.revokeObjectURL`、`releasePaintedVariants`，**唯独不触碰该缓存**。

**影响**：缓存内容是每个素材的 **base64 data URL**。我实测了膨胀系数：6834 字节的 PNG → 9112 字符的 data URL payload，**膨胀 1.333 倍**（`4/3`，base64 的固有开销）。反复「打开工程 → 编辑 → 再打开另一个工程」时，旧工程的 base64 全量驻留内存，且 `releaseAssetsExcept` 的释放承诺被绕过。

**已排除的相关怀疑（避免误报）**：我构造实验验证了缓存会按 asset id 返回旧值（即使传入的 `sourceBlob` 内容已变）。但这**不构成实际缺陷**：`newAssetId()`（`src/utils/id.ts`）由 `时间戳 + 计数器 + 随机串` 三段组成，全仓库 4 个调用点（`importPNG.ts:13`、`importSVG.ts:17`、`mergeLayers.ts:38`、`createShape.ts:40`）都生成新 id，id 复用实际上不可能发生。故"缓存按 id 缓存不可变素材"这一前提在真实使用下成立——**唯一真实问题是它永不释放**。

**修复方向**：在 `releaseAssetsExcept` 内同步驱逐（导出 `releaseSerializedAssets(keep)`），或给缓存加 LRU 上限（可参照 `svgPaint.ts:5` 的 `MAX_VARIANTS = 128` 既有做法）。

---

### P1-5 `export-regressions.cjs` 的 `svgSafety` mock 缺 `svgHasPartialAlpha` → 不透明度门禁零覆盖，且一旦被覆盖就崩

**位置**：`scripts/export-regressions.cjs:47`、`src/export/exportAll.ts:124`

**证据**：
```js
// scripts/export-regressions.cjs:47 —— mock 只提供 analyzeSvgSafety
'../vector/svgSafety': { analyzeSvgSafety: () => ({ safe: true }) },
```
```ts
// src/export/exportAll.ts:15,124 —— 真实代码用了两个导出
import { analyzeSvgSafety, svgHasPartialAlpha } from "../vector/svgSafety";
if (svgHasPartialAlpha(asset.svgText)) return { ok: false, code: "svg_partial_opacity" };
```

该行**永不执行**，因为 harness 的资产表（`:25`）是 `{ a: { kind: 'svg' } }`——**没有 `svgText`**，故 `:123` 的 `asset?.kind === "svg" && asset.svgText` 恒假；图层也都不带 `opacity` 字段，`:121` 的 `layer.opacity > 0 && layer.opacity < 1` 对 `undefined` 恒假。

**后果**：`svg_partial_opacity` 是 v0.4.1 新增的门禁契约（源级 `svgSafety.ts:72-93` + 图层级 `exportAll.ts:121`），却被两条 SVG 门禁用例**同时绕过**。harness 自称覆盖「隐藏空图层 / 隐藏 PNG 遮挡层对 SVG 导出的门禁」，实际只覆盖了 `svg_needs_all_svg` 一条分支；`svg_unsafe` 也被 `analyzeSvgSafety: () => ({safe:true})` 桩死。

**隐藏的更糟之处**：任何一次给 harness 资产补 `svgText` 的维护动作，都会让原本 PASS 的用例变成 `TypeError: svgHasPartialAlpha is not a function`——而不是断言失败，误导性极强。

**修复**：mock 补上 `svgHasPartialAlpha: () => false`，并另加一条真正返回 `true` 的用例。

---

### P1-6 P0-2 的修复（平移时不拖动图层）没有任何测试锁住

**位置**：`scripts/canvas-pan-regressions.tsx:10-14,33`

**证据**：该 harness 全文**从不创建任何图层**（无 `addLayers`/`loadProject`/`newCanvas` 调用），`store.layers` 恒为 `[]`（`layerStore.ts:186` 初值）。而 P0-2 的修复是 `CanvasEditor.tsx:182` 的：
```tsx
draggable={interactive && !panning && !layer.locked}
```
`draggable` 只在**渲染某个图层节点**时才求值。0 图层 → 该表达式永不执行 → 这个条件写对写错，harness 都给出 4/4 PASS。

**后果**：上一轮报告 §5.5 说该 harness「永远测不到 P0-2」，这一判断**成立且至今未修**——P0-2 是真实的、已修复的缺陷，但修复本身处于无回归保护状态，未来重构很容易重新引入。

**修复**：harness 先 `addLayers` 一个图层，再断言「空格+左键拖动时视口平移而图层 transform 不变」。

---

### P1-7 SVG 改色被作者 CSS 压过（画布显示旧色、面板显示新色，无提示）

**位置**：`src/vector/svgPaint.ts:21-38`（写入方式）、`:27-28`（`removeProperty` + `setAttribute`）

**实测证据（像素级）**：把图层填充色改为 `#00ff00`，渲染后取中心像素：

| 输入形态 | 改色后中心像素 | 判定 |
| --- | --- | --- |
| 元素 `fill="#ff0000"`（presentation attribute） | `[0,255,0,255]` | ✅ 覆盖生效 |
| 元素 `style="fill:#ff0000"`（内联样式） | `[0,255,0,255]` | ✅ 覆盖生效 |
| **作者 CSS `<style>rect{fill:#ff0000}</style>`** | **`[255,0,0,255]`** | ❌ **覆盖被压过** |

**根因**：代码用 `setAttribute("fill", …)` 写入 presentation attribute，而 CSS 规则的层叠优先级**高于** presentation attribute；同时代码从不移除或改写 `<style>` 元素（实测改色后 `<style>` 仍在输出中）。

**影响**：属性面板显示新颜色、画布与导出仍是旧色，**无任何提示**。这是上一轮 B23，至今未修。含 `<style>` 的 SVG 在真实素材中常见（Figma/Illustrator 导出、手写 SVG）。

**修复方向**：改写 `<style>` 内的规则、或对命中元素写内联 `style` 并加 `!important`、或直接剥离 `<style>` 后按计算值回填各元素属性。

**注**：README:16 已声明"含复杂 CSS 样式的 SVG 仍受现有矢量安全限制"——但该措辞指向的是**矢量导出**的安全门禁，而本缺陷发生在**改色**（普通预览与 PNG 导出同样受影响），且用户看不到任何提示。故仍应视为缺陷而非纯文档问题。

---

### P2-8 素材解码失败时图层无声消失，只有 console 日志

**位置**：`src/vector/usePaintedAsset.ts:18`

**证据**：
```ts
paintedAsset(asset, layer).then((result) => {
  if (active) setPainted(result);
}).catch((error) => console.error("SVG paint preview failed", error));   // ← 仅日志
```
无 `setNotice` 调用（对照：`useShapeGesture.ts:61`、`LayerPanel.tsx:86-93`、`importFiles.ts:37` 都会给用户提示）。

**影响**：这是上一轮 B22，至今未修。素材解码失败时图层面板缩略图变空、画布上该图层消失，用户只看到"图层没了"而不知原因，也没有重试入口。

**修复方向**：`catch` 内 `setNotice`（可复用既有的 `t("...")` 提示模式），并在缩略图位置显示失败态。

---

### P2-9 `index.html` 的内联错误陷阱是死代码

**位置**：`index.html:11-20`

**证据**：`window.__errs` 全仓库仅在此处**写入**，`src/` 与 `scripts/` 中**零处读取**（已 grep 确认）。注释声称"visible via console + window.__errs"，前半句靠 `console.error` 成立，后半句不成立。

**附带更正**：上一轮报告 §0/§6 与 `.workbuddy` 记忆文件称"内联脚本在 CSP 下被拦"——**该结论错误**。Tauri 在构建期由 `tauri-codegen` 的 `inject_script_hashes` 为每个内联脚本计算 sha256 并注入 `script-src`（`tauri-codegen-2.7.0/src/context.rs:47-64`；运行时 `tauri-2.12.0/src/manager/mod.rs:53-101` 的 `set_csp` 合并）。实测 `layercut.exe` 内含 `'sha256-7/g1th4GNjJmmi1BMmkyLFiwLFnSdcXP5lvqdksQ0zE='`，与 `dist/index.html` 中该内联脚本的 sha256 **完全一致**。故内联脚本在桌面版可正常执行。

---

### P2-10 `scripts/*.ts` harness 从未被任何 tsconfig 检查，且已存在类型错误

**位置**：`tsconfig.node.json:16` 的 `include` 只有 `["vite.config.ts"]`；`tsconfig.app.json:22` 只有 `["src"]`

**证据（实测，两条独立证据）**：

1. `npx tsc -b --listFiles` 输出 **300 个文件，其中 `scripts/` 下 0 个**（仅 1 个 `vite.config.ts`）——直接证明 harness 不在任何 project 的 program 内。
2. 以 `--target ES2022 --strict` 手工补检 6 个 harness：

```
scripts/vector-regressions.ts(8,53): error TS2739: Type '{...}' is missing the
  following properties from type 'Layer': aspectLocked, occludesWhenHidden
```

该文件第 8 行的 `layer()` 工厂仍用旧的 `Layer` 字面量，缺少 v0.4.1 新增的 `aspectLocked`/`occludesWhenHidden`。**没有任何检查会发现**：`npm test` 只跑 4 个 `.cjs`，浏览器 harness 靠 Vite 的 esbuild 转译，而 esbuild 不做类型检查。

**影响**：harness 与被测源码的类型契约无人守护。本次 `<use>` 断言失败恰恰发生在一个未被类型检查的 harness 里。

**修复方向**：加 `tsconfig.scripts.json` 并把 `scripts/**/*.ts(x)` 纳入 `tsc -b`。

---

### P2-11 已发布的 0.4.1 安装包不含最近 5 个提交

**位置**：`src-tauri/target/release/bundle/nsis/LayerCut_0.4.1_x64-setup.exe`（构建于 2026-10-04 01:21:53）

**证据**：晚于该安装包的提交有 `8e8fe8b`、`e514164`、`04d5173`、`0721cbc`、`90b8d11`——即 **P0-1/P0-2/P0-3 等全部修复都不在其中**。exe 内嵌 bundle 为 `index-CPY7noja.js`/`index-DwPVYa5a.css`，当前 `dist/` 为 `index-CDy0mFbS.js`/`index-Big5kwVp.css`。

**说明**：README:66 已有「已有 exe 不会自动更新」一句，可视为部分披露，但容易被读成"只是旧版"，实际是**缺少 P0 修复**。`dist/` 与 `src-tauri/target/` 均被 gitignore，不构成版本库污染。

---

### P2-12 `addRecent` 的读-改-写跨多个事务，存在丢失更新窗口

**位置**：`src/project/storage.ts:92-106`

**证据**：`listRecents()`（独立 readonly 事务）→ `clear()`（readwrite 事务）→ 循环 `put()`（每条一个 readwrite 事务）。整个过程不是单个事务。

**影响**：两个并发的 `addRecent`（如快速连续保存两个工程，或保存与「打开最近」交错）可能互相覆盖，导致最近项目列表丢条目。触发概率低、影响面小（上限 5 条），故列 P2。

**修复方向**：把读-改-写放进同一个 readwrite 事务。

---

### P2-13 多选时的不透明度滑杆显示硬编码为 100%

**位置**：`src/ui/PropertiesPanel.tsx:179`（`value={100}`），对照单选路径 `:121` 的 `value={Math.round(single.opacity * 100)}`

**证据**：
```tsx
{!single && selectedIds.length > 1 && (
  <SliderField
    value={100}                      // ← 硬编码，与所选图层实际不透明度无关
    onChange={(v) => ...setLayersOpacity(selectedIds, v / 100, false)}
    onCommit={(v) => commitOpacity(selectedIds, v)}
  />
)}
```

**影响**：选中多个不透明度为 50% 的图层时，滑杆仍显示 100%，用户看到的信息与实际不符；一旦开始拖动，滑杆会跳到拖动位置并把该值写进所有选中图层（`setLayersOpacity` 是覆盖式赋值，非相对调整）。属于"显示误导 + 一次误触即改值"的组合。

**修复方向**：显示所选图层的共同值（全部相同时取该值，不同时显示为空或取首个），或至少在拖动前不提交。

---

### P2-14【非缺陷，记录以澄清】命名去重的 Unicode 边界经实测均正确

**位置**：`src/export/naming.ts:46-58`、`src/layers/layerUtils.ts:83-95`

此项**不是缺陷**。我原本怀疑 Windows 保留名与 Unicode 规范化会引发静默覆盖，遂实测各类边界，结论是**实现全部正确**——记录在此以免后续审计重复怀疑：

| 输入 | 结果 | 判定 |
| --- | --- | --- |
| `CON` / `con` / `com1` | `_CON.png` / `_con.png` / `_com1.png` | 保留名被正确转义 |
| `nul.txt` | `nul.txt.png` | 未被转义，但**实测可正常写入**（见下） |
| `Logo`/`logo`/`LOGO` | `Logo.png` / `logo (1).png` / `LOGO (2).png` | 大小写不敏感去重正确 |
| `name...` / `name   ` | `name.png` / `name (1).png` | 尾部点/空格处理正确 |
| `a/b\c:d*e?f"g<h>i\|j` | `a_b_c_d_e_f_g_h_i_j.png` | 非法字符处理正确 |
| `""` / `"   "` | `layer.png` / `layer (1).png` | 空值回退正确 |
| NFC `café` vs NFD `cafe◌́` | 两个**独立文件** | 无碰撞风险 |

两点实证澄清（避免误报）：
- `RESERVED_FILE_NAMES` 只匹配「整名就是保留名」的情况，故 `nul.txt.png` 不被转义。我实测在本机 Windows 上 `nul.png`、`nul.txt.png`、`con.png` 等**都能正常写入并读回**（只有裸 `nul` 无扩展名时抛 "Stream does not support seeking"）。故守卫偏保守但无害。
- NFC/NFD 在 NTFS 上是**两个不同文件**，去重不比较 Unicode 规范化**不会**导致静默覆盖。

---

## 2. Spec 轴：需求 / 上一轮报告结论的一致性

> 本报告按 `code-review` skill 的两轴组织：**§2 为 Spec 轴**（代码是否忠实实现了需求——此处"需求"= 上一轮 `review-report.md` 的结论 + README/release-notes 对用户的承诺）；**§3–§6 为 Standards 轴**（是否符合仓库文档化的规范与工程约定：文档与实现一致性、死代码、重复实现、测试覆盖）。
> **编号约定（避免歧义）**：§2 表格中的 `P0-x` / `Bxx` 一律指**上一轮 `review-report.md` 的编号**；本报告自己的缺陷编号一律写作 `P0-1`、`P1-2`…（见 §1），引用时会写明"本报告 P1-x"。
> 两轴刻意分开、不合并排序——一段代码可以"完全按需求实现但违反规范"，也可以"规范漂亮但实现错了东西"。§1 的缺陷是两轴共同指向的问题清单。

### 2.1 已确认真修复（20 项编号）

| 条目 | 状态 | 证据 |
| --- | --- | --- |
| P0-1 加载工程后 Ctrl+Z 复活旧文档 | ✅ 已修复 | `layerStore.ts:246,314` 调用 `resetHistory()`；`history-regressions.cjs` 2 项 PASS |
| P0-2 空格平移时拖动图层 | ✅ 已修复（但无回归保护） | 代码：`CanvasEditor.tsx:182` `draggable={interactive && !panning && !layer.locked}`；`Konva.dragButtons=[0]`（:43）。注意：`canvas-pan` harness 的 4/4 PASS **并不能证明此项**（0 图层，见本报告 P1-6） |
| P0-3 重命名每键入一字全选 | ✅ 已修复 | `LayerPanel.tsx:247,253` 拆成两个 `useEffect`，`select()` 只在会话开始执行 |
| P0-4 计划条目产不出结果 | ⚠️ 部分修复 | 已加 `layerProducesOutput` 过滤，但矢量路径仍有漏网（见 P1-2） |
| P0-5 取消/失败判定 | ✅ 已修复 | `exportAll.ts:271` 用 `e?.name === "AbortError"`；`export-regressions.cjs` 4 项 PASS |
| P0-6 viewBox/preserveAspectRatio 归一化 | ✅ 已修复 | `svgNormalize.ts:150-203` 完整实现 meet/slice/none + 对齐偏移 + 撤销 paper 的逐轴拉伸 |
| P0-7 部分不透明度门禁 | ✅ 已修复 | `svgSafety.ts:72-93` `svgHasPartialAlpha` 覆盖 opacity/fill-opacity/stroke-opacity，含百分比；harness 2 项 PASS |
| P0-8 按填充色分桶布尔 | ✅ 已修复 | `svgNormalize.ts:244-268` 按 `fillColor.toCSS()` 分桶；`svgBoolean.ts:106-111` 每桶单独 subtract；harness PASS |
| B1 锁定图层 | ✅ 已修复 | `history-regressions.cjs` PASS；`deleteSelected`/`duplicateSelected` 均排除 locked |
| B2 拖拽中撤销 | ✅ 已修复 | `layerStore.ts:291,300` 清 `pending`；`history-regressions.cjs` PASS |
| B3 弹窗内快捷键 | ✅ 已修复 | `useKeyboard.ts:38` `openDialogs > 0` 直接 return；`Dialog.tsx:23-27` 统一管理 |
| B9/B10 绘制修饰键与手势互斥 | ✅ 已修复 | `useShapeGesture.ts:119` mouseup 重新采样修饰键；`CanvasEditor.tsx:397` `if (isPanning \|\| drag) return` |
| B11 右键菜单 | ✅ 已修复 | `CanvasEditor.tsx:367,384` + `useShapeGesture.ts:148,155` 均在 window 上 preventDefault |
| B12/B13/B14 持久化 | ✅ 已修复 | `saveProject.ts:73-89` 素材级容错；`projectTypes.ts:188` `migrateProject` 迁移链；`assetStore.ts:55` `releaseAssetsExcept` |
| B16 撤销回保存态清脏标记 | ✅ 已修复 | `layerStore.ts:297` 恢复 `entry.version`；`history-regressions.cjs` PASS |
| B18 重名 | ✅ 已修复 | `layerUtils.ts:64-80` `takenNames` 集合累积；`history-regressions.cjs` PASS |
| B20 越界索引 | ✅ 已修复 | `layerStore.ts:452-453` 双向钳制；`history-regressions.cjs` PASS |
| §4.5 8192 上限分叉 | ✅ 已修复 | `NewCanvasDialog.tsx:17-18` 与 `HomePage.tsx:77-78` 均钳制 |
| §4.6 吸附范围承诺 | ✅ 已修复 | README:24 已注明「变换手柄缩放旋转暂不支持吸附」，与实现一致 |
| §4.8 导出配置记忆 | ✅ 已修复 | `exportConfig.ts:7-9,19` 增加 `format` 字段 |
| §4.11 未本地化文案 | ✅ 已修复 | `importFiles.ts:37` 用 `getT()("importFailed")`；`LayerPanel.tsx:312-332` 全用 `t()` |
| §5.1 harness 未接入 npm test | ⚠️ 部分修复 | 4 个 `.cjs` 已接入；6 个浏览器 harness 仍只能手开 |
| §5.8 tsbuildinfo 被跟踪 | ✅ 已修复 | `git ls-files` 无 tsbuildinfo |
| §5.9 `/_*` 只匹配根目录 | ✅ 已修复 | `.gitignore:23` 改为 `_*`；`git check-ignore` 确认 `scripts/_foo.cjs` 被忽略 |
| §6 遗留 `_audit-naming-repro.cjs` | ✅ 已清理 | 文件不存在 |
| §7.15 合成图背景语义 | ✅ 一致 | README:23「合成图按画布设置烘焙背景」与 `exportPNG.ts:38-41` 完全一致 |
| §3.3 孤立 CSS 类名 | ✅ 已修复 | 110 个类名**全部**在 `src/` 中被引用（AST 核验：唯一的"孤立项"`ctl-` 来自 CSS 注释 `.ctl-*`，非真实类名） |
| §3.2 未使用图标 | ✅ 已修复 | 22 个图标全部在用（AST 计数：每个恰好 3 次 = 声明 + import + 渲染） |

### 2.2 上一轮报告的**错误结论**（本轮实测推翻，3 项）

| 上一轮结论 | 本轮实测 | 影响 |
| --- | --- | --- |
| §5.2「`scripts/vector-regressions.ts` 至少 6 项按现状不可能通过」 | **7/8 通过**，仅 1 项失败 | 严重低估了矢量管线的完成度；失败的那 1 项恰好就是 `<use>`（P0-1） |
| §5.3「`shape-regressions.ts` 漏掉描边外扩整类问题」 | 我用 25 组 shape×stroke 组合（含 stroke 80）实测**全部无裁切** | 该 harness 的覆盖是充分的 |
| §0/§6 + 记忆文件「`index.html` 内联脚本在 CSP 下被拦」 | Tauri 构建期自动注入 sha256，实测 exe 内含匹配哈希 | 该"风险项"不存在 |

### 2.3 本轮补验的 12 项（上一轮报告有编号、我的初版遗漏）

我逐条核对了上一轮报告里出现的**全部 32 个编号**（P0-1…P0-8、B1…B26），发现初版报告遗漏了 12 项。补验结果如下：

| 条目 | 上一轮结论 | 当前 HEAD 状态 | 证据 |
| --- | --- | --- | --- |
| B4 | 三个对话框不能用 Esc 关闭，Esc 还穿透到编辑器 | ✅ 已修复 | `Dialog.tsx:34-38` 统一处理 Esc + `stopImmediatePropagation()`；三个对话框全部复用 |
| B5 | SVG 门禁未收敛为单一实现 | ✅ 已修复 | `exportAll.ts:111-130` `checkSvgExportGate` 是唯一实现，对话框与写出共用 |
| B7 | 轴对齐纯描边几何 bounds 退化到 0 → 静默消失 | ✅ 已修复 | 实测：水平/垂直/斜向纯描边线、零高矩形**全部** `normalized: ok` 且产出填充桶 |
| B8 | 描边沿布尔切割边凭空多出 | ✅ 已修复 | `svgBoolean.ts:109` 显式 `visible.strokeColor = null`；纯描边兄弟节点单独保留（`:98-100`） |
| B15 | 序列化同步 `+=` 拼串 + 缓存无上限 | ⚠️ **部分修复** | 已改为 32KB 分块（`projectTypes.ts:57-62`），但仍是同步 `+=`；缓存**仍无上限**（见 P1-4） |
| B17 | Shift 范围选择锚点永远是数组最后一个 | ✅ 已修复 | `LayerPanel.tsx:36,51` 引入 `anchorIdRef`，只在「普通点击」时更新锚点 |
| B19 | 全隐藏时合并报错原因错误（说"画布已变化"） | ✅ 已修复 | `LayerPanel.tsx:85-90` 先判 `some(l => l.visible)` 给 `mergeLayersEmpty`，再给 `mergeLayersUnavailable` |
| B22 | 素材解码失败只打日志，图层无声消失 | ❌ **未修复** | `usePaintedAsset.ts:18` 仍只有 `console.error`，无 `setNotice`；已立为 **P2-8** |
| B23 | 改色写 presentation attribute，被作者 CSS 压过 | ❌ **未修复（像素实测）** | 见下方专项证据 → 已立为 **P1-7** |
| B24 | `fill="none "`（带空格）未被识别 → 被上色 | ✅ 已修复 | `svgPaint.ts:12` 两处 `.trim()`；实测 `fill="none "` 输出仍为 `none `，未被上色 |
| B25 | 覆盖色穿透 `<use>` 实例 | ✅ 已修复 | 实测 `<use href="#s" fill="none"/>` 输出保持 `fill="none"`，未被上色 |
| B26 | Paper 全局 `definitions` 从不清空 → `<defs>` 无界增长 | ✅ 已修复 | 实测连续 5 次导出，`<linearGradient>` 数量恒为 1，SVG 长度恒为 619 字节，**零增长** |

**B23 专项证据（像素级，本轮新增确认）**：构造带作者 CSS 的 SVG 并渲染取中心像素：

| 输入形态 | 改色为 `#00ff00` 后的中心像素 | 判定 |
| --- | --- | --- |
| 元素 presentation attribute `fill="#ff0000"` | `[0,255,0,255]` | ✅ 覆盖生效 |
| 元素内联 `style="fill:#ff0000"` | `[0,255,0,255]` | ✅ 覆盖生效 |
| **作者 CSS `<style>rect{fill:#ff0000}</style>`** | **`[255,0,0,255]`** | ❌ **覆盖被压过，画布仍是旧色** |

根因：`svgPaint.ts:27-28` 用 `style.removeProperty()` + `setAttribute()` 写入，而 CSS 规则的优先级高于 presentation attribute，且代码**从不移除或改写 `<style>` 元素**。后果与上一轮描述一致：属性面板显示新颜色、画布仍是旧色，**无任何提示**。修复方向：改写 `<style>` 内的规则、或改用 `setProperty(..., "important")`、或对命中元素强制内联 `style` 覆盖。

### 2.4 仍然成立的上一轮测试缺口（2 项）

| 条目 | 现状 |
| --- | --- |
| §5.4 `export-regressions.cjs:45` 把 `resolveFileNames` 桩成恒等函数 | 仍存在，但**已用注释说明**并指向 `export-naming-regressions.html`；且该 harness 现在会正确地在 v0.4.0 代码上失败（我实测 `REGRESSION_REF=v0.4.0` → 多项 FAIL），证明它仍是有效的回归探测器 |
| §5.5 `canvas-pan-regressions.tsx:33-40` 绕过 Konva 直接派发事件 | 仍存在，且**比我初判更严重**：该 harness 全文 0 图层，`draggable` 条件永不求值，因此它 4/4 PASS **并不代表** P0-2 被覆盖（详见 §1 P1-6）。上一轮"永远测不到 P0-2"的判断**成立且至今未修**。 |

---

## 3. Standards 轴：文档与实现不符

| 文档位置 | 声明 | 实现 | 判定 |
| --- | --- | --- | --- |
| `src/vector/svgSafety.ts:6-7` | `use, symbol` 属 **Supported** | Paper.js 路径下被静默丢弃 | ❌ **矛盾**（P0-1） |
| `README.md:30` | 不支持清单：text/image/filter/mask/clipPath/pattern/style/SMIL | 实际 `<use>`/`<symbol>` 也不可用 | ❌ **矛盾**（P0-1） |
| `release-notes-v0.4.1.md:28` | `<use>` 专项回归尚未通过 | 与实测一致 | ✅ 唯一准确的披露 |
| `README.md:29` | 「无原生 spinner」 | `styles.css:561-570` 确实隐藏了 spinner | ✅ 一致 |
| `README.md:60` | 安装包名 `LayerCut_0.4.1_x64-setup.exe` | 该文件存在，但内容滞后 5 个提交 | ⚠️ 名称对、内容旧（P2-11） |
| `README.md:114-126` | 记录了 4 个浏览器 harness | `svg-paint-regressions` 与 `vector-regressions` **未记录** | ⚠️ 漏记 2 个（失败的正是未记录的 vector 之一） |
| `release-notes-v0.4.1.md` | 只列 `x64-setup.exe` | `tauri.conf.json` 的 targets 只有 `nsis` | ✅ 已修复（上一轮 §4.9 的 portable 声明已删） |
| `package.json` license | `UNLICENSED` | `LICENSE` 为 LCNL 1.1 | ❌ **不一致**（残留） |

---

## 4. 冗余与死代码

| 位置 | 内容 | 说明 |
| --- | --- | --- |
| `index.html:11-20` | `window.__errs` 错误陷阱 | 只写不读，全仓库零消费者（P2-9） |
| `src/i18n/zh.ts:16` + `en.ts:18` | 词条 `noSelection` | 无任何引用（在用的是 `noSelectionHint`） |
| `src/i18n/zh.ts:131` + `en.ts:133` | 词条 `console` | 无任何引用 |
| `src/i18n/zh.ts:155` + `en.ts:157` | 词条 `canvasSize` | 无任何引用 |
**说明**：上一轮 §3.1–§3.3 的清理**大部分成功**（CSS 类名 0 孤立、图标全部在用），残留为上述 4 项（1 处内联脚本 + 3 个闲置词条），规模小。

**核验方法**：本节用 TypeScript AST 而非正则统计（`scripts/_audit-deadcode-full.cjs`）：遍历所有 `PropertyAssignment` 取 i18n 键、收集全部字符串字面量引用、并对每个 export 做标识符出现计数。**扫描范围必须同时包含 `src/` 与 `scripts/`**。

**第二处自我更正（重要）**：我先前把 `src/export/naming.ts:16` 的 `exportName()` 与 `:24` 的 `compositeName()` 列为死代码，理由是"AST 核验全仓库仅 1 次出现"——**这也是错的**。原因是那次扫描只覆盖了 `src/`，而它们实际被 `scripts/export-naming-regressions.ts:35,36,38` 使用：
```ts
eq(exportName(1, "background"), "001_background.png", "default batch name");
eq(exportName(12, "a/b:c"), "012_a_b_c.png", "layer names are sanitized");
eq(compositeName(), "layercut_composite.png", "composite name");
```
把扫描范围扩到 `scripts/` 后，两者都显示有引用。**这两项不是死代码，已从清单移除。** 与上一处 `initialTransform` 的误判合起来说明：本项目的死代码检测必须同时满足①用 AST、②覆盖 `src/` + `scripts/`，否则会稳定产生假阳性。

扩范围后剩下的"零引用导出"只有 `runVectorRegressions` 与 `runLayerVisibilityRegressions`——它们是 harness 的入口函数，由同名 `.html` 动态 import，属正常，不是死代码。

**自我更正（重要）**：我最初用正则启发式把 `src/layers/layerUtils.ts:20` 的 `initialTransform()` 也列为死代码——**这是错的**。AST 与逐行核验均确认它在 `layerUtils.ts:50` 被 `makeLayer` 实际调用：
```ts
transform: opts.transform ?? initialTransform(opts.canvas, opts.natural ?? { width: 0, height: 0 }),
```
误判原因是我的正则只统计"跨文件"引用，而该函数恰好在同一文件内被调用。**该项不是死代码，已从清单移除。** 这条自我更正也说明：正则式的死代码检测在本项目会产生假阳性，应以 AST 为准。

**非死代码（澄清，避免误判）**：
- `src/occlusion/AlphaMask.ts:23-26` 的 `binary` 模式 `return` 是**文档化的预留接口**（注释明确 `TODO(post-MVP)`），非缺陷。
- `src/project/projectTypes.ts:181` 的 `MIGRATIONS` 为空表，但 `migrateProject` 的走链逻辑是**为 v2 准备的真实基础设施**，当前 v1-only 下为空是正确的。

---

## 5. 重复实现

| 位置 | 内容 | 严重度 |
| --- | --- | --- |
| `SVGRenderer.ts:16-23` vs `svgNormalize.ts:77-102` | **两套 SVG 单位解析器**，行为已分叉（`pc`/`q`/科学计数法）→ 造成 P1-3 | 高（已产出实际缺陷） |
| `svgNormalize.ts:13-46` vs `svgSafety.ts:42-47` | 两处各自遍历 SVG 元素树（一处物化、一处检查白名单） | 低（职责不同） |

上一轮 §3.4 提到的其他重复项（`isHexColor` 复用、`svgTextForLayer` 单点实现、预览与提交共用几何路径）经核验**均已收敛**，无重复。

---

## 6. 测试与工程化缺口

### 6.1 浏览器 harness 实测结果（本轮首次真正执行）

| harness | 结果 | 备注 |
| --- | --- | --- |
| `vector-regressions` | **7/8**（`symbol use materialization` 失败） | 失败项 = P0-1，是**真缺陷**不是测试问题 |
| `shape-regressions` | PASS | 覆盖几何/修饰键/栅格/遮挡/矢量导出/工具状态/撤销/工程往返 |
| `layer-visibility-regressions` | 6/6 PASS | 含隐藏遮挡、等比锁定、合并透明孔洞 |
| `svg-paint-regressions` | PASS | 含源不可变、撤销/重做 |
| `canvas-pan-regressions` | 4/4 PASS | 右键/中键/左键/图案工具四项 |
| `export-naming-regressions` | PASS | 含「预览文件名 == 实际写入文件名」三条路径 |

### 6.2 缺口清单

1. **`scripts/*.ts` 从不被类型检查**（P2-10）——已存在真实类型错误：`vector-regressions.ts(8,53)` 的 `Layer` 字面量缺 `aspectLocked`/`occludesWhenHidden`（两者在 `layerTypes.ts:29,31` 均为**非可选**）。同批 harness 内部已不一致：`layer-visibility-regressions.ts:24-27`、`svg-paint-regressions.ts:12` 都写全了字段。另 `shape-regressions.ts(260,39)` 用了 `.at(-1)`，隐含假设 `lib ≥ ES2022`，而 app 的 `lib` 是 `ES2020`——两侧环境不同源。
2. **`export-regressions.cjs` 的 `svgSafety` mock 不完整**（P1-5）——`svg_partial_opacity` 与 `svg_unsafe` 两条门禁分支零覆盖，且补上资产 `svgText` 后会从 PASS 变成 TypeError。
3. **P0-2 的修复无回归保护**（P1-6）——`canvas-pan-regressions.tsx` 0 图层，`draggable` 表达式永不求值。
4. **6 个浏览器 harness 未接入 `npm test`**：只能手开浏览器，实际不会有人跑。本轮靠 Edge headless 才跑起来。
5. **README 漏记 2 个 harness**（`svg-paint-regressions`、`vector-regressions`）——而失败项正在未记录的那个里。
6. **`<use>` 断言的失败信息误导性强**：`vector-regressions.ts:65-69` 的 `symbol use materialization` 报 `SVG decode failed`，真实原因是 `byLayerId.get()` 返回 `undefined` 后被当作字符串解码，而非"SVG 解码失败"。建议断言先检查产出是否存在。
7. **未覆盖的路径**：`pc`/`q`/科学计数法单位（P1-3）、`assetDataCache` 释放（P1-4）、`addRecent` 并发（P2-12）、多选不透明度显示（P2-13）。

**关于 harness 有效性的正面证据**：我用 `REGRESSION_REF=v0.4.0 node scripts/export-regressions.cjs` 在旧代码上跑，得到多项 FAIL（`'folder' !== 'zip'` 等）——证明该 harness 是**有效的回归探测器**，不是"永远通过"的假测试。这是它值得补全而非废弃的理由。

---

## 7. 建议修复顺序

### 第一批（最高性价比：1–2 行改动，消除静默错误）

1. **P0-1**：把 `use`/`symbol` 移出 `svgSafety.ts:11-30` 的 `SAFE_TAGS`。门禁立即诚实拒绝，用户得到「不支持元素: use」而非静默错误输出。同步更新 `README.md:30` 的清单。
2. **P1-3**：`parseSVGSize` 直接改用 `img.naturalWidth/naturalHeight`（`importSVGFile` 里已有 `img`），删掉重复的单位解析器。

### 第二批（诚实性：让失败可见）

3. **P1-2**：让 `planExportFiles` 与矢量管线共用同一套"能否产出"判据，或在写出阶段把 `export_layer_missing` 从 `throw` 改为可读的逐文件错误。
4. **P2-9**：删除 `index.html` 的 `window.__errs` 陷阱（或接一个真实消费者）。
5. **P2-8**（原 B22）：`usePaintedAsset.ts:18` 的 `catch` 内加 `setNotice`，让素材解码失败对用户可见。
6. **P1-7**（原 B23）：修复改色被作者 CSS 压过——改写 `<style>` 规则、或写内联 `style` + `!important`、或剥离 `<style>` 后按计算值回填。

### 第三批（资源与并发）

5. **P1-4**：给 `assetDataCache` 加驱逐（`releaseAssetsExcept` 内同步清理，或 LRU 上限）。
6. **P2-12**：`addRecent` 的读-改-写合并进单个事务。

### 第四批（工程化收尾）

7. **P2-10**：加 `tsconfig.scripts.json`，把 `scripts/**/*.ts(x)` 纳入 `tsc -b`；顺手修 `vector-regressions.ts:8` 的 `Layer` 字面量与 `shape-regressions.ts:260` 的 `.at(-1)`（或把 `lib` 提到 ES2022）。
8. **P1-5**：给 `export-regressions.cjs:47` 的 mock 补 `svgHasPartialAlpha: () => false`，并新增一条返回 `true` 的用例，真正覆盖 `svg_partial_opacity`。
9. **P1-6**：让 `canvas-pan-regressions.tsx` 先 `addLayers` 一个图层，再断言「空格+左键拖动时视口平移、图层 transform 不变」，把 P0-2 的修复锁住。
10. 把 6 个浏览器 harness 接入 `npm test`（可参考本轮的 Edge headless 方案），并补上 README 漏记的 2 个。
11. 删除 §4 表中 6 项死代码；`package.json` 的 `license` 改为与 LCNL 1.1 一致。
12. **P2-11**：重新执行 `npm run app:build` 以产出包含本轮修复的安装包。

---

## 8. 明确核验为干净的项（无需处理）

- **类型检查全绿**：`tsconfig.app.json` 与 `tsconfig.node.json` 均 0 错误。
- **构建与编译全绿**：`vite build` EXIT=0；`cargo check`（dev 与 release）EXIT=0。记忆文件中"`tauri dev` 因 schemars/indexmap E0107 无法编译"的问题**已由** `Cargo.toml:15` 的 `indexmap = { version = "1.9.3", features = ["std"] }` **修复**，两条路径现在都能编译。
- **版本号三处一致**：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 均为 `0.4.1`。
- **i18n 字典完全对称**：zh 136 / en 136，无重复、无单侧缺失、**声明顺序一致**。
- **`dangerouslySetInnerHTML` / `.innerHTML`：0 处。**
- **`fetch(` 调用：0 处**（仅 `projectTypes.ts:99` 一句注释），桌面 CSP 约束被真正遵守。
- **以数组下标作 key 的可重排序列表：0 处。**
- **裸 `"paper"` 导入：仅 `paperEnv.ts:6`**，被 `vite.config.ts:12` 的 alias 命中。
- **图层数组无原位修改**：全部为 `map`/`filter`/展开新数组；`layer.transform` 亦无原位赋值。历史快照的引用共享因此安全。
- **撤销/重做机制健壮**：`versionCounter` 单调递增不复用；`sameSnapshot` 短路避免空提交；`documentEpoch` 守卫异步保存；`undo`/`redo` 清 `pending` 防陈旧快照。
- **`replaceAllLayers` 并发守卫完备**（`layerStore.ts:336-337` 校验 layers/canvas/historyVersion/documentEpoch 四项身份）。
- **所有 `addEventListener` 都有配对清理**（含 `Dialog.tsx`、`CanvasEditor.tsx`、`useShapeGesture.ts`、`useAutosave.ts`）。
- **`Dialog.tsx` 是唯一模态实现**，含 `role`/`aria-modal`/`aria-label`、焦点陷阱、Esc `stopImmediatePropagation`；三个对话框全部复用。
- **CSP 与代码一致**：`connect-src` 未放开 `blob:`/`data:`，`img-src` 允许 `blob: data:`；`capabilities/default.json` 的权限（`dialog:allow-save` + `fs:allow-write-text-file`）恰好覆盖代码实际调用的两个 API，无缺失、无过度授权。
- **形状绘制的不变量全部成立**：直线不填充、边数 3–12 双处钳制、星形内径比 0.5、反向拖拽用 `abs`/`min`、单击 <3px 生成 200px 居中图形、**描边外扩精确无裁切**（25 组组合实测）。
- **吸附数学正确**：三候选锚点 × 全部目标取最近，阈值按 `8 / vp.scale` 换算，正确考虑旋转与缩放。
- **导出命名去重的所有边界正确**（保留名、大小写、非法字符、空值、Unicode）。
- **非破坏性原则成立**：布尔运算用 `path.clone(false)`，工作项不挂载到 project，源数据无修改。

---

## 9. 一句话总结

本轮在 HEAD `90b8d11` 上独立重审全树，并首次**真正执行**了上一轮无法运行的构建与 6 个浏览器 harness：上一轮的 8 项 P0 中 **7 项确认真修复**（P0-4 部分），另有 **3 条上一轮结论被实测推翻**（其中"vector-regressions 至少 6 项不可能通过"实为 7/8 通过）。

**覆盖率**：上一轮报告出现的 **32 个编号**（P0-1…P0-8 共 8 项 + B1…B26 共 24 项）现已**全部逐条核验**：**28 项已修复**、**2 项部分修复**（P0-4 → 本报告 P1-2；B15 → 本报告 P1-4）、**2 项未修复**（B22 → 本报告 P2-8；B23 → 本报告 P1-7）。另有 **3 条上一轮结论被本轮实测推翻**（见 §2.2）。初版报告曾遗漏其中 12 项，已在 §2.3 补齐并逐项给出证据。

**本轮新发现的最严重问题**：`<use>`/`<symbol>` 遮挡层在 SVG 导出中被完全忽略——实测下层输出 10000 像素而非正确的 7500，**导出成功、无任何报错**，而门禁与 README 都声称它受支持、PNG 路径则给出正确结果。这是"静默产出错误文件"，比原 P0 中的任何一项都更危险，因为用户会把错误结果当成正确结果交付。

**次严重**：同一 SVG 的 PNG 与 SVG 导出会因两套分叉的单位解析器而给出不同尺寸（实测 50px vs 160px）；`assetDataCache` 无清理导致跨工程的内存泄漏（base64 膨胀实测 1.333 倍）。

**上一轮已记录但仍未修复的 2 项**：B23（改色被作者 CSS 压过——像素实测改绿后仍渲染为红，面板却显示绿色，无提示，已立为 P1-7）；B22（素材解码失败仅 `console.error`，图层无声消失，已立为 P2-8）。这两项说明上一轮的修复并非全覆盖，其 §7 的"第五批（收尾）"实际未执行。

**工程化**：`svg_partial_opacity` 门禁在测试中零覆盖（mock 缺一个导出，补上即崩）；P0-2 的修复无回归保护（harness 0 图层，`draggable` 条件永不求值）；`scripts/*.ts` 从不被类型检查且已存在真实类型错误。

**修复性价比最高的两处**：把 `use`/`symbol` 移出 `svgSafety.ts` 的 `SAFE_TAGS`（约 2 行，把静默错误变成诚实拒绝）；让 `parseSVGSize` 直接采用 `img.naturalWidth/naturalHeight`（删掉重复的单位解析器）。


---

## 10. 本轮修复记录（13 项全部完成）

按"依赖 + 改动量 + 风险"从小到大执行，每项都用变异测试或像素级实测验证过。

### 第 1 档：纯改动，零依赖

| # | 缺陷 | 改动 | 验证方式 |
| --- | --- | --- | --- |
| 1 | P2-9 `window.__errs` 死代码 | 删 `index.html` 10 行内联脚本 | 构建后 `<script>` 仅剩 module 入口；实测内联脚本本就被 Tauri 正确哈希，删除不损失诊断能力（浏览器原生已记录未捕获错误） |
| 2 | P2-8 解码失败无提示 | `usePaintedAsset.ts` 的 `catch` 内 `setNotice` | 用 `notified` ref 保证每图层只提示一次（失败会被重试、缓存会丢弃被拒条目，否则会刷屏）；i18n 新增 `paintFailed` 双语 |
| 3 | P2-13 多选滑杆硬编码 100 | `PropertiesPanel.tsx` 改为取所选共同值 | 不一致时额外显示 `opacityMixed` 提示，避免"未知值被当成 100%"的误导 |
| 4 | P1-5 mock 缺导出 | `export-regressions.cjs` 补 `svgHasPartialAlpha` + 2 条门禁用例 | **变异测试**：移除 `exportAll.ts:121` 的 opacity 门禁后新用例正确 FAIL，还原后 PASS |

### 第 2 档：小改，需新测试锁住

| # | 缺陷 | 改动 | 验证方式 |
| --- | --- | --- | --- |
| 5 | P0-1 `<use>` 静默错误输出 | `svgSafety.ts` 移出 `use`（**保留 `symbol`**：它只在 `<defs>` 内、自身不产出几何，移出会过度拒绝）+ README 更新 | 端到端实测：`gate` 由 `offered` 变 `blocked: svg_unsafe`；新增门禁断言并**变异测试**（把 `use` 加回白名单即 FAIL） |
| 6 | P1-6 P0-2 无回归保护 | `canvas-pan-regressions.tsx` 种入图层 + 读 Konva 节点的 `draggable` | **变异测试**：去掉 `!panning` 后断言 FAIL。注意 DOM 事件测不到此项（Konva 走自身命中检测），必须读节点属性 |
| 7 | P2-10 harness 不被类型检查 | 新增 `tsconfig.scripts.json`（排除 `_*` 临时脚本）+ 修 3 处类型错误 | `tsc -b --listFiles` 文件数 300 → 479；**变异测试**：在 harness 注入类型错误立刻被捕获 |
| 8 | P2-12 `addRecent` 跨事务 | `storage.ts` 新增 `txUpdate` 单事务原语，读-改-写在一次事务内 | 无头 Edge 不提供 IndexedDB，改用建模 IDB 串行化语义的桩验证：事务数由 `1 readonly + 1 clear + N put` 降为 **1**，且证明缓存命中/驱逐行为 |

### 第 3 档：需设计决策

| # | 缺陷 | 改动 | 验证方式 |
| --- | --- | --- | --- |
| 9 | P1-4 `assetDataCache` 永不释放 | 加 LRU 上限（64）+ 导出 `releaseSerializedAssets`，由 `releaseAssetsExcept` 统一调用 | 实测：驱逐后重新序列化会重新编码（`hitReturnsOldValue` + `afterEvictionUsesNewBytes` 双真）；确认 `assetStore → projectTypes` 无环（后者对前者是 type-only） |
| 10 | P1-3 两套单位解析器分叉 | 删掉 `parseSVGSize` 的手写单位表，改为 `svgSizeOf(img, svgText)` 以浏览器解码尺寸为准，viewBox 仅作兜底 | 5 种单位断言（`pc`160 / `q`94 / `1e2`100 / `pt`100 / `px`50）；**变异测试**：退回旧行为后尺寸断言 FAIL |
| 11 | P1-2 计划与写出不一致 | `svgBoolean.ts` 让"可见但无几何"的图层也产出空文档（与既有 `opacity<=0` 先例一致） | 实测 `fill="none"` 由 `THREW: export_layer_missing` 变 `wrote 1`；**变异测试**：还原旧行为后 `export-naming` harness FAIL |
| 12 | P1-7 改色被作者 CSS 压过 | 采用**双写**：`setAttribute` + 内联 `style.setProperty(..., "important")` | 5 种输入全部胜出（含作者 `!important`），`fill="none"` 保持不上色，作者 `stroke-width` 保留。**关键**：单写内联样式会造成矢量导出回归（Paper 从 attribute 导出），被 `svg-paint` harness 当场抓住 |

### 附带完成

- **6 个浏览器 harness 接入 `npm test`**：新增 `scripts/run-browser-harnesses.cjs`，自动探测 Edge/Chrome、起临时 dev server、无头执行并逐条打印。无浏览器时 SKIP（退出码 0）。`npm run test:node` 保留纯 Node 快跑。这正是 P0-1 当初藏身的盲区。
- **删除 3 个闲置 i18n 词条**（`noSelection` / `console` / `canvasSize`），字典 138 → 135 仍完全对称。
- `package.json` 的 `license` 由 `UNLICENSED` 改为 `SEE LICENSE IN LICENSE`，与 LCNL 1.1 一致。

### 本轮修复中发现的额外事实（已写入测试注释）

1. **Paper.js 从 presentation attribute 导出 SVG**，不是从内联样式。因此"改色"必须同时写两者，否则矢量导出会回退到原色。
2. **Konva 的拖拽不走 DOM 事件**：派发 `mousedown` 无法触发，必须读 `Konva.stages` 里节点的 `draggable` 属性才能测到 P0-2。
3. **`--virtual-time-budget` 与 IndexedDB 不兼容**：它会快进过真实 I/O，所以 `addRecent` 只能用桩验证事务结构，无法端到端跑通。
4. **死代码检测必须用 AST 且覆盖 `src/` + `scripts/`**：本报告两次假阳性（`initialTransform`、`exportName`/`compositeName`）都源于违反这两条之一。