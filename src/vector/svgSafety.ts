/**
 * Vector-safety analysis (project plan §6 Phase 2 / §7.3):
 * SVG export is only offered when every visible layer parses into supported
 * geometry. Unsupported elements make "Boolean Result Vector-safe" false.
 *
 * Supported (v0.4 scope): svg, g, defs, path, rect, circle, ellipse,
 * polygon, polyline, line, use, symbol, gradients (paint only).
 * Unsupported: text, image, filter, mask, clipPath, pattern, style, SMIL.
 */

const SAFE_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
  "use",
  "symbol",
  "title",
  "desc",
  "metadata",
  "lineargradient",
  "radialgradient",
  "stop",
]);

export interface SvgSafety {
  safe: boolean;
  offending: string[];
}

export function analyzeSvgSafety(svgText: string): SvgSafety {
  const offending = new Set<string>();
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror")) return { safe: false, offending: ["parse-error"] };
    const walk = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (!SAFE_TAGS.has(tag)) offending.add(el.tagName);
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(doc.documentElement);
  } catch {
    return { safe: false, offending: ["parse-error"] };
  }
  return { safe: offending.size === 0, offending: [...offending] };
}

const ALPHA_PROPERTIES = ["opacity", "fill-opacity", "stroke-opacity"] as const;

function alphaOf(value: string): number | null {
  const v = value.trim();
  if (/percent$/i.test(v)) {
    const pct = parseFloat(v);
    return Number.isFinite(pct) ? pct / 100 : null;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the source paints anything between invisible and fully opaque
 * (element alpha, per-channel alpha, or a partially opaque group). Vector
 * boolean output has no alpha, so such layers are rejected instead of being
 * silently flattened (svg_partial_opacity contract).
 */
export function svgHasPartialAlpha(svgText: string): boolean {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    if (doc.querySelector("parsererror")) return false;
    const elements: Element[] = [doc.documentElement];
    while (elements.length > 0) {
      const el = elements.pop()!;
      const style = (el as SVGElement).style;
      for (const prop of ALPHA_PROPERTIES) {
        const raw = style?.getPropertyValue(prop) || el.getAttribute(prop);
        if (raw === null) continue;
        const alpha = alphaOf(raw);
        // alpha 0 contributes nothing and stays representable
        if (alpha !== null && alpha > 0 && alpha < 1) return true;
      }
      for (const child of Array.from(el.children)) elements.push(child);
    }
  } catch {
    /* unparsable source is someone else's error */
  }
  return false;
}
