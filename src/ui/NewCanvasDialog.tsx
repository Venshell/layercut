import { useState } from "react";
import { useI18n } from "../i18n";
import { useEditorStore } from "../layers/layerStore";
import { releaseAssetsExcept } from "../assets/assetStore";
import type { CanvasSettings } from "../layers/layerTypes";
import { CanvasSetupForm } from "./CanvasSetupForm";
import { Dialog } from "./Dialog";

export function NewCanvasDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const canvas = useEditorStore((s) => s.canvas);
  const [width, setWidth] = useState(String(canvas.width));
  const [height, setHeight] = useState(String(canvas.height));
  const [background, setBackground] = useState<CanvasSettings["background"]>(canvas.background);

  const create = () => {
    const w = Math.min(8192, Math.max(1, Math.round(Number(width) || 0)));
    const h = Math.min(8192, Math.max(1, Math.round(Number(height) || 0)));
    if (w <= 0 || h <= 0) return;
    useEditorStore.getState().newCanvas({ width: w, height: h, background });
    // the replaced document is unreachable (history reset) — free its sources
    releaseAssetsExcept(new Set());
    onClose();
  };

  return (
    <Dialog title={t("newCanvasTitle")} onClose={onClose}>
      <CanvasSetupForm
        width={width}
        height={height}
        background={background}
        onChange={(next) => {
          if (next.width !== undefined) setWidth(next.width);
          if (next.height !== undefined) setHeight(next.height);
          if (next.background !== undefined) setBackground(next.background);
        }}
      />
      <p className="dialog-note">{t("createNote")}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {t("cancel")}
        </button>
        <button className="btn accent" onClick={create}>
          {t("create")}
        </button>
      </div>
    </Dialog>
  );
}
