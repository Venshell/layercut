/**
 * Turn a drawn shape into a real layer.
 *
 * The shape is generated as a one-path SVG document, registered in the asset
 * store exactly like an imported SVG file, and wrapped in an ordinary `svg`
 * layer. Nothing downstream needs to know the layer was drawn.
 */
import type { Layer, LayerTransform } from "../layers/layerTypes";
import type { LayerAsset } from "../assets/assetStore";
import { newAssetId, useAssetStore } from "../assets/assetStore";
import { makeLayer } from "../layers/layerUtils";
import { useEditorStore } from "../layers/layerStore";
import { loadSVGImage } from "../renderer/SVGRenderer";
import { shapeGeometry } from "./shapeGeometry";
import type { Point, ShapeKind, ShapeStyle } from "./shapeTypes";

export interface CreateShapeOptions {
  kind: ShapeKind;
  /** drag endpoints in canvas coordinates */
  from: Point;
  to: Point;
  style: ShapeStyle;
  sides: number;
  /** localized layer name, e.g. "矩形 3" */
  name: string;
}

/** Build the asset + layer for a shape. Does not add the layer to the store. */
export async function createShapeLayer(opts: CreateShapeOptions): Promise<Layer> {
  const canvas = useEditorStore.getState().canvas;
  const geometry = shapeGeometry({
    kind: opts.kind,
    from: opts.from,
    to: opts.to,
    style: opts.style,
    sides: opts.sides,
  });
  const bitmap = await loadSVGImage(geometry.svg);
  const asset: LayerAsset = {
    id: newAssetId(),
    kind: "svg",
    fileName: `${opts.name}.svg`,
    mimeType: "image/svg+xml",
    naturalWidth: geometry.width,
    naturalHeight: geometry.height,
    bitmap,
    svgText: geometry.svg,
    previewUrl: bitmap.src,
  };
  useAssetStore.getState().put(asset);

  const transform: LayerTransform = {
    x: geometry.center.x,
    y: geometry.center.y,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };
  return makeLayer({
    name: opts.name,
    type: "svg",
    assetId: asset.id,
    canvas,
    natural: { width: geometry.width, height: geometry.height },
    transform,
  });
}
