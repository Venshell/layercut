import { useState } from "react";
import { useI18n } from "../i18n";
import { useEditorStore } from "../layers/layerStore";
import { saveProjectAs } from "../project/saveProject";
import { TextField } from "./controls";
import { Dialog } from "./Dialog";

export function SaveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const currentName = useEditorStore((s) => s.projectName);
  const [name, setName] = useState(currentName || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (await saveProjectAs(name)) onClose();
      else setBusy(false);
    } catch (e) {
      console.error(e);
      useEditorStore.getState().setNotice(`⚠ ${t("saveFailed")}`);
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("saveTitle")} onClose={onClose}>
      <div className="field-label">{t("projectName")}</div>
      <TextField
        autoFocus
        value={name}
        placeholder={t("unnamedProject")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
      />
      <p className="dialog-note">{t("saveNote")}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </button>
        <button className="btn accent" onClick={() => void save()} disabled={busy}>
          {t("save")}
        </button>
      </div>
    </Dialog>
  );
}
