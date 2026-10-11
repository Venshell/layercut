import JSZip from "jszip";
import { useAssetStore, type LayerAsset } from "../assets/assetStore";
import { useEditorStore } from "../layers/layerStore";
import { validSelection } from "../layers/layerUtils";
import { canvasToBlob, downloadBlob, exportableLayers, rasterizeComposite } from "./exportPNG";
import { computeOcclusion } from "../occlusion/OcclusionEngine";
import {
  COMPOSITE_NAME_KEY,
  compositeBaseName,
  defaultBaseName,
  normalizedBase,
  resolveFileNames,
  type FileNameOverrides,
} from "./naming";
import { analyzeSvgSafety, svgHasPartialAlpha } from "../vector/svgSafety";
import { computeVectorOcclusion } from "../vector/svgBoolean";
import { isLayerOccluder } from "../layers/layerUtils";
import { paintedAssetsForLayers } from "../vector/svgPaint";
import type { Layer } from "../layers/layerTypes";

export type ExportScope = "current" | "selected" | "all" | "composite";
export type ExportFormat = "png" | "svg";
export type ExportDestination = "folder" | "zip";

/** One planned output file: the name the dialog shows is the name that is written. */
export interface PlannedExportFile {
  /** layer id, or COMPOSITE_NAME_KEY for the composite output */
  key: string;
  /** position in the layer stack (bottom → top), used by the default name */
  index: number;
  /** the user-editable name without extension */
  base: string;
  /** final name after sanitizing + duplicate disambiguation */
  fileName: string;
}

/** Visible layers a scope will export, in file order (bottom → top). */
function exportTargets(
  layers: Layer[],
  selectedIds: string[],
  scope: ExportScope
): { layer: Layer; index: number }[] {
  const visible = exportableLayers(layers);
  if (scope !== "current" && scope !== "selected") return visible;
  const ids = new Set(validSelection(layers, selectedIds));
  return visible.filter(({ layer }) => ids.has(layer.id));
}

/**
 * A layer produces an output file only if the raster/vector engines can render
 * it: a source asset and a non-zero opacity. Filtering here keeps the promise
 * that the dialog preview is exactly the set of files that gets written — an
 * entry that would be skipped during writing must not appear (or be written)
 * at all.
 */
function layerProducesOutput(layer: Layer, assets: Record<string, LayerAsset>): boolean {
  if (layer.type === "empty") return false;
  const asset = layer.assetId ? assets[layer.assetId] ?? null : null;
  // missing opacity reads as fully opaque, matching the raster engines
  return Boolean(asset) && (layer.opacity ?? 1) > 0;
}

/**
 * The single source of truth for output file names. The export dialog previews
 * exactly this list and the writers consume the same list, so a rename or an
 * automatic "(1)" can never differ between preview and output.
 */
export function planExportFiles(opts: {
  layers: Layer[];
  selectedIds: string[];
  scope: ExportScope;
  ext: string;
  assets: Record<string, LayerAsset>;
  overrides?: FileNameOverrides;
}): PlannedExportFile[] {
  const { layers, selectedIds, scope, ext, assets, overrides } = opts;
  const override = (key: string) => normalizedBase(overrides?.[key]);

  if (scope === "composite") {
    const base = override(COMPOSITE_NAME_KEY) ?? compositeBaseName();
    return [{ key: COMPOSITE_NAME_KEY, index: 0, base, fileName: resolveFileNames([base], ext)[0] }];
  }

  const targets = exportTargets(layers, selectedIds, scope).filter(({ layer }) =>
    layerProducesOutput(layer, assets)
  );
  const bases = targets.map(
    ({ layer, index }) => override(layer.id) ?? defaultBaseName(index + 1, layer.name)
  );
  const names = resolveFileNames(bases, ext);
  return targets.map(({ layer, index }, i) => ({
    key: layer.id,
    index,
    base: bases[i],
    fileName: names[i],
  }));
}

export type SvgGateStatus =
  | { ok: true }
  | {
      ok: false;
      code: "svg_needs_all_svg" | "svg_unsafe" | "svg_partial_opacity";
      offending?: string[];
    };

/**
 * The one "SVG only" gate (§7.3), shared verbatim by the dialog preview and
 * the writer so both can never disagree about whether SVG export applies.
 */
export function checkSvgExportGate(
  layers: Layer[],
  assets: Record<string, LayerAsset>
): SvgGateStatus {
  if (layers.some((l) => l.type !== "empty" && isLayerOccluder(l) && l.type !== "svg")) {
    return { ok: false, code: "svg_needs_all_svg" }; // a non-empty PNG layer exists
  }
  for (const layer of layers.filter(isLayerOccluder)) {
    // Boolean algebra has no alpha: anything between invisible and fully
    // opaque cannot be represented by the cut (and must not be flattened).
    if (layer.opacity > 0 && layer.opacity < 1) return { ok: false, code: "svg_partial_opacity" };
    const asset = layer.assetId ? assets[layer.assetId] ?? null : null;
    if (asset?.kind === "svg" && asset.svgText) {
      if (svgHasPartialAlpha(asset.svgText)) return { ok: false, code: "svg_partial_opacity" };
      const safety = analyzeSvgSafety(asset.svgText);
      if (!safety.safe) return { ok: false, code: "svg_unsafe", offending: safety.offending };
    }
  }
  return { ok: true };
}

interface WritableFileHandle {
  createWritable: () => Promise<{
    write: (d: BlobPart) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

async function saveViaFolder(
  dir: { getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<WritableFileHandle> },
  files: { name: string; blob: Blob }[]
): Promise<void> {
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(f.blob);
    await writable.close();
  }
}

async function saveZip(files: { name: string; blob: Blob }[]): Promise<void> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, "layercut_export.zip");
}

/**
 * Batch export (project plan §7). Prefers the File System Access API so users
 * pick a real folder; falls back to a single ZIP download.
 * Hidden layers are skipped as outputs. A hidden occluder still cuts lower layers.
 * format "svg" requires every participating layer to be a vector-safe SVG (§7.3).
 *
 * `overrides` renames output files (keyed by layer id, values without extension);
 * duplicates inside one batch get " (1)", " (2)", … from planExportFiles.
 */
export async function exportLayers(
  scope: ExportScope,
  scale: number,
  format: ExportFormat = "png",
  onProgress?: (done: number, total: number) => void,
  destination: ExportDestination = "folder",
  overrides?: FileNameOverrides
): Promise<"folder" | "zip" | "cancelled"> {
  const { canvas, layers, selectedIds } = useEditorStore.getState();
  const assets = useAssetStore.getState().assets;
  const ext = format === "svg" ? "svg" : "png";
  const plan = planExportFiles({ layers, selectedIds, scope, ext, assets, overrides });
  if (plan.length === 0) return "cancelled";

  if (format === "svg") {
    // Vector boolean exports per layer, so a single composite image is out of scope.
    if (scope === "composite") throw new Error("svg_composite_unsupported");
    return exportVectorLayers(plan, scale, onProgress, destination);
  }

  const renderAssets = await paintedAssetsForLayers(layers, assets);

  if (scope === "composite") {
    const blob = await canvasToBlob(rasterizeComposite(layers, canvas, renderAssets, scale));
    onProgress?.(1, 1);
    return saveOrZip([{ name: plan[0].fileName, blob }], destination);
  }

  // one occlusion pass serves every layer (project plan §15)
  const occlusion = computeOcclusion(layers, canvas, renderAssets, scale);
  const files: { name: string; blob: Blob }[] = [];
  let done = 0;
  for (const file of plan) {
    const raster = occlusion.byLayerId.get(file.key);
    // The plan only contains layers the engines can render — a missing raster
    // is a bug, not a reason to silently write fewer files than previewed.
    if (!raster) throw new Error("export_layer_missing");
    const blob = await canvasToBlob(raster);
    files.push({ name: file.fileName, blob });
    done += 1;
    onProgress?.(done, plan.length);
  }

  return saveOrZip(files, destination);
}

/** Vector export (§14 v0.6): Layer[i] − Union(Layers Above) as real SVG. */
async function exportVectorLayers(
  plan: PlannedExportFile[],
  scale: number,
  onProgress?: (done: number, total: number) => void,
  destination: ExportDestination = "folder"
): Promise<"folder" | "zip" | "cancelled"> {
  const { layers } = useEditorStore.getState();
  const assets = useAssetStore.getState().assets;

  const gate = checkSvgExportGate(layers, assets);
  if (!gate.ok) {
    const err = new Error(gate.code) as Error & { code?: string; offending?: string[] };
    err.code = gate.code;
    err.offending = gate.offending;
    throw err;
  }

  const { canvas } = useEditorStore.getState();
  const result = computeVectorOcclusion(layers, assets, canvas, scale);
  const files: { name: string; blob: Blob }[] = [];
  let done = 0;
  for (const file of plan) {
    const svg = result.byLayerId.get(file.key);
    if (!svg) throw new Error("export_layer_missing");
    files.push({
      name: file.fileName,
      blob: new Blob([svg], { type: "image/svg+xml" }),
    });
    done += 1;
    onProgress?.(done, plan.length);
  }

  return saveOrZip(files, destination);
}

async function saveOrZip(files: { name: string; blob: Blob }[], destination: ExportDestination): Promise<"folder" | "zip" | "cancelled"> {
  if (files.length === 0) return "cancelled";
  if (destination === "zip") {
    await saveZip(files);
    return "zip";
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string; id?: string; startIn?: string }) => Promise<{
        getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<WritableFileHandle>;
      }>;
    }
  ).showDirectoryPicker;

  if (picker) {
    let dir: Awaited<ReturnType<typeof picker>> | null = null;
    try {
      // Only opening the picker may fall back to ZIP. A failure while WRITING
      // must surface as a failed export — silently zipping instead would
      // report success while the chosen folder keeps half-written files.
      dir = await picker.call(window, { mode: "readwrite", id: "layercut-export", startIn: "downloads" });
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
      console.warn("Folder picker failed, falling back to ZIP", e);
    }
    if (dir) {
      await saveViaFolder(dir, files);
      return "folder";
    }
  }
  await saveZip(files);
  return "zip";
}
