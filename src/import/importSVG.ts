import type { CanvasSettings, Layer } from "../layers/layerTypes";
import type { LayerAsset } from "../assets/assetStore";
import { newAssetId, useAssetStore } from "../assets/assetStore";
import { makeLayer } from "../layers/layerUtils";
import { loadSVGImage, svgSizeOf } from "../renderer/SVGRenderer";

/**
 * Import an SVG file (Phase 1 raster strategy, project plan §6):
 * parse intrinsic size → let the browser rasterize → treat like a PNG layer.
 * Original SVG text is preserved in the asset for Phase 2 vector boolean.
 */
export async function importSVGFile(file: File): Promise<{ asset: LayerAsset }> {
  const svgText = await file.text();
  const img = await loadSVGImage(svgText);
  const size = svgSizeOf(img, svgText);
  const asset: LayerAsset = {
    id: newAssetId(),
    kind: "svg",
    fileName: file.name,
    mimeType: "image/svg+xml",
    naturalWidth: size.width,
    naturalHeight: size.height,
    bitmap: img,
    svgText,
    previewUrl: img.src,
  };
  useAssetStore.getState().put(asset);
  return { asset };
}

export function svgLayerFromAsset(asset: LayerAsset, canvas: CanvasSettings): Layer {
  return makeLayer({
    name: asset.fileName.replace(/\.[^.]+$/, ""),
    type: "svg",
    assetId: asset.id,
    canvas,
    natural: { width: asset.naturalWidth, height: asset.naturalHeight },
  });
}
