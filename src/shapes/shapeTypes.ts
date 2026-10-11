/**
 * Simple shape drawing (patterns) — project plan §17 "画笔/图案" 的轻量子集。
 *
 * A drawn shape is not a new kind of layer: it is generated as a one-path SVG
 * document and imported as a normal `svg` layer asset. Everything downstream
 * (occlusion, both preview modes, PNG export, SVG vector export, recolouring,
 * project saving) therefore works without special cases, and the project file
 * format is unchanged.
 */

export type ShapeKind = "rect" | "ellipse" | "line" | "polygon" | "star";

/** The select tool edits existing layers; every other tool draws a new one. */
export type EditorTool = "select" | ShapeKind;

export interface Point {
  x: number;
  y: number;
}

/** A drag gesture: start and current endpoint in canvas coordinates. */
export interface Drag {
  from: Point;
  to: Point;
}

export interface ShapeStyle {
  /** `#rrggbb`, or null for no fill. Lines are never filled. */
  fill: string | null;
  /** `#rrggbb`, or null for no stroke. */
  stroke: string | null;
  /** Canvas pixels at layer scale 1; ignored while stroke is null. */
  strokeWidth: number;
}

export const SHAPE_KINDS: readonly ShapeKind[] = ["rect", "ellipse", "line", "polygon", "star"];

/** Single-key shortcuts (V/R/O/L/P/S) — one source for toolbar titles and useKeyboard. */
export const TOOL_SHORTCUT: Record<EditorTool, string> = {
  select: "V",
  rect: "R",
  ellipse: "O",
  line: "L",
  polygon: "P",
  star: "S",
};

/** Inverse of TOOL_SHORTCUT for key handlers. */
export const SHORTCUT_TOOL = Object.fromEntries(
  (Object.keys(TOOL_SHORTCUT) as (keyof typeof TOOL_SHORTCUT)[]).map(
    (tool) => [TOOL_SHORTCUT[tool].toLowerCase(), tool]
  )
) as Record<string, EditorTool>;

export function isShapeTool(tool: EditorTool): tool is ShapeKind {
  return tool !== "select";
}

/** Corner count of the polygon tool; the star tool reads it as point count. */
export const SIDES_MIN = 3;
export const SIDES_MAX = 12;
/** Inner/outer radius ratio of the star tool. */
export const STAR_INNER_RATIO = 0.5;
/** Degenerate geometry is clamped to this size so a path is always drawable. */
export const MIN_SHAPE_SIZE = 1;
/** A drag shorter than this (canvas px) counts as a click. */
export const MIN_DRAG_SIZE = 3;
/** Shape created by a click without dragging (canvas px). */
export const CLICK_SHAPE_SIZE = 200;

/** Colour restored when a disabled paint channel is switched back on. */
export const DEFAULT_FILL_COLOR = "#4f8cff";
export const DEFAULT_STROKE_COLOR = "#e6e7ea";

export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: DEFAULT_FILL_COLOR,
  stroke: null,
  strokeWidth: 4,
};

export const DEFAULT_SIDES = 6;

/** Corner/point count of polygon & star tools, clamped into the 3–12 range. */
export function clampSides(sides: number | undefined): number {
  if (!Number.isFinite(sides)) return DEFAULT_SIDES;
  return Math.min(SIDES_MAX, Math.max(SIDES_MIN, Math.round(sides as number)));
}
