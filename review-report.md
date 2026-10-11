# LayerCut 全量审查报告

- **项目**：`F:\draw`（LayerCut v0.4.1，Tauri 2 + React 18 + TypeScript + Konva + Paper.js + zustand）
- **范围**：`src/`（约 7,100 行 / 90 个文件）、`src-tauri/`、`scripts/`、`fixtures/`、构建与文档配置
- **方法**：六个子系统并行静态审查（layers / editor / export / project+import+tauri / vector+shapes / UI+i18n），所有高严重度结论**逐条回读源码复核**，关键结论对照第三方库源码（`node_modules/konva`、`node_modules/paper`）确认
- **日期**：本次会话

---

## 0. 验证基线（实际执行过的命令与结果）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 应用侧类型检查 | `npx tsc -p tsconfig.app.json --noEmit` | ✅ 0 错误 |
| 构建脚本类型检查 | `npx tsc -p tsconfig.node.json --noEmit` | ✅ 0 错误 |
| 导出保存方式回归 | `node scripts/export-regressions.cjs` | ✅ 6/6 PASS |
| 工程读写回归 | `node scripts/project-regressions.cjs` | ✅ 11/11 PASS |
| PNG 原始字节回归 | `node scripts/project-blob-regressions.cjs` | ✅ PASS |
| 导出命名去重（对抗性模糊测试，7,371 组输入序列） | 临时 harness | ✅ 未发现重名，`resolveFileNames` 逻辑正确 |
| Web 构建 | `npx vite build` | ⚠️ 被沙箱管道限制拦截（`spawn EPERM`，`esbuild` 需要管道 stdio），**非项目缺陷** |
| 浏览器端 harness（`scripts/*.html`） | 需 dev server | ⚠️ 本会话无法执行，相关结论为静态验证并已标注 |

**结论性事实**

- 版本号一致：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 均为 `0.4.1`，与 README 中的安装包名 `LayerCut_0.4.1_x64-setup.exe` 吻合。
- 桌面 CSP 与代码一致：`connect-src` 未放开 `blob:`/`data:`，`img-src` 允许 `blob: data:`；`src/` 中不存在 `fetch(` 调用（仅有注释），"不用 `fetch(blob:)`/`fetch(data:)`"这条约束被真正遵守。
- zh/en 词典完全对称：138/138 键，无单侧缺失、无重复、声明顺序一致。**这一项是干净的。**
- `src/` 中不存在 `dangerouslySetInnerHTML`、不存在缺少 `key` 的 `map`、不存在以数组下标作 key 的可重排序列表。
- `src/` 中不存在对 `layers` / `layer` 的原位（in-place）修改，因此历史快照的引用共享今天不会出错（但见 §3.4，该保证只靠约定）。
- `paper` → `paper-core` 的映射有效：`src/` 中仅两处裸 `"paper"` 导入，均被 `vite.config.ts` 的别名命中，不会有 `paper-full` 的 PaperScript 初始化把首页弄黑。

**统计**

| 类别 | 数量 |
| --- | --- |
| BUG（已确认，含代码级复核） | 35（P0 组 8 项 + 其余 27 项） |
| 未达预期 / 文档与实现不符 | 11 |
| 冗余（死代码、死导出、死样式、闲置词条） | 20+ |
| 重复实现 | 12 |
| 测试与工程化缺口 | 9 |

---

## 1. 严重缺陷（P0）

以下 8 项均已回读源码复核；标注 ✅ 的为"结论不依赖运行时"的确定性缺陷。

### P0-1 打开工程后 Ctrl+Z 会把上一个工程的图层"撤销回来" ✅

**位置**：`src/layers/layerStore.ts:231-234`

```ts
loadProject: ({ canvas, layers, name }) => {
  commitSet((s) => ({ canvas, layers, selectedIds: [], documentEpoch: s.documentEpoch + 1 }));
  set({ projectName: name, savedVersion: get().historyVersion, activeTool: "select" });
},
```

`history` 是模块级单例（`layerStore.ts:34-38`），`loadProject` 走 `commitSet`，于是**当前文档被整体压入撤销栈**，而加载新文档时**从不清空历史**。

**后果**

1. 打开工程 B 后按一次 Ctrl+Z → 图层与画布尺寸变回工程 A，但工程名仍是 B。
2. 此时 `savedVersion === historyVersion`（`:233`），**未保存标记 ● 不亮**；用户按 Ctrl+S 会把 A 的内容写进 B 的文件名。
3. `newCanvas`（`:284-285`）同样走 `commitSet`，可"撤销"回被替换掉的整个画布内容。
4. `documentEpoch` 的语义（文档身份切换）与"沿用旧历史"直接矛盾。

**为何现有测试测不到**：`scripts/project-regressions.cjs` 用自建 state mock 替换了真实 store，从不碰真实历史栈。

**修复**：加载/新建文档时清空 `history.past`、`history.future`、`history.pending`，并把该动作做成 store 内部的 `resetHistory()`。

---

### P0-2 Space+拖拽 / 中键拖拽平移时会连带拖动光标下的图层 ✅

**位置**：`src/editor/CanvasEditor.tsx:53`、`:172-173`

```ts
const interactive = useEditorStore((s) => s.previewMode === "normal" && s.activeTool === "select");
// ...
draggable={interactive && !layer.locked}
```

`draggable` 完全没有考虑 `spaceHeld` / `isPanning`。Konva 的拖拽由它**自己在节点 mousedown 上发起**，不经过 React 层：

- `node_modules/konva/lib/Node.js:1303-1305`
  ```js
  this.on('mousedown.konva touchstart.konva', function (evt) {
    const shouldCheckButton = evt.evt['button'] !== undefined;
    const canDrag = !shouldCheckButton || Konva.dragButtons.indexOf(evt.evt['button']) >= 0;
  ```
- `node_modules/konva/lib/Global.js:45` → `dragButtons: [0, 1]`

因此：**中键（button 1）会启动图层拖拽**，而 `CanvasEditor.tsx:341` 的中键平移同时在跑；**Space+左键**同理（button 0）。

唯一的防线 `CanvasEditor.tsx:63`：

```ts
if (isPanning || e.evt.button !== 0) return;
```

只挡了"选中"语义，既拦不住 Konva 的内部拖拽，而且它在容器 handler（`:344`）设置 `isPanning` **之前**执行。

**后果**：视图平移的同时图层被移动（每帧写 store，并因 `beginTransaction` 产生一步历史）。

**为何现有测试测不到**：`scripts/canvas-pan-regressions.tsx:27-29` 直接把 mousedown 派发到 `.canvas-area`，绕过了 Konva；且该 harness 挂载 CanvasEditor 时图层数为 0，根本没有可拖拽节点。

**修复方向**：把 `spaceHeld`/`mousePanning` 传入 `LayerNode` 并纳入 `draggable`；对中键情形限制节点 `dragButtons`；不要依赖 `isPanning` 做防线。

---

### P0-3 双击重命名输入框每敲一个字符就被全选，实际只能留下最后一个字符 ✅

**位置**：`src/layers/LayerPanel.tsx:250-254`

```tsx
ref={(el) => {
  inputRef.current = el;
  el?.focus();
  el?.select();
}}
```

内联箭头函数 ref 每次 render 都是**新身份** → React 每次 commit 都 detach/attach → 每次都重跑 `focus() + select()`。而输入触发 `onChange` → `setNameDraft` → 重渲染 → 再次全选 → 下一个字符覆盖全文。

**后果**：输入 `abc` 最终只剩 `c`。README §图层系统承诺"重命名（双击）"，实际不可用。

**修复**：改为真实 `useEffect(() => { if (renaming) inputRef.current?.select(); }, [renaming])`；连带可删除只写不读的 `inputRef`（见 §3.1）。

---

### P0-4 空图层 / 0% 不透明度图层会从导出中静默消失，但对话框报告"已导出" ✅

**链路**

1. 导出计划只按 `visible` 过滤 —— `src/export/exportPNG.ts:70-74`
   ```ts
   return layers.map((layer, index) => ({ layer, index })).filter(({ layer }) => layer.visible);
   ```
2. 但 `byLayerId` 只收录**栅格化成功**的图层 —— `src/occlusion/OcclusionEngine.ts:49-51`
   ```ts
   const raster = rasterizeLayer(layer, asset, W, H, scale);
   if (!raster) continue;
   ```
   而 `src/renderer/RasterRenderer.ts:17`
   ```ts
   if (!asset || !isLayerOccluder(layer) || layer.opacity <= 0) return null;
   ```
3. 写出循环静默跳过 —— `src/export/exportAll.ts:159-166`
   ```ts
   const raster = occlusion.byLayerId.get(file.key);
   if (!raster) continue;
   ```

**UI 中可达的触发方式**

- 新增空白图层（`LayerPanel.tsx:95` → `layerStore.ts:301-316`，`type:"empty"`, `assetId:null`, `visible:true`）
- 把可见图层的不透明度拉到 0%（`PropertiesPanel.tsx:122`，`min={0}`）
- 图层 `assetId` 悬空

**后果**：预览列表里有 `00N_xxx.png`，实际**不写这个文件**，对话框显示"已导出 ✓"并自动关闭（`ExportDialog.tsx:100-105`）。SVG 路径同样（`exportAll.ts:202-204`）；当**所有**条目都落空时，`exportAll.ts:212` 会抛出语义错误的 `svg_unsafe`，被对话框渲染成"SVG 矢量导出不适用于合成图"。

这直接违反 README 设计说明中明确承诺的：**「所以改名和自动 (1) 不可能出现「预览与实际写出的文件不一致」」**。

**修复**：在计划阶段就过滤掉产不出结果的条目（或写出时缺失即抛错/提示），不要在写出循环里 `continue`。

---

### P0-5 写文件失败被静默降级成 ZIP 下载并报告成功 ✅

**位置**：`src/export/exportAll.ts:231-242`

```ts
try {
  await saveViaFolder(dir, files);
  return "folder";
} catch (e) {
  if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
  console.warn("Folder picker failed, falling back to ZIP", e);
}
```

`try` 的范围**包住了实际写入**，`catch` 只识别 AbortError，其余一律降级为 ZIP。于是"磁盘满 / 权限被撤 / 非法文件名 / 配额超限"这类**写入期**错误被当成"选择器失败"，转成一个完整 ZIP 下载并返回成功——而目标文件夹里已经留下半截文件。

同一行还有一个方向相反的问题：`e instanceof DOMException` 是**跨 realm 不安全**的类型检查，而"取消不算成功"这条承诺（README 与 `export-regressions.cjs:81-85`）只依赖它。

**修复**：把 `try` 收窄到选择器调用本身；取消判定改用 `e?.name === "AbortError"`；写入期错误应当直接失败并上报。

---

### P0-6 矢量导出几何与预览/PNG 不一致（按内容包围盒而非 viewBox 归一化）🔍

**位置**：`src/vector/svgNormalize.ts:80-84`

```ts
// map intrinsic bounds onto the displayed rect, then apply the layer transform
const b = materialized.bounds;
if (b.width <= 0 || b.height <= 0) return null;
const t = layer.transform;
const kx = (asset.naturalWidth * t.scaleX) / b.width;
const ky = (asset.naturalHeight * t.scaleY) / b.height;
```

`materialized.bounds` 是**内容包围盒**，代码却把它当作 viewBox 使用。栅格路径是按 viewBox → natural size 整体映射的（`src/renderer/RasterRenderer.ts:36`，`ctx.drawImage(bitmap, -w/2, -h/2, w, h)`，`w = naturalWidth * scaleX`）。

**触发示例**

```svg
<svg width="100" height="100" viewBox="0 0 100 100">
  <rect x="10" y="10" width="20" height="20" fill="#f00"/>
</svg>
```

PNG 导出位置正确；SVG 导出 `kx = ky = 100/20 = 5` → 矩形被放大 5 倍铺满画布。

**同一根因的另外两个后果**

- Paper 的导入器按分量拉伸 viewBox、忽略 `preserveAspectRatio`（`paper-core.js:15476-15499`），所以 `viewBox="10 20 200 100"` 在 100×100 的画布里没有 meet letterbox。
- **手绘图形**同样中招：`shapes/shapeGeometry.ts:168-178` 的 viewBox 含描边外扩，而 `b` 不含描边（`paper-core.js:3471` `if (!opts.stroke …)`）。矩形 (10,20)→(110,70) 描边 8：viewBox 108×58、内容 100×50 → `kx=1.08, ky=1.16` → 导出图形被拉伸并偏移。纯填充六边形也不会幸免（内容宽约 86.6、viewBox 100 → 横向拉伸 15%）。

`scripts/vector-regressions.ts:29-39` 正是为这两种情况写的断言，说明这是已知但未修的缺口。

**修复**：用 viewBox（含 `preserveAspectRatio`）计算归一化系数，而不是 `materialized.bounds`。

---

### P0-7 矢量导出完全忽略图层不透明度 🔍

- `grep -i 'opacity|alpha' src/vector` → **零命中**
- `src/vector/svgBoolean.ts:55-91` 的整条扫描从不读 `layer.opacity`

**后果**

- 顶层不透明度 0 的 SVG 图层：PNG/预览里被整体跳过（`RasterRenderer.ts:17`）所以下层完整可见；SVG 导出里却照常参与遮挡、把下层整块挖掉，并且把不可见的顶层作为内容输出。
- 半透明被硬切成布尔关系：`fill-opacity="0.5"` 或图层不透明度 0.5 会让下层**被切掉**而不是混合。

**决定性证据**：`scripts/vector-regressions.ts:49,54` 期待错误码 `code === "svg_partial_opacity"`，而 `grep svg_partial_opacity src/` → **零命中**。该错误码只存在于 harness，说明这条契约**从未实现**。

**修复**：门禁阶段显式检测不透明度并按契约拒绝（补上 `svg_partial_opacity`），或实现真正的 alpha 布尔。

---

### P0-8 矢量导出把整层多色填充压成第一种颜色 🔍

**位置**：`src/vector/svgNormalize.ts:104-107`

```ts
let filledGeometry: paper.PathItem | null = null;
for (const f of filled) {
  filledGeometry = filledGeometry ? (filledGeometry.unite(f) as paper.PathItem) : f;
}
```

随后 `src/vector/svgBoolean.ts:65-67` 只导出这个并集。Paper 的布尔结果从**第一个操作数**复制样式（`paper-core.js:10390` `result.copyAttributes(path1, true)` → `3882` `setStyle(source._style)`），而 CompoundPath 只输出一个 `<path>`（`paper-core.js:14883-14889`、`15079`）。

**触发**：同一图层内一红一蓝两个矩形 → 导出后两个都是红色（`vector-regressions.ts:57-63` 的 "blue lost"）。

**修复**：按填充色分桶分别做布尔，而不是先 union 成一个 PathItem。

---

## 2. 其余已确认 BUG

### 2.1 图层与历史

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| B1 | `locked` 被删除/复制无视：点选锁定行后 Delete 仍能删，Ctrl+D 仍能复制（而其它所有变更都检查 `!l.locked`） | `layerStore.ts:317-337`（对比 `:355`、`:383`、`:347`、`:418`、`:245`） |
| B2 | 拖拽中按 Ctrl+Z 破坏历史：`undo/redo` 不清 `history.pending`，松手时 `commitTransaction` 把拖拽前快照压栈并清空 `future`（redo 链被吃掉）；`cancelTransaction` 全仓零调用 | `layerStore.ts:248-278` |
| B16 | 撤销回已保存状态后 ● 依然不灭（undo/redo 也递增 `historyVersion`） | `layerStore.ts:270,277` |
| B17 | Shift 范围选择无固定锚点：选 `[B,C,D]` 后 Shift+E 得到 `[D,E]` 而非 `[B..E]`（锚点永远是数组最后一个元素） | `LayerPanel.tsx:39-43` |
| B18 | 一次操作可产出重名：名为 `A` 和 `A copy` 的两个图层同时 Ctrl+D → 两个副本都叫 `A copy 2` | `layerUtils.ts:70-74` |
| B20 | `reorder` 无边界保护，越界会把 `undefined` 塞进 `layers` 导致全渲染崩溃；`handleDrop` 混用"拖拽开始时的显示索引"与"落点时的 length"，拖拽中若 store 变化即可触发 | `layerStore.ts:389-391`、`LayerPanel.tsx:55` vs `:155` |
| B19 | 全隐藏时合并报错误的原因（"画布已变化"），实际是可见图层为空 | `mergeLayers.ts:16`、`LayerPanel.tsx:77-78` |
| — | 删除后用 `layers.length + 1` 编号会重名（删掉"图层 1"再新建 → 第二个"图层 2"）；`addEmptyLayer` 的 `name ?? ""` 默认值不可达 | `LayerPanel.tsx:93-96`、`layerStore.ts:301` |

### 2.2 输入、手势与视口

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| B3 | 弹窗打开时快捷键仍在改文档：对话框是同级兄弟节点，`useKeyboard` 只挡输入框；只有 `SaveDialog` 有 autoFocus，所以在"导出"对话框里按 Delete 会**删掉后面的图层** | `App.tsx:21`、`useKeyboard.ts:79-83` |
| B4 | 三个对话框都不能用 Esc 关闭，且 Esc 会穿透到编辑器执行"取消选择" | NewCanvasDialog / SaveDialog / ExportDialog（`useKeyboard.ts:85`） |
| B9 | 绘制修饰键只在 mousemove 采样：拖到一半按住 Shift 直接松手（不再移动）→ 得不到等比图形，与 README"Shift 等比"不符（mouseup 事件本身带修饰键状态） | `useShapeGesture.ts:88-93`、`:111-120` |
| B10 | 手势可重入：绘制中按右键会同时开始平移并继续拉大图形，松右键会提交该图形 | `CanvasEditor.tsx:380-381`、`:340-371` |
| B11 | 右键拖出画布区域松手会弹出 WebView2 原生菜单：`onContextMenu` 只挂在画布容器上，而平移监听在 window 上，且无 pointer capture | `CanvasEditor.tsx:411`、`:369` |
| — | Esc 语义含糊：绘制中按 Esc 会"取消本次绘制"与"退出工具"同时发生（两个监听器注册顺序决定） | `useKeyboard.ts:85-89`、`useShapeGesture.ts:135` |
| — | 吸附只作用于图层拖拽；Transformer 的缩放/旋转没有任何吸附路径，而 README 无条件承诺"吸附" | `CanvasEditor.tsx:131`、`TransformManager.tsx` |
| — | 等比锁定的锚点两路不一致：手柄拖拽固定对角（Konva 行为），属性面板改宽/高只改 scaleX/scaleY、不动 x/y → 以中心缩放，两条边都不固定 | `TransformManager.tsx:64-65` vs `layerStore.ts:360-380` |
| — | Shift 语义不一致：画布上 Shift = 切换选中，图层面板里 Shift = 范围选择 | `CanvasEditor.tsx:65` vs `LayerPanel.tsx:31-46` |

### 2.3 工程持久化与素材

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| B12 | 一个工程打不开就整体失败且报错误的原因：任一素材解码失败即抛错，文案却是"无效的工程文件" | `saveProject.ts:81-84`、`HomePage.tsx:92` |
| B13 | **完全没有迁移机制**：`v.version !== PROJECT_VERSION` 严格相等 → 版本号一升，所有旧工程立刻打不开（README 的"旧工程仍可加载"仅对 v1 的可选字段成立）；`grep migrat\|legacy` 在 `src/` 只命中注释 | `projectTypes.ts:132`、`:34` |
| B14 | 打开/删除/合并图层从不释放资源：`assetStore.remove` + `bitmap.close()` 全仓只有 1 处调用（合并**失败**路径），导入产生的 blob URL 从不 revoke；每次打开工程都会重新导入全部素材 | `saveProject.ts:78`、`assetStore.ts:37`、`mergeLayers.ts:52` |
| B15 | 序列化用主线程同步 `+=` 拼字符串再 `btoa`，且在自动保存里跑；缓存对并发的 autosave/save 会双双未命中，无体积上限 | `projectTypes.ts:54-63`、`useAutosave.ts:40-41` |
| — | 工程加载不释放旧素材（与 B14 同源）：`loadProject` 只换 canvas/layers/selection | `layerStore.ts:231-234` |
| — | recents 重建非原子：先 `clear()` 再逐条 put，中途失败/配额会毁掉整个卡片墙，且异常被吞 | `storage.ts:99-105` |
| — | 自动保存失败后无限重排 10 秒重试，只在控制台告警；配额压力真实（自动保存一份完整 JSON + 最多 5 份 recents） | `useAutosave.ts:49-54`、`storage.ts:65`、`:90` |
| — | 缩略图直接用第一个素材的**完整 data URL** 渲染进 `<img>`；`cardInfoCache` 是无上限模块级 Map，删除卡片也不淘汰 | `HomePage.tsx:35-36`、`:23`、`:250` |
| — | 导出**格式**不随工程保存：`ExportConfig` 只有 `{scope, scale}`，重开工程后格式总回落到 PNG | `projectTypes.ts:28-31`、`ExportDialog.tsx:57` |
| — | 自动保存的 key 含 `exportConfig`，无关的导出配置改动会触发整份工程重新序列化；key 在每次 store 变更时 stringify 全部图层 | `useAutosave.ts:25`、`:70` |
| — | 桌面保存总是弹"另存为"（无 last-path）；`addRecent` 在 epoch 守卫之前执行，可能把比当前文档更旧的 JSON 存进卡片墙 | `saveProject.ts:36`、`:45` vs `:47` |
| — | 自动保存只在进入编辑器后存在：从未进入编辑器的会话没有自动存档，而每次返回控制台都会 flush 一次 | `HomePage.tsx:63-72`、`App.tsx:22`、`useAutosave.ts:91` |

### 2.4 矢量与 SVG 上色

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| B7 | 轴对齐的纯描边几何被丢弃：直线工具拖出水平线，bounds 高度为 0 → `return null` → 图层从输出与遮挡遮罩中**静默消失** | `svgNormalize.ts:81`、`svgBoolean.ts:61`、`shapeGeometry.ts:131` |
| B8 | 描边既被裁切、又沿布尔切割边凭空多出描边：subtract 结果继承描边属性，而只保留"无填充的描边" | `svgBoolean.ts:66`、`:73-77` |
| B22 | 素材解码失败只打日志，图层从画布上无声消失、缩略图变空 | `usePaintedAsset.ts:18` |
| B23 | 画笔覆盖写的是 presentation attribute，会被作者 CSS 压过：面板显示新颜色、画布仍是旧色，且无任何提示 | `svgPaint.ts:26-30` |
| B24 | `fill="none "`（带空格）未被识别为 none → 被上色，违反"原本为 none 的通道保持不绘制" | `svgPaint.ts:10`、`:24`、`:28` |
| B25 | 覆盖色穿透 `<use>/<symbol>`：`<use fill="none">` 的实例被涂色 | `svgPaint.ts:19-35` |
| B26 | Paper 全局 `definitions` 从不清空 → 逐层导出时第 N 个文件的 `<defs>` 重复前 N-1 个的渐变定义，无界增长 | `svgBoolean.ts:27-33` |
| — | `usePaintedAsset` 的变体缓存上限 128 是 FIFO，素材被删除时不释放；`assetStore.remove` 在 `src/` 中从不被调用 | `svgPaint.ts:5,59` |

### 2.5 导出与命名

| 编号 | 问题 | 位置 |
| --- | --- | --- |
| — | 对话框与写出端两个错误通道不一致：`svgOnlyAllSvg`（本地化）vs `svg_needs_all_svg`（被 `ExportDialog.tsx:109` 匹配） | `ExportDialog.tsx:109`、`exportAll.ts:183` |
| — | 计划/写出为空被当作 `"cancelled"`：全空工程导出会显示"已取消导出"，而用户什么都没取消（`canExport` 只要求 `plan.length > 0`） | `exportAll.ts:140,218`、`ExportDialog.tsx:118` |
| — | 合成图导出完全不调用 `onProgress`，对话框一直停在"导出中…" | `exportAll.ts:150-153` |
| — | `Number(customScale) \|\| 1` 把用户输入的 `0` 静默变成 1x（0.1 的下限对 0 不可达） | `ExportDialog.tsx:68` |
| — | `readExportConfig()`（localStorage 读 + JSON.parse）在每次 render 都执行 | `ExportDialog.tsx:47` |
| — | 内存：遮挡引擎全程持有 N 个光栅 + 1 个 mask + 1 个结果（2N+1 块全画布 canvas），写出前又在 `files[]` 累积全部 PNG blob；`create2DCanvas` 只做 `Math.max(1, Math.round())`，无尺寸上限。2048² 画布 4x → 单块 268MB；8192 画布 4x → 32768² ≈ 4GiB，超出 Chromium 的 268MP canvas 预算（具体是抛错还是静默空白未实测） | `OcclusionEngine.ts:44-57`、`exportAll.ts:156-166`、`utils/canvas.ts:12-13` |
| m1 | 去重用 JS `toLowerCase`，而非文件系统的大小写/规范化规则：`ı`/`ſ` 在 NTFS 简单大写映射下与 `i`/`s` 同名；`café` 的 NFC/NFD 在 macOS 上同名 → 静默覆盖（ASCII 场景正确，属精度问题） | `naming.ts:52,56` |
| m2 | `sanitizeFileName` 无保留名处理：`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9` 与结尾点/空格未处理（名称长度无问题，60 字符上限 + ` (99)` + 扩展名 ≈ 71） | `layerUtils.ts:84-91` |
| m3 | ZIP 未配压缩：JSZip 默认 STORE，对全 SVG 导出是明显的体积回退 | `exportAll.ts:108` |
| m4 | 编号是**图层栈索引**而非导出序号：中间有隐藏层会出现 `001_…`、`003_…`（被 `export-naming-regressions.ts:79` 固化），与 README 的"序号"读法有出入 | `exportAll.ts:75` |

---

## 3. 冗余与重复

### 3.1 死导出（全仓零引用，仅剩定义；已用 grep across `src/` + `scripts/` 证明）

| 符号 | 位置 |
| --- | --- |
| `getAsset` | `src/assets/assetStore.ts:46` |
| `layerNaturalSize` | `src/layers/layerUtils.ts:20` |
| `PaperItem` 类型 | `src/vector/paperEnv.ts:27` |
| `ExportOptions` | `src/export/exportAll.ts:24-27` |
| `exportName` / `compositeName` | `src/export/naming.ts:16-26`（仅被测试引用） |
| `cancelTransaction` | `src/layers/layerStore.ts:262` |
| `moveLayerToTop` / `moveLayerToBottom` | `src/layers/layerStore.ts:394-411`（面板已改用 `reorder`） |
| `ViewportManager.reset` | `src/editor/ViewportManager.ts:50` |
| `svgUrl` 字段 | `src/assets/assetStore.ts:22`（3 处赋值、0 处读取） |
| `inputRef` | `src/layers/LayerPanel.tsx:212`（只写不读） |
| `HistoryIcon` / `GridIcon` | `src/ui/icons.tsx:138` / `:147` |
| `polygonPoints` | `src/shapes/shapeGeometry.ts:85`（仅同文件内使用，不应导出） |
| `computeOcclusionForExport` | `src/export/exportPNG.ts:60-67`（一行透传，注释却宣称有缓存职责） |
| `excludeIds` 形参 | `src/editor/TransformManager.tsx:132`（`void excludeIds;`） |
| `AnyCanvas` | `src/utils/canvas.ts:3`（仅同文件内使用） |

### 3.2 闲置 i18n 词条（zh/en 都已定义，全仓零使用）

`currentProject`、`autosaveTitle`、`openFailed`、`importFailed`、`unsupportedFile`。
其中 `importFailed`/`unsupportedFile` 恰好是硬编码英文提示 `⚠ N file(s) failed to import`（`src/import/importFiles.ts:36`）本该用的词条。

### 3.3 死样式与孤立类名

- **死 CSS**（定义后无任何引用）：`.recents-list`、`.recent-row`、`.recent-open`、`.recents-head`、`.console-section`（`styles.css:1218` 注释自称 legacy）、`.divider-left::after` / `.divider-right::after`（与基类同为 `left:3px`，空操作）。
- **TSX 有类名但 CSS 无规则**：`btn lang`（`Toolbar.tsx:150`、`HomePage.tsx:152`——语言切换按钮完全没有样式）、`svg-paint-controls`（`PropertiesPanel.tsx:133`）、`scale-input`（`ExportDialog.tsx:191`）。

### 3.4 重复实现

| 重复项 | 两处（或多处）位置 |
| --- | --- |
| 对话框外壳（overlay + dialog + actions）复制 4 份 —— 这正是三个对话框都缺 `role="dialog"`/焦点陷阱/Esc 的根因 | NewCanvasDialog、SaveDialog、ExportDialog、HomePage |
| 光栅叠放循环 | `mergeLayers.ts:17-22` vs `exportPNG.ts:43-47` |
| 默认 `Layer` 字面量 3 份（`makeLayer` 已支持显式 transform，可直接复用） | `layerUtils.ts:51-62`、`layerStore.ts:303-314`、`mergeLayers.ts:40-44` |
| 3–12 边数规则 3 份（其中两份字节级相同） | `shapeGeometry.ts:68-71`、`layerStore.ts:152-155`、`ShapeTools.tsx:146-147` |
| `roundPoint` ≡ `round2`（后者已被控件套件导入） | `useShapeGesture.ts:16-19` vs `utils/geometry.ts:49-51` |
| ZIP 下载序列与 `downloadBlob` 逐行重复 | `exportAll.ts:109-116` vs `exportPNG.ts:16-23` |
| SVG 门禁两份且**已经分叉** | `ExportDialog.tsx:31-45` vs `exportAll.ts:183-197` |
| 图层→素材解析两份（回退行为不同，导致矢量路径看不到逐层上色映射） | `svgPaint.ts:79-81` vs `svgBoolean.ts:58` |
| 手绘描边样式与预览样式手抄两份 | `shapeGeometry.ts:173-174` vs `ShapePreview.tsx:32-33` |
| 叶子遍历重复实现 | `svgNormalize.ts:93-96` vs `svgBoolean.ts:73-75` |
| 两张纸的 Paper 单例访问路径（绕过 `paperEnv` 的"单一离屏 project"契约） | `svgNormalize.ts:8`（裸导入）vs `:61`（`getPaper()`） |
| 棋盘格 conic-gradient 手抄 3 份 | `styles.css:481-482`、`:1179-1180`、`:746-747` |
| `.form-row` 定义 2 次；`.explode-slider` 相关 2 条规则；面板 190/460 边界导出常量却无人使用，`Divider.tsx:25` 又硬编码一遍 | `styles.css:688` vs `:899`；`:190-192` vs `:915-917`；`uiStore.ts:18-19` vs `Divider.tsx:25` |

### 3.5 需要留意的"靠约定维持"的安全性

`snap()` 存的是**活引用**（`layerStore.ts:16-18`）。今天安全——我已全仓扫描确认 `src/` 中不存在对 `layers`/`layer`/`transform` 的原位修改。但该保证没有任何类型或克隆兜底，**加一行 `layer.transform.x = …` 就会静默污染整个撤销历史**。
另：`LayerPanel.tsx:27` 的 `layers.map(...).reverse()` 会**原地反转 store 里的数组**，今天无害纯属巧合。

---

## 4. 未达预期（文档承诺 vs 实现）

1. **「预览文件名 == 实际写入文件名」不成立** —— 见 P0-4，只要计划里存在产不出结果的条目即破。
2. **「一次自顶向下扫描产出全部图层可见结果（预览与批量导出共享同一次计算）」措辞过强**：算法共享、**计算不共享**。`computeOcclusion` 有 4 个独立调用点（`CanvasEditor.tsx:199`、`exportPNG.ts:43`、`exportPNG.ts:66`、`mergeLayers.ts:15`），而注释（`OcclusionEngine.ts:23`）与 README 都宣称有 §15 缓存。
3. **合成图会把画布背景烘焙进去**，而逐层导出保持透明（`exportPNG.ts:38-41`）。README 把"透明背景"写在导出总条目下，合并路径又刻意不写背景 —— 三者语义互相矛盾，至少是文档缺陷。
4. **「全部输入点共用一套视觉/行为」**：3 处原生 `<input type="number">` 绕过控件套件（`CanvasSetupForm.tsx:50-56`、`:60-66`、`ExportDialog.tsx:189-197`），缺失 Enter 提交、提交时钳制、Esc 还原等行为（外观因共用 `.ctl-input` 尚可接受）。
5. **画布尺寸 8192 上限只在两处钳制**：`NewCanvasDialog` 没有 `Math.min(8192, …)`（`HomePage.tsx:76-77` 有），同一功能的两条创建路径已经分叉。
6. **吸附只作用于图层拖拽**，Transformer 缩放/旋转无吸附路径，而 README 无条件承诺"吸附"。
7. **等比锁定的锚点行为两路不一致**（见 §2.2）。
8. **「导出配置记忆」不完整**：`StoredExportConfig` 无目标位置字段；重开工程后格式总回落到 PNG（`ExportConfig` 只有 scope+scale）。
9. **`release-notes-v0.4.1.md:8` 宣称的 portable exe 无法由配置产出**：`tauri.conf.json:30` 的 targets 只有 `nsis`。
10. **Esc 语义**：绘制中按 Esc 会同时"取消本次绘制"与"退出工具"，README 措辞两种读法都通。
11. **未本地化文案**：导入失败提示硬编码英文（`importFiles.ts:36`）；锁定 tooltip 直接用 emoji（`LayerPanel.tsx:295`）；`en.ts:141` 的 `autosaveFoundSuffix: ""` 让英文句子结构悬空（"Found an autosave from <time>  · name"）。

---

## 5. 测试与工程化缺口

1. **回归 harness 未接入 `package.json`**（仅有 `dev`/`build`/`preview`/`app:*`），README 要求手开浏览器 URL —— 实际上不会有人跑。
2. `scripts/vector-regressions.ts` 至少 6 项按现状**不可能通过**（第 29、34、40、47、52、57 行；根因是 P0-6 / P0-7 / P0-8）；第 65 行的 symbol 物化检查无法验证。
3. `scripts/shape-regressions.ts:214-223` 只导出纯填充矩形，因此漏掉了"描边外扩导致几何拉伸"这一整类问题。
4. `scripts/export-regressions.cjs:44` 把 `resolveFileNames` 桩成恒等函数 → 命名/去重完全无覆盖；其 `./exportPNG` mock 缺少 `computeOcclusionForExport`，逐层 PNG 写出路径在该 harness 里实际是坏的。
5. `scripts/canvas-pan-regressions.tsx` 直接向 `.canvas-area` 派发事件，绕过 Konva 且 0 图层 → 永远测不到 P0-2。
6. `scripts/project-regressions.cjs:129` 只测畸形 v1，从不测"合法的旧版本" → 测不到 B13（无迁移）。
7. `scripts/export-naming-regressions.ts` 只用 ASCII `Logo`/`logo` 验大小写不敏感；非 ASCII 边界（`ı`/`ſ`/NFC-NFD）未覆盖。
8. **`tsconfig.node.tsbuildinfo` 被 git 跟踪**：`.gitignore` 写了 `*.tsbuildinfo`，但该文件在加 ignore 之前已经提交，必须 `git rm --cached`。
9. **`.gitignore` 的 `/_*` 只匹配根目录**：`_*` 落在任何子目录都会进版本库（本报告作者临时 harness 即触发此问题，见 §6）。

**未覆盖但值得补的测试**：加载文档后按 Ctrl+Z（P0-1）；计划条目产不出结果（P0-4）；写入期失败（P0-5）；对话框打开时的文档快捷键（B3）；拖拽中的 Ctrl+Z（B2）；非 ASCII 命名去重。

---

## 6. 审查过程留下的痕迹

我为了验证命名去重逻辑，写过一个对抗性 harness `scripts/_audit-naming-repro.cjs`（穷举 7,371 组输入序列，结论：`resolveFileNames` 正确、无重名）。删除时被系统拒绝：

```
Remove-Item: Access to the path 'F:\draw\scripts\_audit-naming-repro.cjs' is denied.
```

（`cmd /c del` 同样被拒；`Attributes` 显示为普通 `Archive`，非只读，疑似被索引/安全软件临时占用。）

该文件现在仅含 39 字节的注释内容，**且不被 `/_*` 规则忽略**，会出现在 `git status` 中（`?? scripts/_audit-naming-repro.cjs`）。**请在下次 `git add -A` 前手动删除。**

其余临时产物（根目录 `_*.png`、`_*.txt`、`_cdp*.ps1` 等）均已被 `/_*` 正确忽略，未进入版本库。

---

## 7. 建议的修复顺序

### 第一批（约 40 行改动，覆盖最伤的 3 个静默错误 + 1 个数据错乱）

1. **P0-1**：加载/新建文档时清空历史栈（3 行）。
2. **P0-2**：`draggable` 纳入 `spaceHeld`，并给 Konva 节点限制 `dragButtons`。
3. **P0-3**：重命名 ref 改 `useEffect`。
4. **P0-4**：计划阶段过滤掉产不出结果的条目（或写出时缺失即报错）。
5. **P0-5**：`try` 收窄到选择器调用；取消判定改 `e?.name === "AbortError"`。

每一项都能用现有 harness 或新增的小测试锁住。

### 第二批（矢量管线的正确性）

6. **P0-6**：改用 viewBox（含 `preserveAspectRatio`）计算归一化系数。
7. **P0-7**：门禁显式检测不透明度并补上 `svg_partial_opacity`（或实现真 alpha 布尔）。
8. **P0-8**：按填充色分桶分别布尔，而非先 union。
9. **B7**：`bounds` 退化到零高度不应直接丢弃几何（改用含描边的包围盒或 `strokeBounds`）。

### 第三批（交互一致性与模态）

10. **B1 / B2 / B3 / B4 / B5**：锁定语义统一、拖拽中撤销、弹窗模态化（抽一个共享 `<Dialog>` 一次修掉 4 份拷贝与 3 个 a11y 缺口）、SVG 门禁收敛为单一实现。
11. **B9 / B10 / B11**：绘制修饰键在 mouseup 重新采样、手势互斥、`onContextMenu` 提升到 window 或加 pointer capture。

### 第四批（持久化健壮性）

12. **B12 / B13 / B14**：素材级容错加载（失败素材降级而非整档失败）+ 版本迁移表 + 文档替换时释放素材。

### 第五批（收尾）

13. 删除 §3.1–§3.3 的死导出 / 死样式 / 闲置词条 / 孤立类名。
14. `computeOcclusion` 结果做真正的跨路径缓存，**或**修正 README 与 `OcclusionEngine.ts:23` 的措辞（说明算法共享而非计算共享）。
15. 明确合成图是否包含画布背景，并让 README 与该行为一致。
16. 把 harness 接进 `npm test`；补 §5 末尾列出的未覆盖测试。
17. `git rm --cached tsconfig.node.tsbuildinfo`；把 `.gitignore` 的 `/_*` 改为 `_*`。

---

## 附：干净的项（明确核查过，无需处理）

- 类型检查全绿；三处版本号一致；桌面 CSP 与代码不矛盾；`paper-core` 别名有效。
- zh/en 词典 138/138 完全对称、无重复、顺序一致。
- `dangerouslySetInnerHTML` / `innerHTML`：0 处。
- 缺少 `key` 的列表、以 index 作 key 的可重排列表：0 处（`LayerPanel.tsx:122` 正确使用 `layer.id`）。
- 图标仅 2 个未使用；其余 22 个均有真实渲染点。
- 固定定位浮层不会叠加（`App.tsx:23` 单状态，最多挂载一个对话框）。
- 作用域内每个 `addEventListener` 都有对应的移除与清理（含 `StatusBar.tsx:21-25`、`App.tsx:42-43`）；唯一例外是 `Divider.tsx` 的拖拽（见 §2.2 同类项）。
- 无 stale closure 缺陷：Konva handler 均通过 `getState()` 读实时状态；`handleDragStart` 的依赖数组覆盖了它读取的 prop。
- 指针锚定缩放的数学正确；`.canvas-area` 无 padding/border，`clientX - rect.left` 即 Stage 坐标。
- 吸附正确考虑了旋转与缩放（使用旋转后的 AABB，阈值按 `8 / vp.scale` 换算）。
- pointermove 期间不写历史：拖拽用 `commit=false`，Transformer 只在 `transformEnd` 提交，滑杆在 pointerup 提交。
- 图案工具启用时"只用于绘制"成立（`interactive` 要求 `activeTool === "select"`，绘制中隐藏 Transformer，左键不平移）。
- 预览与提交共用同一几何代码路径（`ShapePreview.tsx:22` / `createShape.ts:31`）。
- 布尔运算不修改源几何（`paper-core.js:10360-10364` 的 `path.clone(false)`）；工作项均未挂载到 project，无 project 状态泄漏。
- 不支持元素清单只有一份（`svgSafety.ts:11-30`），两个门禁都调用它，八个文档化元素全部被覆盖（大小写不敏感）。
- 颜色解析复用 `utils/color.ts` 的 `isHexColor`，无重复实现。
- `svgTextForLayer` 使用 DOMParser/XMLSerializer，不存在正则改写 SVG 的整类问题（引号、自闭合、命名空间属性）。
- 手绘图形相关承诺成立：直线不填充、边数 3–12 双处钳制、星形内径比固定 0.5、反向拖拽用 `abs`/`min`、单击 <3px 生成 200px 居中图形、viewBox 按描边半宽外扩**精确有效**（因为强制了 round join/cap）。
- 项目数值边界双向钳制、schema 在加载前拒绝畸形工程、自动保存串行化与清理 flush 均正确（11/11 回归通过）。
- PNG 原始字节保存/读取路径不依赖 `fetch(blob:/data:)`（回归通过）。
