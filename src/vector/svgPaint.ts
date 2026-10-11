import type { LayerAsset } from "../assets/assetStore";
import type { Layer } from "../layers/layerTypes";

const GRAPHICS = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text", "use"]);
const MAX_VARIANTS = 128;
const variants = new Map<string, Promise<LayerAsset>>();

function paintValue(el: Element, property: "fill" | "stroke", inherited: string): string {
  const style = (el as SVGElement).style;
  // attribute values may carry stray whitespace ("none ") — trim before the
  // caller's "none" comparison, or an unpainted channel would get painted
  return style?.getPropertyValue(property).trim() || (el.getAttribute(property) || "").trim() || inherited;
}

/**
 * Build one layer's effective SVG without changing the imported source.
 *
 * Overrides are written as inline `style` declarations with `!important`
 * rather than as presentation attributes. A presentation attribute loses to
 * any author CSS rule (`<style>rect{fill:#f00}</style>`), which made the panel
 * show the new colour while the canvas and exports kept the old one, with no
 * warning. An inline `!important` declaration wins over author rules including
 * their own `!important` ones, and Paper.js reads it correctly. Author
 * `<style>` declarations for anything we do not override (stroke width,
 * dashes, transforms, ...) are left untouched.
 */
export function svgTextForLayer(asset: LayerAsset, layer: Layer): string {
  const source = asset.svgText;
  if (!source || (!layer.svgFillColor && !layer.svgStrokeColor)) return source ?? "";
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid SVG source");
  const walk = (el: Element, inheritedFill: string, inheritedStroke: string) => {
    const fill = paintValue(el, "fill", inheritedFill);
    const stroke = paintValue(el, "stroke", inheritedStroke);
    const tag = el.localName.toLowerCase();
    if (GRAPHICS.has(tag)) {
      const styled = el as SVGElement;
      // Both are needed. Paper.js exports SVG from the presentation attribute,
      // so without setAttribute the vector output keeps the original colour;
      // the inline !important declaration is what beats author CSS when the
      // browser rasterizes the document. Writing only one of them regresses
      // one of the two paths.
      if (layer.svgFillColor && fill.toLowerCase() !== "none") {
        el.setAttribute("fill", layer.svgFillColor);
        styled.style.setProperty("fill", layer.svgFillColor, "important");
      }
      if (layer.svgStrokeColor && stroke.toLowerCase() !== "none") {
        el.setAttribute("stroke", layer.svgStrokeColor);
        styled.style.setProperty("stroke", layer.svgStrokeColor, "important");
      }
    }
    for (const child of Array.from(el.children)) walk(child, fill, stroke);
  };
  walk(doc.documentElement, "black", "none");
  return new XMLSerializer().serializeToString(doc);
}

function variantKey(asset: LayerAsset, layer: Layer): string {
  return `${asset.id}|${layer.svgFillColor ?? ""}|${layer.svgStrokeColor ?? ""}`;
}

/** Decode recolored SVG once; raster preview and PNG export share this image. */
export function paintedAsset(asset: LayerAsset, layer: Layer): Promise<LayerAsset> {
  if (asset.kind !== "svg" || (!layer.svgFillColor && !layer.svgStrokeColor)) return Promise.resolve(asset);
  const key = variantKey(asset, layer);
  const cached = variants.get(key);
  if (cached) return cached;
  const text = svgTextForLayer(asset, layer);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  const pending = new Promise<LayerAsset>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ ...asset, bitmap: image, previewUrl: url });
    image.onerror = () => reject(new Error("SVG paint decode failed"));
    image.src = url;
  });
  variants.set(key, pending);
  pending.catch(() => { if (variants.get(key) === pending) variants.delete(key); });
  if (variants.size > MAX_VARIANTS) variants.delete(variants.keys().next().value!);
  return pending;
}

/** Drop repainted variants of one source asset (used when the asset is released). */
export function releasePaintedVariants(assetId: string): void {
  const prefix = `${assetId}|`;
  for (const key of [...variants.keys()]) {
    if (key.startsWith(prefix)) variants.delete(key);
  }
}

export async function paintedAssetsForLayers(
  layers: Layer[], assets: Record<string, LayerAsset>
): Promise<Record<string, LayerAsset>> {
  const result: Record<string, LayerAsset> = { ...assets };
  await Promise.all(layers.map(async (layer) => {
    if (!layer.assetId) return;
    const asset = assets[layer.assetId];
    if (!asset) return;
    const painted = await paintedAsset(asset, layer);
    // Duplicates can share a source but have different paint. Callers address
    // this map by layer id rather than source asset id.
    result[layer.id] = painted;
  }));
  return result;
}

export function assetForLayer(layer: Layer, assets: Record<string, LayerAsset>): LayerAsset | null {
  return assets[layer.id] ?? (layer.assetId ? assets[layer.assetId] ?? null : null);
}
