import { useEffect } from "react";
import { hasPendingTransaction, useEditorStore } from "../layers/layerStore";
import { useViewportStore } from "./ViewportManager";
import { useUIStore } from "../ui/uiStore";
import { SHORTCUT_TOOL, isShapeTool } from "../shapes/shapeTypes";

/** Input types that consume typing keys — everything else (range, color…) lets shortcuts through. */
const TYPING_INPUT_TYPES = new Set([
  "text",
  "number",
  "search",
  "email",
  "password",
  "tel",
  "url",
  "date",
  "time",
  "datetime-local",
]);

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type || "text";
    return TYPING_INPUT_TYPES.has(type);
  }
  return false;
}

/** Global editor keyboard shortcuts (MVP 0.2). */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog owns the keyboard: no document shortcuts behind it
      // (Delete used to remove layers while the export dialog was open).
      if (useUIStore.getState().openDialogs > 0) return;
      if (isTypingTarget(e.target)) return;
      const target = e.target as HTMLInputElement | null;
      if (target?.tagName === "INPUT" && target.type === "range" &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) return;
      const s = useEditorStore.getState();
      const vp = useViewportStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        s.selectAll();
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        vp.zoomBy(1.25);
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        vp.zoomBy(1 / 1.25);
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        vp.fit(s.canvas.width, s.canvas.height);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        s.deleteSelected();
        return;
      }
      // Esc first disarms a drawing tool, then clears the selection
      if (e.key === "Escape") {
        if (isShapeTool(s.activeTool)) s.setActiveTool("select");
        else s.clearSelection();
        return;
      }
      if (!mod && !e.altKey && SHORTCUT_TOOL[key]) {
        // Keep the shortcuts out of the way while a gesture transaction is open.
        if (!hasPendingTransaction()) {
          e.preventDefault();
          s.setActiveTool(SHORTCUT_TOOL[key]);
        }
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        s.nudgeSelected(dx, dy);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
