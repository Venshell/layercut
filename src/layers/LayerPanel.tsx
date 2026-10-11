import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useEditorStore } from "../layers/layerStore";
import { useAssetStore } from "../assets/assetStore";
import { validSelection } from "../layers/layerUtils";
import type { Layer } from "../layers/layerTypes";
import { mergeCurrentLayers } from "./mergeLayers";
import { usePaintedAsset } from "../vector/usePaintedAsset";
import type { LayerAsset } from "../assets/assetStore";
import { CopyIcon, EyeIcon, EyeOffIcon, LockIcon, OcclusionIcon, PlusIcon, TrashIcon, UnlockIcon } from "../ui/icons";

/**
 * Layer panel. Rows display top → bottom (array is bottom → top).
 * Supports click/ctrl/shift selection, inline rename (double click),
 * visibility / lock toggles and drag-to-reorder.
 * Width / collapse are controlled from App via the divider.
 */
export function LayerPanel({ width, collapsed }: { width: number; collapsed: boolean }) {
  const { t } = useI18n();
  const layers = useEditorStore((s) => s.layers);
  const assets = useAssetStore((s) => s.assets);
  const selectedIds = validSelection(layers, useEditorStore((s) => s.selectedIds));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ fromId: string; overId: string } | null>(null);
  const [merging, setMerging] = useState(false);
  // Fixed anchor for shift range selection: the last row chosen without Shift.
  const anchorIdRef = useRef<string | null>(null);

  const display = layers.map((layer, index) => ({ layer, index })).reverse();

  const select = (id: string, e: React.MouseEvent) => {
    const s = useEditorStore.getState();
    const additive = e.ctrlKey || e.metaKey;
    if (additive) {
      s.toggleSelection(id, true);
      anchorIdRef.current = id;
      return;
    }
    if (e.shiftKey && anchorIdRef.current) {
      // range selection in display order, anchored at the last plain pick
      const ids = layers.map((l) => l.id);
      const anchor = ids.indexOf(anchorIdRef.current);
      const target = ids.indexOf(id);
      if (anchor >= 0 && target >= 0) {
        const [a, b] = anchor < target ? [anchor, target] : [target, anchor];
        s.setSelection(ids.slice(a, b + 1));
        return;
      }
    }
    s.setSelection([id]);
    anchorIdRef.current = id;
  };

  // Drag identifiers are layer ids, not display indices: the stack can change
  // while a row is being dragged, and a stale index could splice out of bounds.
  const dragFromIndex = drag ? display.findIndex((d) => d.layer.id === drag.fromId) : -1;
  const dragOverIndex = drag ? display.findIndex((d) => d.layer.id === drag.overId) : -1;

  const handleDrop = () => {
    if (!drag || drag.fromId === drag.overId) {
      setDrag(null);
      return;
    }
    const s = useEditorStore.getState();
    const from = s.layers.findIndex((l) => l.id === drag.fromId);
    const over = s.layers.findIndex((l) => l.id === drag.overId);
    setDrag(null);
    if (from < 0 || over < 0) return;
    // Moving down places after the target; moving up places before it.
    s.reorder(from, over);
  };

  const addLayer = () => {
    const s = useEditorStore.getState();
    const base = t("layerDefaultName");
    const taken = new Set(s.layers.map((l) => l.name));
    let n = s.layers.length + 1;
    while (taken.has(`${base} ${n}`)) n += 1;
    s.addEmptyLayer(`${base} ${n}`);
  };

  const mergeLayers = async () => {
    setMerging(true);
    try {
      if (!useEditorStore.getState().layers.some((l) => l.visible)) {
        useEditorStore.getState().setNotice(t("mergeLayersEmpty"));
        return;
      }
      const merged = await mergeCurrentLayers(t("mergedLayerName"));
      if (!merged) useEditorStore.getState().setNotice(t("mergeLayersUnavailable"));
    } catch (error) {
      console.error("Merge layers failed:", error);
      useEditorStore.getState().setNotice(t("mergeLayersFailed"));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div
      className={`panel layer-panel${collapsed ? " panel-collapsed" : ""}`}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="panel-title">
        {t("layers")}
        <span className="panel-actions">
          <button
            className="btn"
            title={t("mergeLayersHint")}
            disabled={layers.length < 2 || merging}
            onClick={() => void mergeLayers()}
          >
            {merging ? t("mergingLayers") : t("mergeLayers")}
          </button>
          <button
            className="icon-btn"
            title={t("addLayer")}
            onClick={addLayer}
          >
            <PlusIcon />
          </button>
          <button
            className="icon-btn"
            title={t("duplicate")}
            disabled={selectedIds.length === 0}
            onClick={() => useEditorStore.getState().duplicateSelected()}
          >
            <CopyIcon />
          </button>
          <button
            className="icon-btn danger"
            title={t("delete")}
            disabled={selectedIds.length === 0}
            onClick={() => useEditorStore.getState().deleteSelected()}
          >
            <TrashIcon />
          </button>
        </span>
      </div>

      <div className="layer-list">
        {display.map(({ layer, index }) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            asset={layer.assetId ? assets[layer.assetId] ?? null : null}
            selected={selectedIds.includes(layer.id)}
            renaming={renamingId === layer.id}
            dragging={drag?.fromId === layer.id}
            dropBefore={
              drag != null &&
              drag.overId === layer.id &&
              drag.fromId !== layer.id &&
              dragFromIndex > dragOverIndex
            }
            dropAfter={
              drag != null &&
              drag.overId === layer.id &&
              drag.fromId !== layer.id &&
              dragFromIndex < dragOverIndex
            }
            onSelect={(e) => select(layer.id, e)}
            onStartRename={() => setRenamingId(layer.id)}
            onEndRename={(name) => {
              setRenamingId(null);
              const trimmed = name.trim();
              if (trimmed && trimmed !== layer.name) {
                useEditorStore.getState().updateLayer(layer.id, { name: trimmed });
              }
            }}
            onToggleVisible={() =>
              useEditorStore.getState().updateLayer(layer.id, { visible: !layer.visible })
            }
            onToggleOcclusion={() =>
              useEditorStore.getState().updateLayer(layer.id, { occludesWhenHidden: !layer.occludesWhenHidden })
            }
            onToggleLock={() =>
              useEditorStore.getState().updateLayer(layer.id, { locked: !layer.locked })
            }
            onMoveUp={
              index < layers.length - 1
                ? () => useEditorStore.getState().reorder(index, index + 1)
                : undefined
            }
            onMoveDown={
              index > 0 ? () => useEditorStore.getState().reorder(index, index - 1) : undefined
            }
            onDragStart={() => setDrag({ fromId: layer.id, overId: layer.id })}
            onDragOver={() => setDrag((d) => (d ? { ...d, overId: layer.id } : d))}
            onDrop={handleDrop}
            onDragEnd={() => setDrag(null)}
          />
        ))}
        {layers.length === 0 && <div className="muted small empty-list">—</div>}
      </div>
    </div>
  );
}

function LayerRow({
  layer,
  asset,
  selected,
  renaming,
  dragging,
  dropBefore,
  dropAfter,
  onSelect,
  onStartRename,
  onEndRename,
  onToggleVisible,
  onToggleOcclusion,
  onToggleLock,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  layer: Layer;
  asset: LayerAsset | null;
  selected: boolean;
  renaming: boolean;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onStartRename: () => void;
  onEndRename: (name: string) => void;
  onToggleVisible: () => void;
  onToggleOcclusion: () => void;
  onToggleLock: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useI18n();
  const [nameDraft, setNameDraft] = useState(layer.name);
  const previewUrl = usePaintedAsset(asset, layer)?.previewUrl ?? "";
  const inputRef = useRef<HTMLInputElement | null>(null);

  // sync the draft whenever a rename session starts
  useEffect(() => {
    if (renaming) setNameDraft(layer.name);
  }, [renaming, layer.name]);

  // focus + select exactly once per rename session. (Selecting in the ref
  // callback re-ran on every keystroke and overwrote the draft with one char.)
  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  return (
    <div
      className={[
        "layer-row",
        selected ? "selected" : "",
        dragging ? "dragging" : "",
        dropBefore ? "drop-before" : "",
        dropAfter ? "drop-after" : "",
        !layer.visible ? "hidden-layer" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={!renaming}
      onMouseDown={onSelect}
      onDoubleClick={onStartRename}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="thumb">
        {previewUrl ? <img src={previewUrl} alt="" draggable={false} /> : <span className="thumb-empty" />}
      </div>
      {renaming ? (
        <input
          ref={inputRef}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={() => onEndRename(nameDraft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEndRename(nameDraft);
            if (e.key === "Escape") onEndRename(layer.name);
          }}
          className="rename-input"
        />
      ) : (
        <span className="layer-name" title={layer.name}>
          {layer.name || "—"}
        </span>
      )}
      <button
        className="icon-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleVisible}
        title={t(layer.visible ? "hideLayer" : "showLayer")}
        aria-label={t(layer.visible ? "hideLayer" : "showLayer")}
      >
        {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
      <button
        className={`icon-btn${layer.occludesWhenHidden ? " active" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleOcclusion}
        title={t(layer.occludesWhenHidden ? "hiddenOcclusionOn" : "hiddenOcclusionOff")}
        aria-label={t(layer.occludesWhenHidden ? "hiddenOcclusionOn" : "hiddenOcclusionOff")}
        aria-pressed={layer.occludesWhenHidden}
        disabled={layer.type === "empty"}
      >
        <OcclusionIcon />
      </button>
      <button
        className="icon-btn"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onToggleLock}
        title={t(layer.locked ? "lockLayer" : "unlockLayer")}
        aria-label={t(layer.locked ? "lockLayer" : "unlockLayer")}
      >
        {layer.locked ? <LockIcon /> : <UnlockIcon />}
      </button>
      <span className="row-order-btns">
        <button
          className="icon-btn tiny"
          disabled={!onMoveUp}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onMoveUp}
          title="▲"
        >
          ▲
        </button>
        <button
          className="icon-btn tiny"
          disabled={!onMoveDown}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onMoveDown}
          title="▼"
        >
          ▼
        </button>
      </span>
    </div>
  );
}
