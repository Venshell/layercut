import { create } from "zustand";

/** Left/right panel layout state — resizeable + collapsible, persisted. */

export interface PanelState {
  width: number;
  collapsed: boolean;
}

export type PanelSide = "left" | "right";

interface UIState {
  leftPanel: PanelState;
  rightPanel: PanelState;
  /** how many modal dialogs are open — global editor shortcuts yield to them */
  openDialogs: number;
  setPanel: (side: PanelSide, partial: Partial<PanelState>) => void;
  setDialogOpen: (open: boolean) => void;
}

export const PANEL_MIN = 190;
export const PANEL_MAX = 460;

const STORAGE_KEY = "layercut.panels";
const DEFAULTS: { leftPanel: PanelState; rightPanel: PanelState } = {
  leftPanel: { width: 250, collapsed: false },
  rightPanel: { width: 272, collapsed: false },
};

const keyOf: Record<PanelSide, "leftPanel" | "rightPanel"> = {
  left: "leftPanel",
  right: "rightPanel",
};

function clampWidth(w: number): number {
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
}

function load(): { leftPanel: PanelState; rightPanel: PanelState } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { leftPanel: DEFAULTS.leftPanel, rightPanel: DEFAULTS.rightPanel };
    const v = JSON.parse(raw);
    return {
      leftPanel: {
        width: clampWidth(v?.leftPanel?.width ?? DEFAULTS.leftPanel.width),
        collapsed: v?.leftPanel?.collapsed === true,
      },
      rightPanel: {
        width: clampWidth(v?.rightPanel?.width ?? DEFAULTS.rightPanel.width),
        collapsed: v?.rightPanel?.collapsed === true,
      },
    };
  } catch {
    return { leftPanel: DEFAULTS.leftPanel, rightPanel: DEFAULTS.rightPanel };
  }
}

export const useUIStore = create<UIState>((set, get) => ({
  ...load(),
  openDialogs: 0,
  setPanel: (side, partial) => {
    const key = keyOf[side];
    const next = { ...get()[key], ...partial };
    if (typeof next.width === "number") next.width = clampWidth(next.width);
    set({ [key]: next } as Pick<UIState, "leftPanel" | "rightPanel">);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ leftPanel: get().leftPanel, rightPanel: get().rightPanel })
      );
    } catch {
      /* ignore */
    }
  },
  setDialogOpen: (open) =>
    set((s) => ({ openDialogs: Math.max(0, s.openDialogs + (open ? 1 : -1)) })),
}));
