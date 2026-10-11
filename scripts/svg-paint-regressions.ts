import type { LayerAsset } from "../src/assets/assetStore";
import type { Layer } from "../src/layers/layerTypes";
import { paintedAsset, svgTextForLayer } from "../src/vector/svgPaint";
import { computeVectorOcclusion } from "../src/vector/svgBoolean";
import { useEditorStore } from "../src/layers/layerStore";
import { paintedAssetsForLayers } from "../src/vector/svgPaint";
import { isValidProjectJson, serializeProject } from "../src/project/projectTypes";
import { loadProjectJson } from "../src/project/saveProject";

const source = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="5" y="5" width="35" height="35" fill="#ff0000"/><rect x="55" y="5" width="35" height="35" fill="none" stroke="#0000ff" stroke-width="6"/><path d="M5 75 H95" fill="none" stroke="#00aa00" stroke-width="6"/></svg>';
const asset: LayerAsset = { id: "paint-source", kind: "svg", fileName: "paint.svg", mimeType: "image/svg+xml", naturalWidth: 100, naturalHeight: 100, bitmap: null as never, previewUrl: "", svgText: source };
const layer: Layer = { id: "paint-layer", name: "paint", type: "svg", assetId: asset.id, opacity: 1, visible: true, locked: false, aspectLocked: false, occludesWhenHidden: false, svgFillColor: "#adcf37", svgStrokeColor: "#c51e2a", transform: { x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 } };
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

function pixels(image: CanvasImageSource) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 100;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0, 100, 100);
  const data = ctx.getImageData(0, 0, 100, 100).data;
  return (x: number, y: number) => Array.from(data.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 4));
}

async function imageFromSvg(svg: string): Promise<HTMLImageElement> {
  const image = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; });
  return image;
}

async function main() {
  const text = svgTextForLayer(asset, layer);
  assert(asset.svgText === source, "source mutated");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  assert(!doc.querySelector("parsererror"), "painted SVG invalid");
  const raster = pixels((await paintedAsset(asset, layer)).bitmap as CanvasImageSource);
  assert(raster(20, 20).join() === "173,207,55,255", `raster fill ${raster(20, 20)}`);
  assert(raster(70, 20).join() === "0,0,0,0", `none fill changed ${raster(70, 20)}`);
  assert(raster(55, 20).join() === "197,30,42,255", `raster stroke ${raster(55, 20)}`);
  assert(raster(20, 75).join() === "197,30,42,255", `stroke-only path ${raster(20, 75)}`);
  const svg = computeVectorOcclusion([layer], { [asset.id]: asset }, { width: 100, height: 100, background: "transparent" }).byLayerId.get(layer.id)!;
  const vector = pixels(await imageFromSvg(svg));
  assert(vector(20, 20).join() === "173,207,55,255", `vector fill ${vector(20, 20)}`);
  assert(vector(55, 20).join() === "197,30,42,255", `vector stroke ${vector(55, 20)}`);
  const other = { ...layer, id: "other-layer", svgFillColor: "#1c4a9c", svgStrokeColor: null };
  const renderAssets = await paintedAssetsForLayers([layer, other], { [asset.id]: asset });
  assert(pixels(renderAssets[layer.id].bitmap as CanvasImageSource)(20, 20)[0] === 173, "first layer paint lost");
  assert(pixels(renderAssets[other.id].bitmap as CanvasImageSource)(20, 20)[2] === 156, "second layer paint lost");
  const serialized = await serializeProject("paint test", { width: 100, height: 100, background: "transparent" }, [layer], { [asset.id]: asset });
  assert(isValidProjectJson(serialized), "serialized project rejected");
  await loadProjectJson(JSON.stringify(serialized));
  assert(useEditorStore.getState().layers[0].svgFillColor === "#adcf37" && useEditorStore.getState().layers[0].svgStrokeColor === "#c51e2a", "project load lost colors");
  const store = useEditorStore.getState();
  store.loadProject({ canvas: { width: 100, height: 100, background: "transparent" }, layers: [layer], name: "paint test" });
  store.setSvgPaintColor(layer.id, "svgFillColor", "#1c4a9c");
  assert(useEditorStore.getState().layers[0].svgFillColor === "#1c4a9c", "edit missing");
  store.undo();
  assert(useEditorStore.getState().layers[0].svgFillColor === "#adcf37", "undo missing");
  store.redo();
  assert(useEditorStore.getState().layers[0].svgFillColor === "#1c4a9c", "redo missing");
  await authorCssPrecedence();
  document.getElementById("result")!.textContent = "PASS: fill, stroke, none, vector, two layer colors, project roundtrip, immutable source, undo/redo, author CSS precedence";
}

/**
 * A recolour must beat author CSS. Writing a presentation attribute lost to
 * any `<style>` rule, so the panel showed the new colour while the canvas and
 * exports kept the old one. The override is now an inline !important
 * declaration, which wins even against an author !important rule.
 */
async function authorCssPrecedence() {
  const wrap = (body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${body}</svg>`;
  const forLayer = (svgText: string): LayerAsset => ({
    id: "css-source", kind: "svg", fileName: "css.svg", mimeType: "image/svg+xml",
    naturalWidth: 40, naturalHeight: 40, bitmap: null as never, previewUrl: "", svgText,
  });
  const paintLayer: Layer = {
    ...layer, id: "css-layer", assetId: "css-source",
    svgFillColor: "#00ff00", svgStrokeColor: null,
    transform: { x: 20, y: 20, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const centrePixel = async (svgText: string) => {
    const painted = svgTextForLayer(forLayer(svgText), paintLayer);
    return pixels(await imageFromSvg(painted))(20, 20);
  };

  const cases: [string, string][] = [
    ["presentation attribute", '<rect width="40" height="40" fill="#ff0000"/>'],
    ["inline style", '<rect width="40" height="40" style="fill:#ff0000"/>'],
    ["author CSS rule", '<style>rect{fill:#ff0000}</style><rect width="40" height="40"/>'],
    ["author CSS !important", '<style>rect{fill:#ff0000 !important}</style><rect width="40" height="40"/>'],
  ];
  for (const [label, body] of cases) {
    const px = await centrePixel(wrap(body));
    assert(px[1] > 200 && px[0] < 80, `${label}: override did not win (pixel ${px})`);
  }

  // An unpainted channel must stay unpainted.
  const noneText = svgTextForLayer(forLayer(wrap('<rect width="40" height="40" fill="none"/>')), paintLayer);
  assert(!noneText.includes("#00ff00"), "fill=none was painted by the override");

  // Declarations we do not override must survive.
  const withStroke = svgTextForLayer(
    forLayer(wrap('<style>rect{fill:#ff0000;stroke-width:6}</style><rect x="5" y="5" width="30" height="30"/>')),
    paintLayer
  );
  assert(withStroke.includes("stroke-width"), "author stroke-width was dropped");
}
main().catch((error) => { document.getElementById("result")!.textContent = `FAIL: ${error}`; });
