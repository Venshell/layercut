import type { CanvasSettings, Layer } from "../layers/layerTypes";
import { isHexColor } from "../utils/color";
import type { LayerAsset } from "../assets/assetStore";
import type { ExportScope } from "../export/exportAll";

/**
 * .layercut project file format (project plan §8/§9).
 * Self-contained: all source material is embedded as base64 data URLs.
 */
export interface SerializedProject {
  app: "layercut";
  version: 1;
  name: string;
  canvas: CanvasSettings;
  assets: Record<string, SerializedAsset>;
  layers: Layer[];
  /** last used export settings (project plan §13 "导出配置保存") */
  exportConfig?: ExportConfig;
}

export interface SerializedAsset {
  fileName: string;
  mimeType: string;
  kind: "png" | "svg";
  data: string; // data URL
}

export interface ExportConfig {
  scope: ExportScope;
  scale: number;
}

export const PROJECT_APP_TAG = "layercut";
export const PROJECT_VERSION = 1 as const;
export const PROJECT_EXT = ".layercut";

/** Decode an embedded project asset without a network request (Tauri CSP). */
export function embeddedAssetBlob(dataUrl: string, mimeType: string): Blob {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ---------------------------------------------------------------------------
// Serialize: store state → SerializedProject
// Asset data URLs are cached per asset id — assets are immutable, so repeated
// autosaves don't re-encode the same bitmaps.
//
// The cache holds base64 payloads (~1.33x the raw bytes), so it is bounded and
// explicitly evictable: without that, opening project after project kept every
// previous document's material resident for the rest of the session.
// ---------------------------------------------------------------------------

const MAX_CACHED_ASSETS = 64;
const assetDataCache = new Map<string, SerializedAsset>();

function cacheAsset(id: string, serialized: SerializedAsset): void {
  // refresh insertion order so the map behaves as an LRU
  assetDataCache.delete(id);
  assetDataCache.set(id, serialized);
  while (assetDataCache.size > MAX_CACHED_ASSETS) {
    const oldest = assetDataCache.keys().next().value;
    if (oldest === undefined) break;
    assetDataCache.delete(oldest);
  }
}

/**
 * Drop cached data URLs whose asset is not in `keep` (document replacement).
 * Paired with releaseAssetsExcept so the promise that replacing a document
 * frees its material holds for the serialization cache too.
 */
export function releaseSerializedAssets(keep: ReadonlySet<string>): void {
  for (const id of [...assetDataCache.keys()]) {
    if (!keep.has(id)) assetDataCache.delete(id);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function pngBlobFromBitmap(asset: LayerAsset): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = asset.naturalWidth;
  canvas.height = asset.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`PNG source unavailable: ${asset.fileName}`);
  context.drawImage(asset.bitmap, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`PNG encode failed: ${asset.fileName}`)), "image/png");
  });
}

export async function serializeProject(
  name: string,
  canvas: CanvasSettings,
  layers: Layer[],
  assets: Record<string, LayerAsset>,
  exportConfig?: ExportConfig
): Promise<SerializedProject> {
  const out: Record<string, SerializedAsset> = {};
  for (const layer of layers) {
    if (!layer.assetId) continue;
    const asset = assets[layer.assetId];
    if (!asset || out[layer.assetId]) continue;
    const cached = assetDataCache.get(layer.assetId);
    if (cached) {
      out[layer.assetId] = cached;
      continue;
    }
    let dataUrl: string;
    if (asset.kind === "svg" && asset.svgText !== undefined) {
      const b64 = await blobToBase64(new Blob([asset.svgText], { type: "image/svg+xml" }));
      dataUrl = `data:image/svg+xml;base64,${b64}`;
    } else {
      // In Tauri, connect-src does not allow fetch(blob:). Keep the source bytes
      // at import; only legacy in-memory assets need a bitmap re-encode.
      const blob = asset.sourceBlob ?? await pngBlobFromBitmap(asset);
      const mime = asset.mimeType || blob.type || "image/png";
      dataUrl = `data:${mime};base64,${await blobToBase64(blob)}`;
    }
    const serialized: SerializedAsset = {
      fileName: asset.fileName,
      mimeType: asset.kind === "svg" ? "image/svg+xml" : asset.mimeType || "image/png",
      kind: asset.kind,
      data: dataUrl,
    };
    cacheAsset(layer.assetId, serialized);
    out[layer.assetId] = serialized;
  }
  return {
    app: PROJECT_APP_TAG,
    version: PROJECT_VERSION,
    name,
    canvas,
    assets: out,
    layers,
    exportConfig,
  };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function isValidProjectJson(value: unknown): value is SerializedProject {
  if (!isRecord(value)) return false;
  const v = value;
  if (v.app !== PROJECT_APP_TAG || v.version !== PROJECT_VERSION || typeof v.name !== "string") return false;
  if (!isRecord(v.canvas) || !finite(v.canvas.width) || !finite(v.canvas.height) || typeof v.canvas.background !== "string") return false;
  if (!isRecord(v.assets) || !Array.isArray(v.layers)) return false;
  for (const asset of Object.values(v.assets)) {
    if (!isRecord(asset) || (asset.kind !== "png" && asset.kind !== "svg") || typeof asset.fileName !== "string" || typeof asset.mimeType !== "string") return false;
    // Project material is self-contained. Reject network URLs before fetching.
    if (typeof asset.data !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]*={0,2}$/i.test(asset.data)) return false;
  }
  const ids = new Set<string>();
  for (const layer of v.layers) {
    if (!isRecord(layer) || typeof layer.id !== "string" || !layer.id || ids.has(layer.id)) return false;
    ids.add(layer.id);
    if (typeof layer.name !== "string" || !["png", "svg", "empty"].includes(String(layer.type))) return false;
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean" || !finite(layer.opacity)) return false;
    if (layer.aspectLocked !== undefined && typeof layer.aspectLocked !== "boolean") return false;
    if (layer.occludesWhenHidden !== undefined && typeof layer.occludesWhenHidden !== "boolean") return false;
    for (const key of ["svgFillColor", "svgStrokeColor"]) {
      const color = layer[key];
      if (color !== undefined && color !== null && (layer.type !== "svg" || typeof color !== "string" || !isHexColor(color))) return false;
    }
    const transform = layer.transform;
    if (!isRecord(transform) || !["x", "y", "scaleX", "scaleY", "rotation"].every(key => finite(transform[key]))) return false;
    if (layer.type === "empty") {
      if (layer.assetId !== null) return false;
    } else {
      if (typeof layer.assetId !== "string" || !Object.prototype.hasOwnProperty.call(v.assets, layer.assetId)) return false;
      if ((v.assets[layer.assetId] as Record<string, unknown>).kind !== layer.type) return false;
    }
  }
  if (v.exportConfig !== undefined) {
    if (!isRecord(v.exportConfig) || !["current", "selected", "all", "composite"].includes(String(v.exportConfig.scope))) return false;
    if (!finite(v.exportConfig.scale) || v.exportConfig.scale < 0.1 || v.exportConfig.scale > 8) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Per-version upgrade steps toward the current format. When v2 lands, add
 * `MIGRATIONS[1] = (v1) => ({ ...v1, version: 2, ... })` — loading walks the
 * chain until the document is current, so old projects keep opening.
 */
const MIGRATIONS: Partial<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>> = {};

/**
 * Bring a parsed project document to the current version. Returns null for
 * documents this build cannot understand (newer version, broken version
 * field, or a migration step missing).
 */
export function migrateProject(value: Record<string, unknown>): SerializedProject | null {
  let doc = value;
  let version = doc.version;
  if (typeof version !== "number" || !Number.isInteger(version)) return null;
  if (version > PROJECT_VERSION) return null; // written by a newer build
  while (version < PROJECT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return null;
    doc = migrate(doc);
    if (!isRecord(doc)) return null;
    version = doc.version;
    if (typeof version !== "number") return null;
  }
  return doc as unknown as SerializedProject;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
