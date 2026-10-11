import { create } from "zustand";
import type { CanvasSettings, DocumentSnapshot, Layer, PreviewMode, ProjectSnapshot } from "./layerTypes";
import { duplicateLayer, validSelection } from "./layerUtils";
import { uid } from "../utils/id";
import { isHexColor } from "../utils/color";
import {
  DEFAULT_SHAPE_STYLE,
  DEFAULT_SIDES,
  clampSides,
  type EditorTool,
  type ShapeStyle,
} from "../shapes/shapeTypes";
const HISTORY_LIMIT = 100;

function snap(s: EditorState): ProjectSnapshot {
  return { canvas: s.canvas, layers: s.layers, selectedIds: s.selectedIds };
}

/** One undo entry: the document snapshot plus the historyVersion it had. */
interface HistoryEntry {
  snapshot: ProjectSnapshot;
  version: number;
}

function sameSnapshot(a: ProjectSnapshot, b: ProjectSnapshot): boolean {
  return (
    JSON.stringify(a.canvas) === JSON.stringify(b.canvas) &&
    JSON.stringify(a.layers) === JSON.stringify(b.layers) &&
    JSON.stringify(a.selectedIds) === JSON.stringify(b.selectedIds)
  );
}

// ---------------------------------------------------------------------------
// Undo/Redo history (project plan §16).
// Commands are coarse-grained transactions: dragging calls beginTransaction()
// at drag start and commitTransaction() at drag end, so one gesture = one
// undo step. Source data (bitmaps) is never part of history.
// ---------------------------------------------------------------------------
const history = {
  past: [] as HistoryEntry[],
  future: [] as HistoryEntry[],
  pending: null as HistoryEntry | null,
};

/**
 * Monotonic version source. Undo/redo rewind historyVersion to the restored
 * entry's version (so returning to the saved state clears the dirty flag),
 * but new edits always take a fresh number — a version is never reused for
 * different content.
 */
let versionCounter = 0;

/** A document replacement (open project / new canvas) starts a clean history. */
function resetHistory(): void {
  history.past = [];
  history.future = [];
  history.pending = null;
}

interface EditorState extends ProjectSnapshot {
  // view state (not undoable, not part of history)
  previewMode: PreviewMode;
  explodeAmount: number;
  snapEnabled: boolean;
  notice: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Active tool: "select" edits existing layers, a shape kind draws a new one. */
  activeTool: EditorTool;
  /** Style applied to the next drawn shape. */
  shapeStyle: ShapeStyle;
  /** Corner count of the polygon tool / point count of the star tool. */
  shapeSides: number;
  /** current project display name ("" = untitled) */
  projectName: string;
  /** bumped on every committed content change (incl. undo/redo) */
  historyVersion: number;
  /** historyVersion at the last explicit save / load — dirty = version > savedVersion */
  savedVersion: number;
  /** Changes when the current document is replaced; guards asynchronous saves. */
  documentEpoch: number;

  // view actions
  setPreviewMode: (mode: PreviewMode) => void;
  setExplodeAmount: (v: number) => void;
  toggleSnap: () => void;
  setActiveTool: (tool: EditorTool) => void;
  setShapeStyle: (patch: Partial<ShapeStyle>) => void;
  setShapeSides: (sides: number) => void;
  setNotice: (msg: string | null) => void;
  setProjectName: (name: string) => void;
  markSaved: (version?: number, documentEpoch?: number) => void;
  /** replace the whole document (open project / recovery) */
  loadProject: (doc: { canvas: CanvasSettings; layers: Layer[]; name: string }) => void;

  // selection (changes are deliberately NOT undo steps)
  setSelection: (ids: string[]) => void;
  toggleSelection: (id: string, additive: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;

  // history control
  beginTransaction: () => void;
  commitTransaction: () => void;
  undo: () => void;
  redo: () => void;

  // canvas
  setCanvasSize: (width: number, height: number) => void;
  setCanvasBackground: (background: CanvasSettings["background"]) => void;
  newCanvas: (canvas: CanvasSettings) => void;

  // layers (commit = push an undo step; false = transient, e.g. mid-drag)
  addLayers: (layers: Layer[], select?: boolean) => void;
  replaceAllLayers: (expected: DocumentSnapshot, layer: Layer) => boolean;
  addEmptyLayer: (name?: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  updateLayer: (id: string, patch: Partial<Layer>, commit?: boolean) => void;
  setSvgPaintColor: (id: string, channel: "svgFillColor" | "svgStrokeColor", color: string | null) => void;
  updateLayerTransform: (
    id: string,
    t: Partial<Layer["transform"]>,
    commit?: boolean
  ) => void;
  setLayerDimension: (id: string, axis: "width" | "height", value: number, natural: { width: number; height: number }) => void;
  setLayersOpacity: (ids: string[], opacity: number, commit?: boolean) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  nudgeSelected: (dx: number, dy: number) => void;
}

function pushHistory(state: EditorState): Partial<EditorState> {
  if (history.past.length >= HISTORY_LIMIT) history.past.shift();
  history.past.push({ snapshot: snap(state), version: state.historyVersion });
  history.future = [];
  return { canUndo: true, canRedo: false };
}

function restore(target: ProjectSnapshot): Partial<EditorState> {
  // selection may reference layers that no longer exist
  const selectedIds = validSelection(target.layers, target.selectedIds);
  return { ...target, selectedIds, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}

function ids(layers: Layer[], selectedIds: string[]): string[] {
  return validSelection(layers, selectedIds);
}

/** True while a gesture transaction is open (beginTransaction without commit). */
export function hasPendingTransaction(): boolean {
  return history.pending !== null;
}

// ---------------------------------------------------------------------------
// Shape tool input validation. Tool settings are user input that ends up inside
// generated SVG markup, so colours are re-checked here before they are stored.
// ---------------------------------------------------------------------------
function safeColor(value: string | null): string | null {
  if (value === null) return null;
  return isHexColor(value) ? value.toLowerCase() : null;
}

function safeStrokeWidth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(200, Math.max(0, Math.round(value * 100) / 100));
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Apply committed (undoable) mutation. */
  const commitSet = (fn: (s: EditorState) => Partial<EditorState>) => {
    set((s) => {
      const patch = fn(s);
      const next = { ...s, ...patch };
      if (sameSnapshot(snap(s), snap(next)) && s.documentEpoch === next.documentEpoch) return s;
      versionCounter += 1;
      return { ...pushHistory(s), ...patch, historyVersion: versionCounter };
    });
  };
  /** Apply transient mutation (no history entry). */
  const liveSet = (fn: (s: EditorState) => Partial<EditorState>) => {
    set((s) => fn(s));
  };

  return {
    canvas: { width: 1080, height: 1920, background: "transparent" },
    layers: [],
    selectedIds: [],

    previewMode: "normal",
    explodeAmount: 0,
    snapEnabled: true,
    notice: null,
    canUndo: false,
    canRedo: false,
    activeTool: "select",
    shapeStyle: DEFAULT_SHAPE_STYLE,
    shapeSides: DEFAULT_SIDES,
    projectName: "",
    historyVersion: 0,
    savedVersion: 0,
    documentEpoch: 0,

    setPreviewMode: (mode) =>
      // Drawing is a normal-preview interaction; leaving it disarms the tool
      // instead of letting a hidden shape land while the user inspects cuts.
      set(mode === "occlusion" ? { previewMode: mode, activeTool: "select" } : { previewMode: mode }),
    setExplodeAmount: (v) => set({ explodeAmount: v }),
    toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
    setActiveTool: (tool) =>
      // Arming a shape tool also returns to normal preview: drawing is a
      // normal-mode interaction, so the tool must never look armed and do nothing.
      set((s) =>
        s.activeTool === tool && (s.previewMode === "normal" || tool === "select")
          ? s
          : { activeTool: tool, previewMode: tool === "select" ? s.previewMode : "normal" }
      ),
    setShapeStyle: (patch) =>
      set((s) => {
        const next: ShapeStyle = {
          fill: patch.fill !== undefined ? safeColor(patch.fill) : s.shapeStyle.fill,
          stroke: patch.stroke !== undefined ? safeColor(patch.stroke) : s.shapeStyle.stroke,
          strokeWidth:
            patch.strokeWidth !== undefined
              ? safeStrokeWidth(patch.strokeWidth)
              : s.shapeStyle.strokeWidth,
        };
        const same =
          next.fill === s.shapeStyle.fill &&
          next.stroke === s.shapeStyle.stroke &&
          next.strokeWidth === s.shapeStyle.strokeWidth;
        return same ? s : { shapeStyle: next };
      }),
    setShapeSides: (sides) => {
      const next = clampSides(sides);
      set((s) => (s.shapeSides === next ? s : { shapeSides: next }));
    },
    setNotice: (msg) => set({ notice: msg }),
    setProjectName: (name) => set({ projectName: name }),
    markSaved: (version = get().historyVersion, documentEpoch = get().documentEpoch) => {
      if (documentEpoch !== get().documentEpoch) return;
      set({ savedVersion: version });
    },
    loadProject: ({ canvas, layers, name }) => {
      // Replacing the document invalidates the old history: an undo step must
      // never resurrect content from another project under the new name.
      resetHistory();
      set((s) => ({
        canvas,
        layers,
        selectedIds: [],
        documentEpoch: s.documentEpoch + 1,
        projectName: name,
        savedVersion: s.historyVersion,
        activeTool: "select",
        canUndo: false,
        canRedo: false,
      }));
    },

    setSelection: (ids_) => set({ selectedIds: ids_ }),
    toggleSelection: (id, additive) =>
      set((s) => {
        if (!additive) return { selectedIds: [id] };
        const has = s.selectedIds.includes(id);
        return {
          selectedIds: has ? s.selectedIds.filter((i) => i !== id) : [...s.selectedIds, id],
        };
      }),
    selectAll: () => set((s) => ({ selectedIds: s.layers.filter((l) => !l.locked).map((l) => l.id) })),
    clearSelection: () => set({ selectedIds: [] }),

    beginTransaction: () => {
      history.pending = { snapshot: snap(get()), version: get().historyVersion };
    },
    commitTransaction: () => {
      const pending = history.pending;
      history.pending = null;
      if (!pending) return;
      const current = snap(get());
      if (sameSnapshot(pending.snapshot, current)) return; // gesture produced no change
      if (history.past.length >= HISTORY_LIMIT) history.past.shift();
      history.past.push(pending);
      history.future = [];
      versionCounter += 1;
      set({ canUndo: true, canRedo: false, historyVersion: versionCounter });
    },
    undo: () => {
      // An undo during an open gesture drops that gesture's pending snapshot;
      // letting it commit afterwards would push a stale pre-drag state and
      // wipe the redo chain (B2).
      history.pending = null;
      const entry = history.past.pop();
      if (!entry) return;
      history.future.push({ snapshot: snap(get()), version: get().historyVersion });
      // Restoring the entry's version makes "undo back to the saved state"
      // clear the dirty marker (savedVersion compares equal again).
      set({ ...restore(entry.snapshot), historyVersion: entry.version });
    },
    redo: () => {
      history.pending = null;
      const entry = history.future.pop();
      if (!entry) return;
      history.past.push({ snapshot: snap(get()), version: get().historyVersion });
      set({ ...restore(entry.snapshot), historyVersion: entry.version });
    },

    setCanvasSize: (width, height) =>
      commitSet((s) => ({ canvas: { ...s.canvas, width, height } })),
    setCanvasBackground: (background) =>
      commitSet((s) => ({ canvas: { ...s.canvas, background } })),
    newCanvas: (canvas) => {
      // Same document-boundary rule as loadProject: the replaced content is
      // not reachable through undo, so the history must not keep it.
      resetHistory();
      versionCounter += 1;
      set((s) => ({
        canvas,
        layers: [],
        selectedIds: [],
        documentEpoch: s.documentEpoch + 1,
        historyVersion: versionCounter,
        canUndo: false,
        canRedo: false,
      }));
    },
    // note: newCanvas keeps the active tool — a fresh canvas is exactly when
    // drawing is most likely to be the next action.

    addLayers: (layers, select = true) =>
      commitSet((s) => ({
        layers: [...s.layers, ...layers],
        selectedIds: select ? layers.map((l) => l.id) : s.selectedIds,
      })),
    replaceAllLayers: (expected, layer) => {
      const s = get();
      if (history.pending || s.layers !== expected.layers || s.canvas !== expected.canvas ||
          s.historyVersion !== expected.historyVersion || s.documentEpoch !== expected.documentEpoch) return false;
      commitSet(() => ({ layers: [layer], selectedIds: [layer.id] }));
      return true;
    },
    addEmptyLayer: (name) =>
      commitSet((s) => {
        const layer: Layer = {
          id: uid("layer"),
          name: name ?? "",
          type: "empty",
          assetId: null,
          transform: { x: s.canvas.width / 2, y: s.canvas.height / 2, scaleX: 1, scaleY: 1, rotation: 0 },
          opacity: 1,
          visible: true,
          locked: false,
          aspectLocked: false,
          occludesWhenHidden: false,
        };
        return { layers: [...s.layers, layer], selectedIds: [layer.id] };
      }),
    deleteSelected: () =>
      commitSet((s) => {
        const ids_ = ids(s.layers, s.selectedIds);
        // Locked layers are never modified by bulk actions (same rule as
        // transforms/opacity/reorder): only unlocked selected layers go.
        if (!s.layers.some((l) => ids_.includes(l.id) && !l.locked)) return {};
        return {
          layers: s.layers.filter((l) => !(ids_.includes(l.id) && !l.locked)),
          selectedIds: s.layers
            .filter((l) => ids_.includes(l.id) && l.locked)
            .map((l) => l.id),
        };
      }),
    duplicateSelected: () =>
      commitSet((s) => {
        const ids_ = ids(s.layers, s.selectedIds);
        const names = new Set(s.layers.map((l) => l.name));
        // The shared name set accumulates every copy's name, so duplicating
        // "A" and "A copy" together yields "A copy 2" and "A copy 3".
        const copies = s.layers
          .filter((l) => ids_.includes(l.id) && !l.locked)
          .map((l) => duplicateLayer(l, names));
        if (copies.length === 0) return {};
        return {
          layers: [...s.layers, ...copies],
          selectedIds: copies.map((l) => l.id),
        };
      }),
    updateLayer: (id, patch, commit = true) => {
      const apply = (s: EditorState): Partial<EditorState> => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      });
      commit ? commitSet(apply) : liveSet(apply);
    },
    setSvgPaintColor: (id, channel, color) => {
      if (color !== null && !isHexColor(color)) return;
      commitSet((s) => ({
        layers: s.layers.map((layer) => layer.id === id && layer.type === "svg" && !layer.locked
          ? { ...layer, [channel]: color }
          : layer),
      }));
    },
    updateLayerTransform: (id, t, commit = true) => {
      const apply = (s: EditorState): Partial<EditorState> => ({
        layers: s.layers.map((l) =>
          l.id === id && !l.locked ? { ...l, transform: { ...l.transform, ...t } } : l
        ),
      });
      commit ? commitSet(apply) : liveSet(apply);
    },
    setLayerDimension: (id, axis, value, natural) => {
      if (!Number.isFinite(value) || value <= 0 || natural.width <= 0 || natural.height <= 0) return;
      commitSet((s) => ({
        layers: s.layers.map((layer) => {
          if (layer.id !== id || layer.locked) return layer;
          const current = layer.transform;
          const primary = axis === "width" ? "scaleX" : "scaleY";
          const secondary = axis === "width" ? "scaleY" : "scaleX";
          const nextScale = value / natural[axis];
          const ratio = current[primary] === 0 ? 1 : nextScale / current[primary];
          const next = {
            ...current,
            [primary]: nextScale,
            ...(layer.aspectLocked ? { [secondary]: current[secondary] * ratio } : {}),
          };
          // Keep the top-left corner anchored, matching Transformer handle
          // drags — scaling around the center alone makes both edges drift.
          const dw = natural.width * (next.scaleX - current.scaleX);
          const dh = natural.height * (next.scaleY - current.scaleY);
          const th = (current.rotation * Math.PI) / 180;
          const cos = Math.cos(th);
          const sin = Math.sin(th);
          return {
            ...layer,
            transform: {
              ...next,
              x: current.x + (dw / 2) * cos - (dh / 2) * sin,
              y: current.y + (dw / 2) * sin + (dh / 2) * cos,
            },
          };
        }),
      }));
    },
    setLayersOpacity: (ids_, opacity, commit = true) => {
      const apply = (s: EditorState): Partial<EditorState> => ({
        layers: s.layers.map((l) => (ids_.includes(l.id) && !l.locked ? { ...l, opacity } : l)),
      });
      commit ? commitSet(apply) : liveSet(apply);
    },
    reorder: (fromIndex, toIndex) =>
      commitSet((s) => {
        // Out-of-range indices are clamped instead of splicing `undefined`
        // into the stack (a stale display index from a concurrent change).
        const n = s.layers.length;
        if (n === 0) return {};
        const from = Math.min(n - 1, Math.max(0, Math.round(fromIndex)));
        const to = Math.min(n - 1, Math.max(0, Math.round(toIndex)));
        if (from === to) return {};
        const next = [...s.layers];
        const [moved] = next.splice(from, 1);
        if (!moved) return {};
        next.splice(to, 0, moved);
        return { layers: next };
      }),
    nudgeSelected: (dx, dy) =>
      commitSet((s) => {
        const ids_ = ids(s.layers, s.selectedIds);
        if (ids_.length === 0) return {};
        return {
          layers: s.layers.map((l) =>
            ids_.includes(l.id) && !l.locked
              ? { ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } }
              : l
          ),
        };
      }),
  };
});
