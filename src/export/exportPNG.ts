import type { CanvasSettings, Layer } from "../layers/layerTypes";
import type { LayerAsset } from "../assets/assetStore";
import { computeOcclusion } from "../occlusion/OcclusionEngine";
import { drawLayerToContext } from "../renderer/RasterRenderer";
import { create2DCanvas } from "../utils/canvas";
import { isLayerOccluder } from "../layers/layerUtils";
import { assetForLayer } from "../vector/svgPaint";

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Normal composite render (all visible layers, source-over, bottom→top).
 * Background respects canvas settings; layers keep their transforms.
 */
export function rasterizeComposite(
  layers: Layer[],
  canvas: CanvasSettings,
  assets: Record<string, LayerAsset>,
  scale: number
): HTMLCanvasElement {
  const { canvas: out, ctx } = create2DCanvas(canvas.width * scale, canvas.height * scale);
  ctx.scale(scale, scale);
  if (canvas.background !== "transparent") {
    ctx.fillStyle = canvas.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (layers.some((layer) => !layer.visible && isLayerOccluder(layer))) {
    const cut = computeOcclusion(layers, canvas, assets, scale);
    for (const layer of layers) {
      const raster = cut.byLayerId.get(layer.id);
      if (raster) ctx.drawImage(raster, 0, 0, canvas.width, canvas.height);
    }
    return out;
  }
  for (const layer of layers) {
    if (!layer.visible) continue;
    const asset = assetForLayer(layer, assets);
    if (!asset) continue;
    drawLayerToContext(ctx, layer, asset);
  }
  return out;
}

/** Exportable layers = visible layers, bottom→top, with sequential index. */
export function exportableLayers(layers: Layer[]): { layer: Layer; index: number }[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.visible);
}
