/**
 * SVG Path Normalize + canvas-space placement (project plan §14 v0.4).
 * Paper's SVG importer normalizes rect/circle/ellipse/polygon/polyline/line
 * into paths; we additionally materialize <use>/<symbol> instances, drop
 * clip masks, and bucket all filled geometry by paint colour so the boolean
 * stage can preserve every colour in the layer.
 */
import { getPaper } from "./paperEnv";
import type { LayerAsset } from "../assets/assetStore";
import type { Layer } from "../layers/layerTypes";
import { svgTextForLayer } from "./svgPaint";

/** Materialize non-path items (symbols → placed definition, shapes → paths). */
function materialize(item: paper.Item): paper.Item | null {
  const P = getPaper();
  if (item instanceof P.SymbolItem) {
    const def = item.definition as unknown as paper.Item;
    const placed = def.clone({ insert: false, deep: true }) as paper.Item;
    placed.transform(item.matrix);
    return materializeTree(placed);
  }
  if (item instanceof P.Shape) {
    return materializeTree(item.toPath(true));
  }
  if (item instanceof P.Group || item instanceof P.Layer) {
    return materializeTree(item);
  }
  if (item.clipMask) return null; // clip geometry is not filled content
  return item;
}

function materializeTree(item: paper.Item): paper.Item | null {
  const children = item.children;
  if (children && children.length > 0) {
    const out: paper.Item[] = [];
    for (const child of children) {
      const m = materialize(child);
      if (m) out.push(m);
    }
    item.removeChildren();
    if (out.length === 0) return null;
    item.addChildren(out);
    return item;
  }
  return item;
}

export interface NormalizedLayer {
  /** all materialized geometry, already in canvas coordinates */
  item: paper.Item;
  /** union of every filled path — the layer's occluding geometry (may be null) */
  filledGeometry: paper.PathItem | null;
  /**
   * Filled geometry bucketed by paint colour (each bucket united into one
   * PathItem). Boolean results copy the first operand's style, so without
   * buckets a multi-colour layer would export in a single colour.
   */
  filledBuckets: paper.PathItem[];
}

interface ParsedViewport {
  /** intrinsic size (px) the browser rasterizes into */
  width: number;
  height: number;
  /** raw viewBox, or null when absent/unparsable */
  viewBox: { x: number; y: number; width: number; height: number } | null;
  /** paper stretched the viewBox into these attr numbers (null = no attrs) */
  paperWidth: number | null;
  paperHeight: number | null;
  /** preserveAspectRatio */
  alignX: number;
  alignY: number;
  mode: "meet" | "slice" | "none";
}

// absolute CSS lengths → px (unitless numbers and px are 1:1)
const CSS_UNITS_PX: Record<string, number> = {
  px: 1,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  in: 96,
  pt: 96 / 72,
  pc: 16,
};

/**
 * Parse one width/height attribute. Returns the number paper works with
 * (parseFloat ignores units) and the px size the browser decodes. Percentages
 * and font-relative units depend on context, so they read as "unknown".
 */
function parseLength(raw: string | null): { paper: number; px: number } | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d*\.?\d+(?:e[+-]?\d+)?)\s*([a-z]*)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  if (unit === "") return { paper: n, px: n };
  const factor = CSS_UNITS_PX[unit];
  return factor ? { paper: n, px: n * factor } : null;
}

function parseViewport(svgText: string, naturalWidth: number, naturalHeight: number): ParsedViewport {
  const viewport: ParsedViewport = {
    width: naturalWidth,
    height: naturalHeight,
    viewBox: null,
    paperWidth: null,
    paperHeight: null,
    alignX: 0.5,
    alignY: 0.5,
    mode: "meet",
  };
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || doc.querySelector("parsererror")) return viewport;

    const w = parseLength(root.getAttribute("width"));
    const h = parseLength(root.getAttribute("height"));
    if (w && h) {
      viewport.width = w.px;
      viewport.height = h.px;
      viewport.paperWidth = w.paper;
      viewport.paperHeight = h.paper;
    }

    const vbRaw = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (vbRaw.length === 4 && vbRaw.every((n) => Number.isFinite(n)) && vbRaw[2] > 0 && vbRaw[3] > 0) {
      viewport.viewBox = { x: vbRaw[0], y: vbRaw[1], width: vbRaw[2], height: vbRaw[3] };
    }

    const par = (root.getAttribute("preserveAspectRatio") || "").trim().toLowerCase();
    const parts = par.split(/\s+/);
    if (parts[0] === "none") {
      viewport.mode = "none";
    } else {
      const align = parts[0] || "xmidymid";
      viewport.mode = parts[1] === "slice" ? "slice" : "meet";
      viewport.alignX = align.startsWith("xmin") ? 0 : align.startsWith("xmax") ? 1 : 0.5;
      viewport.alignY = align.includes("ymin") ? 0 : align.includes("ymax") ? 1 : 0.5;
    }
  } catch {
    /* unparsable text falls back to the identity mapping */
  }
  return viewport;
}

/**
 * Build the transform that maps Paper's imported coordinates onto the same
 * picture the browser rasterizes:
 *
 *  1. Paper stretches the viewBox per-axis into the width/height box and
 *     ignores preserveAspectRatio. Undo that per-axis stretch and apply the
 *     browser's uniform meet/slice mapping with its alignment offsets.
 *  2. The result sits in the intrinsic-size box; center that box on the
 *     origin (the raster pipeline centers the whole image, not the content
 *     bounds), then apply the layer transform.
 *
 * Using content bounds instead (the old behaviour) scaled every layer by
 * `viewBox / contentBounds`, which misplaced and distorted both imported
 * SVGs and hand-drawn shapes with strokes.
 */
function placeGeometry(item: paper.Item, viewport: ParsedViewport, layer: Layer): void {
  const P = getPaper();
  const vb = viewport.viewBox;
  if (vb) {
    // paper stretched viewBox → raw attr numbers (or 1:1 without attrs)
    const sxPaper = viewport.paperWidth !== null ? viewport.paperWidth / vb.width : 1;
    const syPaper = viewport.paperHeight !== null ? viewport.paperHeight / vb.height : 1;
    const bx = viewport.width / vb.width;
    const by = viewport.height / vb.height;
    let kx = 1;
    let ky = 1;
    let offX = 0;
    let offY = 0;
    if (viewport.mode === "none") {
      // browser stretches the viewBox per-axis into its intrinsic box
      kx = bx / sxPaper;
      ky = by / syPaper;
    } else {
      const s = viewport.mode === "meet" ? Math.min(bx, by) : Math.max(bx, by);
      // paper coordinate q ↔ user-space p: q = (p − vbMin) ⊙ (sxPaper, syPaper),
      // the browser draws p at s·(p − vbMin) + alignment offset
      kx = s / sxPaper;
      ky = s / syPaper;
      offX = (viewport.width - s * vb.width) * viewport.alignX;
      offY = (viewport.height - s * vb.height) * viewport.alignY;
    }
    if (kx !== 1 || ky !== 1 || offX !== 0 || offY !== 0) {
      item.transform(new P.Matrix(kx, 0, 0, ky, offX, offY));
    }
  }

  const t = layer.transform;
  // intrinsic box → displayed rect: the raster pipeline draws the image at
  // natural size × scale, centered on the layer position
  item.translate(new P.Point(-viewport.width / 2, -viewport.height / 2));
  item.scale(t.scaleX, t.scaleY, new P.Point(0, 0));
  item.rotate(t.rotation, new P.Point(0, 0));
  item.translate(new P.Point(t.x, t.y));
}

/** Leaf path items of one imported layer (single item or compound children). */
export function leafPathItems(item: paper.Item): paper.PathItem[] {
  const P = getPaper();
  return item instanceof P.PathItem
    ? [item]
    : (item.getItems({ class: P.PathItem }) as paper.PathItem[]);
}

/**
 * Import an SVG asset and place it exactly like the raster pipeline draws it:
 * intrinsic bounds → centered at origin → scaled to displayed size → rotated
 * around the center → moved to the layer position.
 */
export function importLayerGeometry(asset: LayerAsset, layer: Layer): NormalizedLayer | null {
  const P = getPaper();
  if (asset.kind !== "svg" || !asset.svgText) return null;

  const text = svgTextForLayer(asset, layer);
  const viewport = parseViewport(text, asset.naturalWidth, asset.naturalHeight);

  let imported: paper.Item;
  try {
    imported = P.project.importSVG(text, {
      expandShapes: true,
      insert: false,
    }) as paper.Item;
  } catch (e) {
    console.warn("SVG import failed", e);
    return null;
  }
  if (!imported) return null;

  const materialized = materialize(imported);
  if (!materialized) return null;

  if (!(viewport.width > 0) || !(viewport.height > 0)) return null;
  placeGeometry(materialized, viewport, layer);

  // collect filled leaf paths; SVG fill defaults to black (paper follows this)
  const buckets = new Map<string, paper.PathItem[]>();
  for (const leaf of leafPathItems(materialized)) {
    if (leaf.clipMask) continue;
    if (leaf.fillColor && !(leaf.fillColor.type === "none")) {
      const key = leaf.fillColor.toCSS(true) || String(leaf.fillColor);
      const list = buckets.get(key);
      if (list) list.push(leaf);
      else buckets.set(key, [leaf]);
    }
  }

  const filledBuckets: paper.PathItem[] = [];
  for (const paths of buckets.values()) {
    let united: paper.PathItem | null = null;
    for (const path of paths) {
      united = united ? (united.unite(path) as paper.PathItem) : path;
    }
    if (united) filledBuckets.push(united);
  }

  // union across buckets only feeds the occlusion mask (colour-independent)
  let filledGeometry: paper.PathItem | null = null;
  for (const bucket of filledBuckets) {
    filledGeometry = filledGeometry ? (filledGeometry.unite(bucket) as paper.PathItem) : bucket;
  }

  return { item: materialized, filledGeometry, filledBuckets };
}
