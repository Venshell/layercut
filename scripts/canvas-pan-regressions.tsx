import { createRoot } from "react-dom/client";
import Konva from "konva";
import { CanvasEditor } from "../src/editor/CanvasEditor";
import { useViewportStore } from "../src/editor/ViewportManager";
import { useEditorStore } from "../src/layers/layerStore";
import { useAssetStore, type LayerAsset } from "../src/assets/assetStore";
import { I18nProvider } from "../src/i18n";

// Seed one real layer BEFORE mounting. Without it the stage renders no layer
// node, so `draggable={... && !panning && ...}` is never evaluated and this
// harness passes no matter what that condition says — it could not detect a
// regression of "panning must not drag the layer under the cursor".
const seedAssetId = "pan-asset";
const seedBitmap = document.createElement("canvas");
seedBitmap.width = 40;
seedBitmap.height = 40;
seedBitmap.getContext("2d")!.fillRect(0, 0, 40, 40);
const seedAsset: LayerAsset = {
  id: seedAssetId,
  kind: "png",
  fileName: "pan-seed.png",
  mimeType: "image/png",
  naturalWidth: 40,
  naturalHeight: 40,
  bitmap: seedBitmap as unknown as ImageBitmap,
  previewUrl: "",
};
useAssetStore.getState().put(seedAsset);
useEditorStore.getState().addLayers([
  {
    id: "pan-layer",
    name: "pan-layer",
    type: "png",
    assetId: seedAssetId,
    visible: true,
    locked: false,
    opacity: 1,
    aspectLocked: false,
    occludesWhenHidden: false,
    transform: { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 },
  },
]);

// CanvasEditor reads the i18n context (it names drawn layers), so the harness
// mounts it the same way App does.
createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <CanvasEditor />
  </I18nProvider>
);

const frame = () => new Promise<void>((resolve) => {
  // rAF is throttled in hidden/occluded tabs; a timeout keeps the harness
  // runnable there while real frames still take precedence.
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 120);
});
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const results: { name: string; pass: boolean; detail?: string }[] = [];
const test = async (name: string, run: () => Promise<void>) => {
  try { await run(); results.push({ name, pass: true }); }
  catch (error) { results.push({ name, pass: false, detail: String(error) }); }
};

await frame();
await frame();
const area = document.querySelector(".canvas-area")!;
const down = (button: number, buttons: number) => area.dispatchEvent(new MouseEvent("mousedown", {
  bubbles: true, cancelable: true, button, buttons, clientX: 100, clientY: 100,
}));
const move = (buttons: number, x: number, y: number) => window.dispatchEvent(new MouseEvent("mousemove", {
  bubbles: true, buttons, clientX: x, clientY: y,
}));
const up = (button: number) => window.dispatchEvent(new MouseEvent("mouseup", {
  bubbles: true, button, buttons: 0, clientX: 125, clientY: 135,
}));

await test("right drag pans and release stops panning", async () => {
  useViewportStore.getState().set({ x: 10, y: 20 });
  assert(!down(2, 2), "right mousedown was not cancelled");
  move(2, 125, 135);
  assert(useViewportStore.getState().x === 35 && useViewportStore.getState().y === 55, "right drag did not pan");
  up(2);
  move(0, 150, 160);
  assert(useViewportStore.getState().x === 35 && useViewportStore.getState().y === 55, "pan continued after release");
});

await test("unmodified left drag does not pan", async () => {
  down(0, 1);
  move(1, 150, 160);
  up(0);
  assert(useViewportStore.getState().x === 35 && useViewportStore.getState().y === 55, "left drag moved the viewport");
});

await test("middle drag still pans", async () => {
  down(1, 4);
  move(4, 110, 115);
  up(1);
  assert(useViewportStore.getState().x === 45 && useViewportStore.getState().y === 70, "middle drag stopped working");
});

await test("shape tool left drag draws instead of panning", async () => {
  const store = useEditorStore.getState();
  store.setActiveTool("rect");
  const x = useViewportStore.getState().x;
  const y = useViewportStore.getState().y;
  down(0, 1);
  move(1, 150, 160);
  up(0);
  assert(
    useViewportStore.getState().x === x && useViewportStore.getState().y === y,
    "an armed shape tool panned the viewport instead of drawing"
  );
  store.setActiveTool("select");
});

// Regression guard for "panning must not drag the layer under the cursor".
//
// Konva starts a drag from its own hit detection, not from a DOM mousedown, so
// dispatching events cannot exercise this. What the fix actually controls is
// the `draggable` flag on the Konva node, and Konva keeps every stage in a
// public registry — so read the node attribute directly. Seeding the layer
// above is what makes the node exist at all; before that this harness had zero
// layers and the flag was never evaluated.
const layerPos = () => {
  const l = useEditorStore.getState().layers.find((x) => x.id === "pan-layer");
  return l ? `${l.transform.x},${l.transform.y}` : "missing";
};

const konvaNode = () => {
  for (const stage of Konva.stages) {
    const node = stage.findOne("#pan-layer");
    if (node) return node as Konva.Node;
  }
  return null;
};

await test("the seeded layer renders as a Konva node", async () => {
  await frame(); // let the previous test's tool change re-render
  assert(konvaNode() !== null, "no Konva node for the seeded layer");
});

await test("layer is draggable while idle", async () => {
  const node = konvaNode();
  assert(node !== null, "no Konva node for the seeded layer");
  if (!node) return;
  assert(node.draggable() === true, "layer was not draggable while idle");
});

await test("space held disarms dragging so a pan cannot move the layer", async () => {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
  await frame();
  const node = konvaNode();
  assert(node !== null, "no Konva node for the seeded layer");
  if (!node) return;
  assert(node.draggable() === false, "layer stayed draggable while Space was held (P0-2 regression)");
  assert(node.listening() === false, "layer stayed listening while Space was held");
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
  await frame();
  assert(konvaNode()?.draggable() === true, "layer did not become draggable again after releasing Space");
});

await test("space + left drag pans without moving the layer", async () => {
  const before = layerPos();
  assert(before !== "missing", "seed layer disappeared before the pan test");
  const vx = useViewportStore.getState().x;
  // Space arms panning; the canvas listens on window keydown.
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
  down(0, 1);
  move(1, 200, 220);
  up(0);
  window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
  assert(useViewportStore.getState().x !== vx, "space + left drag did not pan");
  assert(layerPos() === before, `layer moved while panning: ${before} -> ${layerPos()}`);
});

await test("plain left drag does not pan the viewport", async () => {
  const vx = useViewportStore.getState().x;
  down(0, 1);
  move(1, 240, 260);
  up(0);
  assert(useViewportStore.getState().x === vx, "plain left drag moved the viewport");
});

document.getElementById("result")!.textContent = JSON.stringify({
  passed: results.filter((result) => result.pass).length, total: results.length, results,
}, null, 2);
document.documentElement.dataset.status = results.every((result) => result.pass) ? "passed" : "failed";
