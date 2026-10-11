/**
 * Shape → SVG geometry. Pure: canvas coordinates in, SVG document out.
 *
 * The generated document is tightly fitted to the shape's bounding box plus
 * half the stroke width on every side, so a stroke is never clipped by the
 * viewBox. The layer that wraps it is placed with scale 1 and its centre on the
 * bounding-box centre, which makes the drawn shape land exactly where the user
 * dragged it.
 */
import {
  CLICK_SHAPE_SIZE,
  MIN_DRAG_SIZE,
  MIN_SHAPE_SIZE,
  SIDES_MIN,
  STAR_INNER_RATIO,
  clampSides,
  type Drag,
  type Point,
  type ShapeKind,
  type ShapeStyle,
} from "./shapeTypes";
import { isHexColor } from "../utils/color";

export interface ShapeGeometry {
  /** SVG path data in local coordinates; origin = top-left of the padded box */
  d: string;
  /** the complete SVG document stored as the layer asset */
  svg: string;
  /** natural size of the generated SVG = bounding box + stroke padding */
  width: number;
  height: number;
  /** top-left of the padded box in canvas coordinates (live preview placement) */
  origin: Point;
  /** layer transform centre in canvas coordinates = bounding-box centre */
  center: Point;
}

/** Attribute-safe colour: anything unexpected degrades to "none". */
function color(value: string | null): string {
  return value && isHexColor(value) ? value.toLowerCase() : "none";
}

export interface ResolvedShapeStyle {
  /** null = not painted; always null for a line */
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

/** Paint actually used for a shape — shared by the SVG writer and the preview. */
export function resolveShapeStyle(kind: ShapeKind, style: ShapeStyle): ResolvedShapeStyle {
  const fill = color(style.fill);
  const stroke = color(style.stroke);
  const stroked = stroke !== "none";
  return {
    fill: kind === "line" || fill === "none" ? null : fill,
    stroke: stroked ? stroke : null,
    strokeWidth: stroked && Number.isFinite(style.strokeWidth) ? Math.max(0, style.strokeWidth) : 0,
  };
}

/** Compact number formatting (max 3 decimals, no "-0"). */
function fmtNum(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function moveTo(points: Point[], close: boolean): string {
  const [first, ...rest] = points;
  const parts = [`M ${fmtNum(first.x)},${fmtNum(first.y)}`];
  for (const p of rest) parts.push(`L ${fmtNum(p.x)},${fmtNum(p.y)}`);
  if (close) parts.push("Z");
  return parts.join(" ");
}

/**
 * Vertices of a regular polygon inscribed in the box around (cx, cy).
 * `innerRatio` turns it into a star (alternating outer/inner vertices).
 */
function polygonPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sides: number,
  innerRatio: number | null
): Point[] {
  const count = clampSides(sides);
  const step = 360 / count;
  const points: Point[] = [];
  const at = (angleDeg: number, scale: number): Point => {
    const a = (angleDeg * Math.PI) / 180;
    return { x: cx + rx * scale * Math.cos(a), y: cy + ry * scale * Math.sin(a) };
  };
  for (let i = 0; i < count; i++) {
    // -90° puts the first vertex at the top of the box
    points.push(at(-90 + i * step, 1));
    if (innerRatio !== null) points.push(at(-90 + step / 2 + i * step, innerRatio));
  }
  return points;
}

function pathData(
  kind: ShapeKind,
  box: { x0: number; y0: number; x1: number; y1: number },
  from: Point,
  to: Point,
  sides: number
): string {
  const { x0, y0, x1, y1 } = box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;

  switch (kind) {
    case "rect":
      return `M ${fmtNum(x0)},${fmtNum(y0)} H ${fmtNum(x1)} V ${fmtNum(y1)} H ${fmtNum(x0)} Z`;
    case "ellipse":
      // two half arcs; the large-arc/sweep flags are independent of direction
      return (
        `M ${fmtNum(cx - rx)},${fmtNum(cy)} ` +
        `A ${fmtNum(rx)},${fmtNum(ry)} 0 1 0 ${fmtNum(cx + rx)},${fmtNum(cy)} ` +
        `A ${fmtNum(rx)},${fmtNum(ry)} 0 1 0 ${fmtNum(cx - rx)},${fmtNum(cy)} Z`
      );
    case "line":
      return moveTo([from, to], false);
    case "polygon":
      return moveTo(polygonPoints(cx, cy, rx, ry, sides, null), true);
    case "star":
      return moveTo(polygonPoints(cx, cy, rx, ry, sides, STAR_INNER_RATIO), true);
  }
}

/**
 * Build the SVG for one drawn shape.
 * `from`/`to` are the drag endpoints in canvas coordinates.
 */
export function shapeGeometry(opts: {
  kind: ShapeKind;
  from: Point;
  to: Point;
  style: ShapeStyle;
  sides?: number;
}): ShapeGeometry {
  const { kind, from, to, style } = opts;
  const resolved = resolveShapeStyle(kind, style);
  const fill = resolved.fill ?? "none";
  const stroke = resolved.stroke ?? "none";
  const strokeWidth = resolved.strokeWidth;
  const pad = strokeWidth / 2;

  const left = Math.min(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const width = Math.max(Math.abs(to.x - from.x), MIN_SHAPE_SIZE);
  const height = Math.max(Math.abs(to.y - from.y), MIN_SHAPE_SIZE);

  const box = { x0: pad, y0: pad, x1: pad + width, y1: pad + height };
  // For a line the drag direction matters, so map both endpoints into the box.
  const local = (p: Point): Point => ({ x: pad + (p.x - left), y: pad + (p.y - top) });
  const d = pathData(kind, box, local(from), local(to), opts.sides ?? SIDES_MIN);

  const totalWidth = width + pad * 2;
  const totalHeight = height + pad * 2;
  const strokeAttrs =
    stroke === "none"
      ? ""
      : ` stroke="${stroke}" stroke-width="${fmtNum(strokeWidth)}" stroke-linejoin="round"` +
        (kind === "line" ? ' stroke-linecap="round"' : "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmtNum(totalWidth)}" height="${fmtNum(totalHeight)}" ` +
    `viewBox="0 0 ${fmtNum(totalWidth)} ${fmtNum(totalHeight)}">` +
    `<path d="${d}" fill="${fill}"${strokeAttrs}/></svg>`;

  return {
    d,
    svg,
    width: totalWidth,
    height: totalHeight,
    origin: { x: left - pad, y: top - pad },
    center: { x: left + width / 2, y: top + height / 2 },
  };
}

/** True when a drag was too short to mean anything (treated as a click). */
export function isClickDrag(from: Point, to: Point): boolean {
  return Math.abs(to.x - from.x) < MIN_DRAG_SIZE && Math.abs(to.y - from.y) < MIN_DRAG_SIZE;
}

/** Drag that produces a default-sized shape centred on a click. */
export function defaultDrag(
  center: Point,
  size = CLICK_SHAPE_SIZE
): Drag {
  const half = size / 2;
  return {
    from: { x: center.x - half, y: center.y - half },
    to: { x: center.x + half, y: center.y + half },
  };
}

/**
 * Modifier keys for a drag gesture:
 * Shift constrains to a square / circle / 45° line, Alt draws from the centre.
 */
export function constrainDrag(
  from: Point,
  to: Point,
  opts: { square?: boolean; fromCenter?: boolean } = {}
): Drag {
  const { square = false, fromCenter = false } = opts;
  if (!square && !fromCenter) return { from, to };
  const sign = (v: number) => (v < 0 ? -1 : 1);

  if (fromCenter) {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    if (square) {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      dx = sign(dx) * size;
      dy = sign(dy) * size;
    }
    return {
      from: { x: from.x - dx, y: from.y - dy },
      to: { x: from.x + dx, y: from.y + dy },
    };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return { from, to: { x: from.x + sign(dx) * size, y: from.y + sign(dy) * size } };
}
