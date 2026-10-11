import React from "react";
import { createRoot } from "react-dom/client";
import { CanvasEditor } from "../src/editor/CanvasEditor";
import { useViewportStore } from "../src/editor/ViewportManager";
import { useEditorStore } from "../src/layers/layerStore";
import { I18nProvider } from "../src/i18n";

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

document.getElementById("result")!.textContent = JSON.stringify({
  passed: results.filter((result) => result.pass).length, total: results.length, results,
}, null, 2);
document.documentElement.dataset.status = results.every((result) => result.pass) ? "passed" : "failed";
