import { create } from "zustand";
import { clamp } from "../utils/geometry";

/**
 * Viewport (pan / zoom) state for the canvas editor.
 * x/y is the translation of canvas-space origin in stage (screen) pixels.
 */
interface ViewportState {
  scale: number;
  x: number;
  y: number;
  stageWidth: number;
  stageHeight: number;
  setStageSize: (w: number, h: number) => void;
  set: (partial: Partial<Pick<ViewportState, "scale" | "x" | "y">>) => void;
  /** zoom keeping the given stage-space point fixed */
  zoomAt: (factor: number, stageX: number, stageY: number) => void;
  zoomBy: (factor: number) => void;
  /** fit canvas into stage with padding, centered */
  fit: (canvasW: number, canvasH: number) => void;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;
const FIT_PADDING = 48;

export const useViewportStore = create<ViewportState>((set, get) => ({
  scale: 1,
  x: 0,
  y: 0,
  stageWidth: 0,
  stageHeight: 0,

  setStageSize: (w, h) => set({ stageWidth: w, stageHeight: h }),
  set: (partial) => set(partial),

  zoomAt: (factor, stageX, stageY) => {
    const { scale, x, y } = get();
    const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const k = next / scale;
    set({ scale: next, x: stageX - (stageX - x) * k, y: stageY - (stageY - y) * k });
  },

  zoomBy: (factor) => {
    const { stageWidth, stageHeight } = get();
    get().zoomAt(factor, stageWidth / 2, stageHeight / 2);
  },


  fit: (canvasW, canvasH) => {
    const { stageWidth, stageHeight } = get();
    if (stageWidth <= 0 || stageHeight <= 0 || canvasW <= 0 || canvasH <= 0) return;
    const scale = clamp(
      Math.min((stageWidth - FIT_PADDING) / canvasW, (stageHeight - FIT_PADDING) / canvasH),
      MIN_SCALE,
      MAX_SCALE
    );
    set({
      scale,
      x: (stageWidth - canvasW * scale) / 2,
      y: (stageHeight - canvasH * scale) / 2,
    });
  },
}));
