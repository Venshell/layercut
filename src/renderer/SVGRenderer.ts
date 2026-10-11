/**
 * SVG rasterization helpers (Phase 1 strategy, project plan §6):
 * SVG is rasterized by the browser and participates in occlusion like a PNG.
 * The original text is kept in the asset for Phase 2 vector boolean.
 */

export interface SVGSize {
  width: number;
  height: number;
}

/**
 * Intrinsic size the browser actually decodes the SVG at.
 *
 * The loaded <img> is authoritative: it accounts for every CSS length unit,
 * the viewBox and preserveAspectRatio together. Parsing width/height by hand
 * covered only a subset of units (no pc/q, no scientific notation) and fell
 * back to the viewBox when it failed, so the PNG path and the SVG vector path
 * disagreed about the same file — `10pc` decoded at 160px but was treated as
 * 50px. Aspect ratio was never wrong, but the absolute size was.
 */
export function svgSizeOf(img: HTMLImageElement, svgText: string): SVGSize {
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    return { width: img.naturalWidth, height: img.naturalHeight };
  }
  // A browser that reports nothing for a dimensionless document: fall back to
  // the viewBox, then to the SVG default intrinsic size.
  return viewBoxSize(svgText) ?? { width: 300, height: 150 };
}

function viewBoxSize(svgText: string): SVGSize | null {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const vb = doc.documentElement?.getAttribute("viewBox");
    if (!vb) return null;
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  } catch {
    /* unparsable source */
  }
  return null;
}

/** Load SVG text into an <img> the browser can draw (vector-crisp on drawImage). */
export function loadSVGImage(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG decode failed"));
    };
    img.src = url;
  });
}
