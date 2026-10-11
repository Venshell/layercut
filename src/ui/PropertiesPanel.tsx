import { useI18n } from "../i18n";
import { useEditorStore, hasPendingTransaction } from "../layers/layerStore";
import { useAssetStore } from "../assets/assetStore";
import { validSelection, findLayer } from "../layers/layerUtils";
import { getLayerSize } from "../utils/geometry";
import { NumberField, SliderField, ColorField } from "./controls";
import { AspectLockIcon } from "./icons";

/** Commit helper: inside a drag transaction → finish it; click-jump → one committed step. */
function commitOpacity(ids: string[], v: number) {
  const store = useEditorStore.getState();
  if (!hasPendingTransaction()) store.beginTransaction();
  store.setLayersOpacity(ids, v / 100, false);
  store.commitTransaction();
}

export function PropertiesPanel({ width, collapsed }: { width: number; collapsed: boolean }) {
  const { t } = useI18n();
  const layers = useEditorStore((s) => s.layers);
  const canvas = useEditorStore((s) => s.canvas);
  const selectedIds = useEditorStore((s) => validSelection(s.layers, s.selectedIds));
  const assets = useAssetStore((s) => s.assets);

  const single = selectedIds.length === 1 ? findLayer(layers, selectedIds[0]) : undefined;
  const asset = single?.assetId ? assets[single.assetId] ?? null : null;
  const natural = asset ? { width: asset.naturalWidth, height: asset.naturalHeight } : null;
  const size = single ? getLayerSize(single, natural) : null;

  // Multi-selection opacity: show the shared value, or flag that they differ.
  // Showing a hard-coded 100% misreported every selection that wasn't fully
  // opaque, and the first drag then overwrote all of them with that value.
  const selectedLayers = layers.filter((l) => selectedIds.includes(l.id));
  const firstOpacity = selectedLayers[0]?.opacity ?? 1;
  const mixedOpacity = selectedLayers.some((l) => l.opacity !== firstOpacity);
  const selectionOpacity = Math.round(firstOpacity * 100);

  return (
    <div
      className={`panel properties-panel${collapsed ? " panel-collapsed" : ""}`}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="panel-title">{t("properties")}</div>

      {single && (
        <div className="props-body">
          <div className="prop-layer-name" title={single.name}>
            {single.name || "—"}
          </div>

          <div className="form-row">
            <label>
              <span className="field-label">{t("x")}</span>
              <NumberField
                value={single.transform.x}
                disabled={single.locked}
                onCommit={(v) =>
                  useEditorStore.getState().updateLayerTransform(single.id, { x: v })
                }
              />
            </label>
            <label>
              <span className="field-label">{t("y")}</span>
              <NumberField
                value={single.transform.y}
                disabled={single.locked}
                onCommit={(v) =>
                  useEditorStore.getState().updateLayerTransform(single.id, { y: v })
                }
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              <span className="field-label">{t("width")}</span>
              <NumberField
                value={size?.width ?? 0}
                disabled={single.locked}
                min={1}
                onCommit={(v) => {
                  if (!natural || natural.width === 0) return;
                  useEditorStore.getState().setLayerDimension(single.id, "width", v, natural);
                }}
              />
            </label>
            <label>
              <span className="field-label">{t("height")}</span>
              <NumberField
                value={size?.height ?? 0}
                disabled={single.locked}
                min={1}
                onCommit={(v) => {
                  if (!natural || natural.height === 0) return;
                  useEditorStore.getState().setLayerDimension(single.id, "height", v, natural);
                }}
              />
            </label>
          </div>

          {single.type !== "empty" && (
            <button
              className={`btn aspect-lock${single.aspectLocked ? " active" : ""}`}
              type="button"
              aria-pressed={single.aspectLocked}
              disabled={single.locked}
              onClick={() => useEditorStore.getState().updateLayer(single.id, { aspectLocked: !single.aspectLocked })}
            >
              <AspectLockIcon /> {t(single.aspectLocked ? "aspectLockOn" : "aspectLockOff")}
            </button>
          )}

          <div className="form-row">
            <label>
              <span className="field-label">{t("rotation")} °</span>
              <NumberField
                value={single.transform.rotation}
                disabled={single.locked}
                onCommit={(v) =>
                  useEditorStore.getState().updateLayerTransform(single.id, { rotation: v })
                }
              />
            </label>
          </div>

          <div className="field-label">
            {t("opacity")} {Math.round(single.opacity * 100)}%
          </div>
          <SliderField
            value={Math.round(single.opacity * 100)}
            min={0}
            max={100}
            disabled={single.locked}
            onDragStart={() => useEditorStore.getState().beginTransaction()}
            onChange={(v) =>
              useEditorStore.getState().setLayersOpacity([single.id], v / 100, false)
            }
            onCommit={(v) => commitOpacity([single.id], v)}
          />

          {single.type === "svg" && (
            <div className="svg-paint-controls">
              {(["svgFillColor", "svgStrokeColor"] as const).map((channel) => (
                <div className="bg-row" key={channel}>
                  <span className="field-label">{t(channel === "svgFillColor" ? "svgFill" : "svgStroke")}</span>
                  <ColorField
                    value={single[channel] ?? "#1F2326"}
                    disabled={single.locked}
                    onChange={(color) => useEditorStore.getState().setSvgPaintColor(single.id, channel, color)}
                    title={t(channel === "svgFillColor" ? "svgFill" : "svgStroke")}
                  />
                  <button
                    className="btn"
                    type="button"
                    disabled={single.locked || !single[channel]}
                    onClick={() => useEditorStore.getState().setSvgPaintColor(single.id, channel, null)}
                  >{t("svgOriginalColor")}</button>
                </div>
              ))}
              <p className="muted small">{t("svgPaintHint")}</p>
            </div>
          )}

          {single.type !== "empty" && (
            <button
              className="btn wide"
              disabled={single.locked}
              onClick={() => {
                const store = useEditorStore.getState();
                store.beginTransaction();
                store.updateLayerTransform(single.id, { scaleX: 1, scaleY: 1, rotation: 0 }, false);
                store.commitTransaction();
              }}
            >
              {t("resetTransform")}
            </button>
          )}
        </div>
      )}

      {!single && selectedIds.length > 1 && (
        <div className="props-body">
          <div className="prop-layer-name">
            {selectedIds.length} {t("layersSelected")}
          </div>
          <div className="field-label">{t("opacityOfSelection")}</div>
          <SliderField
            value={selectionOpacity}
            min={0}
            max={100}
            onDragStart={() => useEditorStore.getState().beginTransaction()}
            onChange={(v) => useEditorStore.getState().setLayersOpacity(selectedIds, v / 100, false)}
            onCommit={(v) => commitOpacity(selectedIds, v)}
          />
          {mixedOpacity && <p className="muted small">{t("opacityMixed")}</p>}
        </div>
      )}

      {selectedIds.length === 0 && (
        <div className="props-body">
          <div className="prop-layer-name">{t("canvasSettings")}</div>
          <div className="form-row">
            <label>
              <span className="field-label">{t("width")}</span>
              <NumberField
                value={canvas.width}
                min={1}
                max={8192}
                onCommit={(v) => useEditorStore.getState().setCanvasSize(Math.round(v), canvas.height)}
              />
            </label>
            <label>
              <span className="field-label">{t("height")}</span>
              <NumberField
                value={canvas.height}
                min={1}
                max={8192}
                onCommit={(v) => useEditorStore.getState().setCanvasSize(canvas.width, Math.round(v))}
              />
            </label>
          </div>
          <div className="field-label">{t("background")}</div>
          <div className="bg-row">
            <button
              className={`checker-chip${canvas.background === "transparent" ? " active" : ""}`}
              onClick={() => useEditorStore.getState().setCanvasBackground("transparent")}
              title={t("transparent")}
            />
            <ColorField
              value={canvas.background === "transparent" ? "#888888" : canvas.background}
              onChange={(v) => useEditorStore.getState().setCanvasBackground(v)}
              title={t("background")}
            />
          </div>
          <p className="muted small">{t("noSelectionHint")}</p>
        </div>
      )}
    </div>
  );
}
