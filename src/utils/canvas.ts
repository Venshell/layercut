/** Shared low-level canvas helpers. */

type AnyCanvas = HTMLCanvasElement;

/**
 * Create a 2D canvas. Regular HTMLCanvasElement is used (not OffscreenCanvas)
 * because Konva.Image consumes it directly; the code paths here are the only
 * places that would need to change to move rendering into a Web Worker later.
 */
export function create2DCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

let checkerTile: HTMLCanvasElement | null = null;

/** 16px dark-theme transparency checker tile, built once. */
export function getCheckerTile(): HTMLCanvasElement {
  if (checkerTile) return checkerTile;
  const { canvas, ctx } = create2DCanvas(16, 16);
  ctx.fillStyle = "#26272d";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#1d1e23";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  checkerTile = canvas;
  return canvas;
}
