import { create } from "zustand";
import { uid } from "../utils/id";
import { releasePaintedVariants } from "../vector/svgPaint";

/**
 * Immutable source material of a layer (project plan §9 "Source Data").
 * Kept OUT of the undo history — history only tracks layer metadata.
 */
export interface LayerAsset {
  id: string;
  kind: "png" | "svg";
  fileName: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  /** decoded PNG bitmap, or the rasterized <img> for SVG */
  bitmap: ImageBitmap | HTMLImageElement;
  /** Original imported PNG bytes; project saving must not fetch the preview blob URL. */
  sourceBlob?: Blob;
  /** SVG text, kept for Phase 2 vector boolean + re-rasterization */
  svgText?: string;
  /** object URL of the original file for thumbnails */
  previewUrl: string;
}

interface AssetStore {
  assets: Record<string, LayerAsset>;
  put: (asset: LayerAsset) => void;
  remove: (id: string) => void;
}

export const useAssetStore = create<AssetStore>((set) => ({
  assets: {},
  put: (asset) =>
    set((s) => ({ assets: { ...s.assets, [asset.id]: asset } })),
  remove: (id) =>
    set((s) => {
      if (!(id in s.assets)) return s;
      const next = { ...s.assets };
      delete next[id];
      return { assets: next };
    }),
}));

export function newAssetId(): string {
  return uid("asset");
}

/**
 * Release every asset NOT in `keep` (document replacement): decoded bitmaps
 * are closed, blob URLs revoked and painted-variant caches evicted. Only
 * valid right after a document swap — the new document's history contains no
 * reference to the released assets.
 */
export function releaseAssetsExcept(keep: ReadonlySet<string>): void {
  const { assets, remove } = useAssetStore.getState();
  for (const [id, asset] of Object.entries(assets)) {
    if (keep.has(id)) continue;
    remove(id);
    if (asset.bitmap instanceof ImageBitmap) asset.bitmap.close();
    if (asset.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(asset.previewUrl);
    releasePaintedVariants(id);
  }
}
