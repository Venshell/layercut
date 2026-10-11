import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { useEditorStore } from "../layers/layerStore";
import { useAssetStore } from "../assets/assetStore";
import { validSelection } from "../layers/layerUtils";
import {
  checkSvgExportGate,
  exportLayers,
  planExportFiles,
  type ExportDestination,
  type ExportFormat,
  type ExportScope,
} from "../export/exportAll";
import type { FileNameOverrides } from "../export/naming";
import { readExportConfig, writeExportConfig, type StoredExportConfig } from "../project/exportConfig";
import { TextField } from "./controls";
import { Dialog } from "./Dialog";

const SCALES = [1, 2, 4];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const layers = useEditorStore((s) => s.layers);
  const rawSelection = useEditorStore((s) => s.selectedIds);
  const selectedIds = validSelection(layers, rawSelection);
  const assets = useAssetStore((s) => s.assets);

  const visibleCount = layers.filter((l) => l.visible).length;

  // SVG availability (§7.3) — the exact gate the writer applies, evaluated
  // once per document change instead of on every keystroke.
  const saved = useMemo(() => readExportConfig() as StoredExportConfig | undefined, []);
  const svgStatus = useMemo(() => {
    if (visibleCount === 0) return { ok: false, reason: t("needLayers") };
    const gate = checkSvgExportGate(layers, assets);
    if (gate.ok) return { ok: true, reason: "" };
    const reason =
      gate.code === "svg_needs_all_svg"
        ? t("svgOnlyAllSvg")
        : gate.code === "svg_partial_opacity"
          ? t("svgPartialOpacity")
          : `${t("svgUnsafe")}: ${gate.offending?.join(", ") ?? ""}`;
    return { ok: false, reason };
  }, [layers, assets, visibleCount, t]);

  const selectionDefault: ExportScope =
    selectedIds.length === 1 ? "current" : selectedIds.length > 1 ? "selected" : "all";
  const initialScope: ExportScope =
    saved?.scope === "current" && selectedIds.length !== 1
      ? selectionDefault
      : saved?.scope === "selected" && selectedIds.length === 0
        ? selectionDefault
        : (saved?.scope ?? selectionDefault);
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>(saved?.format === "svg" && svgStatus.ok ? "svg" : "png");
  const savedScale = saved?.scale;
  const [scale, setScale] = useState<number>(
    savedScale && SCALES.includes(savedScale) ? savedScale : savedScale ? 0 : 1
  );
  const [customScale, setCustomScale] = useState(String(savedScale ?? "2"));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const folderAvailable = "showDirectoryPicker" in window && typeof window.showDirectoryPicker === "function";
  const [destination, setDestination] = useState<ExportDestination>(folderAvailable ? "folder" : "zip");

  // an empty or unparsable input falls back to 1x; 0 clamps to the 0.1 minimum
  const parsedScale = Number(customScale);
  const effectiveScale = scale === 0
    ? Math.min(8, Math.max(0.1, Number.isFinite(parsedScale) ? parsedScale : 1))
    : scale;
  const ext = format === "svg" ? "svg" : "png";
  const svgDisabled = format === "svg" && (!svgStatus.ok || scope === "composite");

  // Renames are kept per output key (layer id, or "composite") and survive
  // scope/format changes, so switching format only swaps the extension.
  const [overrides, setOverrides] = useState<FileNameOverrides>({});
  const plan = useMemo(
    () => planExportFiles({ layers, selectedIds, scope, ext, assets, overrides }),
    [layers, selectedIds, scope, ext, assets, overrides]
  );
  const renamed = Object.keys(overrides).length > 0;

  const scopeOptions: { value: ExportScope; label: string; disabled: boolean }[] = [
    { value: "current", label: t("scopeCurrent"), disabled: selectedIds.length !== 1 },
    { value: "selected", label: t("scopeSelected"), disabled: selectedIds.length === 0 },
    { value: "all", label: t("scopeAll"), disabled: visibleCount === 0 },
    { value: "composite", label: t("scopeComposite"), disabled: visibleCount === 0 },
  ];

  const run = async () => {
    setBusy(true);
    setProgress(t("exporting"));
    try {
      const result = await exportLayers(
        scope,
        effectiveScale,
        format,
        (done, total) => setProgress(`${t("exporting")} ${done}/${total}`),
        destination,
        overrides
      );
      if (result === "cancelled") setProgress(t("exportCancelled"));
      else {
        writeExportConfig({ scope, scale: effectiveScale, format });
        setProgress(`${t("exported")} ✓`);
        setTimeout(onClose, 600);
      }
    } catch (e) {
      console.error(e);
      const err = e as Error & { code?: string; offending?: string[] };
      const code = err.code ?? err.message;
      if (code === "svg_needs_all_svg") setProgress(t("svgOnlyAllSvg"));
      else if (code === "svg_partial_opacity") setProgress(t("svgPartialOpacity"));
      else if (code === "svg_unsafe") setProgress(`${t("svgUnsafe")}: ${err.offending?.join(", ") ?? ""}`);
      else if (code === "svg_composite_unsupported") setProgress(t("svgCompositeUnavailable"));
      else if (code === "export_layer_missing") setProgress(`${t("exportFailed")} (export_layer_missing)`);
      else setProgress(`⚠ ${t("exportFailed")}`);
    } finally {
      setBusy(false);
    }
  };

  const canExport =
    scope === "composite" ? visibleCount > 0 && format === "png" : plan.length > 0 && !svgDisabled;

  return (
    <Dialog title={t("exportTitle")} onClose={onClose}>
      <div className="field-label">{t("exportDestination")}</div>
        <div className="scale-row">
          <button className={`preset${destination === "folder" ? " active" : ""}`}
            disabled={busy || !folderAvailable} onClick={() => setDestination("folder")}>
            {t("exportToFolder")}
          </button>
          <button className={`preset${destination === "zip" ? " active" : ""}`}
            disabled={busy} onClick={() => setDestination("zip")}>
            {t("exportToZip")}
          </button>
        </div>
        {destination === "folder" && <p className="dialog-note">{t("folderRestrictedHint")}</p>}

        <div className="field-label">{t("scope")}</div>
        <div className="preset-grid">
          {scopeOptions.map((o) => (
            <button
              key={o.value}
              className={`preset${scope === o.value ? " active" : ""}`}
              disabled={o.disabled}
              onClick={() => setScope(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="field-label">{t("format")}</div>
        <div className="scale-row">
          <button
            className={`preset${format === "png" ? " active" : ""}`}
            onClick={() => setFormat("png")}
          >
            {t("formatPng")}
          </button>
          <button
            className={`preset${format === "svg" ? " active" : ""}`}
            disabled={!svgStatus.ok}
            title={svgStatus.ok ? t("formatSvg") : svgStatus.reason}
            onClick={() => setFormat("svg")}
          >
            {t("formatSvg")}
          </button>
        </div>
        {format === "svg" && scope === "composite" && (
          <p className="dialog-note warn">{t("svgCompositeUnavailable")}</p>
        )}
        {format === "svg" && !svgStatus.ok && <p className="dialog-note warn">{svgStatus.reason}</p>}

        <div className="field-label">{t("scale")}</div>
        <div className="scale-row">
          {SCALES.map((s) => (
            <button
              key={s}
              className={`preset${scale === s ? " active" : ""}`}
              onClick={() => setScale(s)}
            >
              {s}x
            </button>
          ))}
          <button className={`preset${scale === 0 ? " active" : ""}`} onClick={() => setScale(0)}>
            {t("custom")}
          </button>
          {scale === 0 && (
            <TextField
              type="number"
              className="scale-input"
              min={0.1}
              max={8}
              step={0.5}
              value={customScale}
              onChange={(e) => setCustomScale(e.target.value)}
            />
          )}
        </div>

        <div className="file-list-head">
          <span className="field-label">{t("filePreview")}</span>
          {renamed && (
            <button className="btn small" type="button" disabled={busy} onClick={() => setOverrides({})}>
              {t("exportResetNames")}
            </button>
          )}
        </div>
        <div className="file-list">
          {plan.length === 0 ? (
            <span className="muted">{visibleCount === 0 ? t("needLayers") : t("needSelection")}</span>
          ) : (
            plan.map((file) => {
              const edited = overrides[file.key];
              const shown = edited !== undefined ? edited : file.base;
              return (
                <div key={file.key} className="file-item">
                  <TextField
                    className="file-name-input"
                    value={shown}
                    disabled={busy}
                    spellCheck={false}
                    aria-label={t("exportFileName")}
                    title={t("exportFileName")}
                    onChange={(e) =>
                      setOverrides((prev) => ({ ...prev, [file.key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <span className="file-ext">.{ext}</span>
                  {`${shown}.${ext}` !== file.fileName && (
                    <span className="file-resolved" title={file.fileName}>
                      → {file.fileName}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
        <p className="dialog-note">
          {t("exportNameHint")}
          <br />
          {format === "svg"
            ? t("svgOnlyAllSvg")
            : destination === "folder"
              ? t("folderTip")
              : t("zipTip")}
          {" · "}
          {t("hiddenLayersSkipped")}
        </p>

        <div className="dialog-actions">
          <span className="progress-text">{progress}</span>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button className="btn accent" onClick={run} disabled={busy || !canExport}>
            {t("exportBtn")}
          </button>
        </div>
    </Dialog>
  );
}
