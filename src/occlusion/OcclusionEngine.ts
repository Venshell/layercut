import type { CanvasSettings, Layer } from "../layers/layerTypes";
import type { LayerAsset } from "../assets/assetStore";
import { rasterizeLayer } from "../renderer/RasterRenderer";
import { create2DCanvas } from "../utils/canvas";
import { applyMaskToContext } from "./AlphaMask";
import { isLayerOccluder } from "../layers/layerUtils";
import { assetForLayer } from "../vector/svgPaint";

export interface OcclusionResult {
  /** Final visible raster per layer id, full-canvas size, transform baked in. */
  byLayerId: Map<string, HTMLCanvasElement>;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
}

/**
 * Occlusion engine — the core of LayerCut (project plan §5).
 *
 *   Layer[i]_visible = Layer[i] − Union(alpha of all visible layers above i)
 *
 * One top-down sweep produces every layer's result AND the cumulative occluder
 * mask. Preview and batch export share the same algorithm (and its call
 * pattern), but each caller runs its own sweep — there is no cross-call cache:
 *
 *   walking i from top to bottom:
 *     result[i]  = raster[i] ⊖ maskAbove
 *     maskAbove ∪= raster[i]        (full layer alpha — occluding power is
 *                                    independent of what covers it)
 *
 * Alpha mode uses destination-out, which is exactly
 * result = raster × (1 − maskAbove). Source data is never modified.
 */
export function computeOcclusion(
  layers: Layer[],
  canvas: CanvasSettings,
  assets: Record<string, LayerAsset>,
  scale = 1
): OcclusionResult {
  const byLayerId = new Map<string, HTMLCanvasElement>();
  const W = canvas.width;
  const H = canvas.height;

  // 1. Rasterize every visible layer once (transform + opacity baked in).
  const visible: { layer: Layer; raster: HTMLCanvasElement }[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!isLayerOccluder(layer)) continue;
    const asset = assetForLayer(layer, assets);
    const raster = rasterizeLayer(layer, asset, W, H, scale);
    if (!raster) continue;
    visible.push({ layer, raster });
  }

  // 2. Walk top → bottom: subtract cumulative mask, then accumulate it.
  const mask = create2DCanvas(W * scale, H * scale);
  for (const { layer, raster } of visible) {
    const result = create2DCanvas(W * scale, H * scale);
    const ctx = result.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(raster, 0, 0);
    // at this point the mask holds exactly the layers strictly above this one
    applyMaskToContext(ctx, mask.canvas);
    if (layer.visible) byLayerId.set(layer.id, result.canvas);
    // accumulate this layer's full alpha into the occluder mask
    mask.ctx.save();
    mask.ctx.setTransform(1, 0, 0, 1, 0, 0);
    mask.ctx.globalAlpha = 1;
    mask.ctx.globalCompositeOperation = "source-over";
    mask.ctx.drawImage(raster, 0, 0);
    mask.ctx.restore();
  }

  return { byLayerId, canvasWidth: W, canvasHeight: H, scale };
}
