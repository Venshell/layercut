import { useI18n } from "../i18n";
import { PANEL_MAX, PANEL_MIN, useUIStore, type PanelSide } from "./uiStore";

/**
 * Draggable divider between the side panels and the canvas.
 * Drag to resize, double-click or chevron to collapse/expand.
 */
export function Divider({ side }: { side: PanelSide }) {
  const { t } = useI18n();
  const panel = useUIStore((s) => (side === "left" ? s.leftPanel : s.rightPanel));
  const setPanel = useUIStore((s) => s.setPanel);
  const collapsed = panel.collapsed;

  const toggle = () => setPanel(side, { collapsed: !collapsed });

  const startDrag = (e: React.MouseEvent) => {
    if (collapsed) return; // expand via the chevron / double click
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.width;
    document.body.classList.add("resizing");
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const raw = side === "left" ? startWidth + dx : startWidth - dx;
      setPanel(side, { width: Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(raw))) });
    };
    const onUp = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // chevron points toward the canvas when expanding, toward the panel when collapsing
  const chevron =
    side === "left" ? (collapsed ? "›" : "‹") : collapsed ? "‹" : "›";

  return (
    <div
      className={`divider divider-${side}${collapsed ? " collapsed" : ""}`}
      onMouseDown={startDrag}
      onDoubleClick={toggle}
      title={t("togglePanel")}
    >
      <button
        className="divider-toggle"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={toggle}
        title={t("togglePanel")}
      >
        {chevron}
      </button>
    </div>
  );
}
