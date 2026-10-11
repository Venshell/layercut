/**
 * Vector occlusion engine (project plan §14 v0.5 + v0.6):
 *
 *   Layer[i]_visible.svg = Layer[i] − Union(Layers Above i)
 *
 * Same top-down cumulative sweep as the raster engine, but operating on
 * Paper.js path booleans so every layer keeps true vector geometry:
 * curves are preserved and the result exports as real SVG (§7.3).
 */
import { getPaper, resetProject, type PaperPathItem } from "./paperEnv";
import { importLayerGeometry, leafPathItems } from "./svgNormalize";
import type { CanvasSettings, Layer } from "../layers/layerTypes";
import type { LayerAsset } from "../assets/assetStore";
import { isLayerOccluder } from "../layers/layerUtils";
import { assetForLayer } from "./svgPaint";
import { svgHasPartialAlpha } from "./svgSafety";

export interface VectorOcclusionResult {
  /** per-layer SVG document string, full-canvas viewBox, transform baked in */
  byLayerId: Map<string, string>;
}

function partialOpacityError(): Error & { code: string } {
  const err = new Error("svg_partial_opacity") as Error & { code: string };
  err.code = "svg_partial_opacity";
  return err;
}

function exportVisibleSvg(item: paper.Item, canvas: CanvasSettings, scale: number): string {
  const P = getPaper();
  resetProject();
  const layer = new P.Layer();
  P.project.addLayer(layer);
  layer.addChild(item);
  const svg = P.project.exportSVG({
    asString: true,
    bounds: new P.Rectangle(0, 0, canvas.width, canvas.height),
    precision: 4,
    matchShapes: false,
  }) as string;
  resetProject();
  // paper's root <svg> may not carry width/height — build our own wrapper so
  // the canvas viewBox is guaranteed and the export scale is applied exactly
  const inner = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
  const w = (canvas.width * scale).toFixed(2);
  const h = (canvas.height * scale).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${canvas.width} ${canvas.height}">${inner}</svg>`;
}

/**
 * Compute per-layer visible SVG via vector boolean. The caller must ensure
 * every visible layer is an SVG layer (use analyzeSvgSafety for content).
 *
 * Partial alpha (layer or source) throws svg_partial_opacity: a boolean cut
 * has no representation for it. A fully transparent layer exports an empty
 * document and occludes nothing.
 */
export function computeVectorOcclusion(
  layers: Layer[],
  assets: Record<string, LayerAsset>,
  canvas: CanvasSettings,
  scale = 1
): VectorOcclusionResult {
  const byLayerId = new Map<string, string>();

  for (const layer of layers.filter(isLayerOccluder)) {
    if (layer.opacity > 0 && layer.opacity < 1) throw partialOpacityError();
    const asset = assetForLayer(layer, assets);
    if (asset?.kind === "svg" && asset.svgText && svgHasPartialAlpha(asset.svgText)) {
      throw partialOpacityError();
    }
  }

  let mask: PaperPathItem | null = null;
  const P = getPaper();

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!isLayerOccluder(layer)) continue;
    const asset = assetForLayer(layer, assets);
    if (!asset || asset.kind !== "svg") continue;

    if (layer.opacity <= 0) {
      // invisible everywhere: exports nothing and cuts nothing
      if (layer.visible) {
        byLayerId.set(layer.id, exportVisibleSvg(new P.Group({ insert: false }), canvas, scale));
      }
      continue;
    }

    const normalized = importLayerGeometry(asset, layer);
    if (!normalized) continue;

    const { filledGeometry, filledBuckets } = normalized;
    // Boolean subtraction only concerns filled geometry. Keep stroke-only
    // siblings in the output, with their paint intact (existing limitation:
    // stroke outlines are not clipped by the mask).
    const strokeOnly = leafPathItems(normalized.item)
      .filter((item) => !item.fillColor && !!item.strokeColor)
      .map((item) => item.clone({ insert: false, deep: true }));

    const children: PaperPathItem[] = [];
    // One boolean per colour bucket keeps every fill colour: boolean results
    // copy the first operand's style, so a single unioned shape would export
    // a multi-colour layer in one colour.
    for (const bucket of filledBuckets) {
      const visible = mask ? (bucket.subtract(mask) as PaperPathItem) : bucket;
      // the cut result must not grow a stroke along the boolean edges
      visible.strokeColor = null;
      children.push(visible);
    }
    children.push(...strokeOnly);

    if (children.length > 0 && layer.visible) {
      const output =
        children.length === 1
          ? children[0]
          : new P.Group({ children, insert: false });
      byLayerId.set(layer.id, exportVisibleSvg(output, canvas, scale));
    }
    if (filledGeometry) {
      mask = mask ? (mask.unite(filledGeometry) as PaperPathItem) : filledGeometry;
    }
  }

  return { byLayerId };
}
