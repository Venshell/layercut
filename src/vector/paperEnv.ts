/**
 * Module-level Paper.js environment for the vector pipeline (v0.4–v0.6).
 * Paper is a singleton library; all vector work happens in one offscreen
 * project that gets cleared between operations.
 */
import paper from "paper";

let initialized = false;

export function getPaper(): typeof paper {
  if (!initialized) {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    paper.setup(canvas);
    initialized = true;
  }
  return paper;
}

/** Clear the shared offscreen project. */
export function resetProject(): void {
  getPaper().project.clear();
}

export type PaperPathItem = paper.PathItem;
