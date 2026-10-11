import { newAssetId, useAssetStore } from "../assets/assetStore";
import { canvasToBlob } from "../export/exportPNG";
import { computeOcclusion } from "../occlusion/OcclusionEngine";
import { create2DCanvas } from "../utils/canvas";
import { makeLayer } from "./layerUtils";
import { hasPendingTransaction, useEditorStore } from "./layerStore";
import type { CanvasSettings, DocumentSnapshot, Layer } from "./layerTypes";
import { paintedAssetsForLayers } from "../vector/svgPaint";

/** Bake the cut results, without the editor's paper/background, into transparent pixels. */
export function rasterizeMergedLayers(
  layers: Layer[], canvas: CanvasSettings,
  assets: ReturnType<typeof useAssetStore.getState>["assets"]
): HTMLCanvasElement | null {
  const cut = computeOcclusion(layers, canvas, assets);
  if (cut.byLayerId.size === 0) return null;
  const output = create2DCanvas(canvas.width, canvas.height);
  for (const layer of layers) {
    const raster = cut.byLayerId.get(layer.id);
    if (raster) output.ctx.drawImage(raster, 0, 0);
  }
  return output.canvas;
}

/** Replace the entire current stack with one PNG. The replacement is one undo step. */
export async function mergeCurrentLayers(name: string): Promise<boolean> {
  const state = useEditorStore.getState();
  if (state.layers.length < 2 || hasPendingTransaction()) return false;
  const expected: DocumentSnapshot = {
    layers: state.layers, canvas: state.canvas,
    historyVersion: state.historyVersion, documentEpoch: state.documentEpoch,
  };
  const renderAssets = await paintedAssetsForLayers(state.layers, useAssetStore.getState().assets);
  const output = rasterizeMergedLayers(state.layers, state.canvas, renderAssets);
  if (!output) return false;
  const sourceBlob = await canvasToBlob(output);
  const bitmap = await createImageBitmap(sourceBlob);
  const assetId = newAssetId();
  const previewUrl = URL.createObjectURL(sourceBlob);
  const layer = makeLayer({
    name,
    type: "png",
    assetId,
    canvas: state.canvas,
    natural: { width: output.width, height: output.height },
    transform: {
      x: state.canvas.width / 2,
      y: state.canvas.height / 2,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    },
  });
  const assetStore = useAssetStore.getState();
  assetStore.put({
    id: assetId, kind: "png", fileName: `${name}.png`, mimeType: "image/png",
    naturalWidth: output.width, naturalHeight: output.height,
    bitmap, sourceBlob, previewUrl,
  });
  if (useEditorStore.getState().replaceAllLayers(expected, layer)) return true;
  assetStore.remove(assetId);
  bitmap.close();
  URL.revokeObjectURL(previewUrl);
  return false;
}
