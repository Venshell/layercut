import type { Layer } from "../layers/layerTypes";
import { useEditorStore } from "../layers/layerStore";
import { getT } from "../i18n";
import { importPNGFile, pngLayerFromAsset } from "./importPNG";
import { importSVGFile, svgLayerFromAsset } from "./importSVG";

/** Orchestrate multi-file import; returns layers ready to be added. */
export async function importFiles(files: File[]): Promise<Layer[]> {
  const canvas = useEditorStore.getState().canvas;
  const layers: Layer[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const isPNG = file.type === "image/png" || /\.png$/i.test(file.name);
    const isSVG = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
    try {
      if (isPNG) {
        const { asset } = await importPNGFile(file);
        layers.push(pngLayerFromAsset(asset, canvas));
      } else if (isSVG) {
        const { asset } = await importSVGFile(file);
        layers.push(svgLayerFromAsset(asset, canvas));
      } else {
        errors.push(file.name);
      }
    } catch (e) {
      console.error("Import failed:", file.name, e);
      errors.push(file.name);
    }
  }

  if (layers.length > 0) {
    useEditorStore.getState().addLayers(layers);
  }
  if (errors.length > 0) {
    const { setNotice } = useEditorStore.getState();
    setNotice(`⚠ ${getT()("importFailed")} (${errors.length})`);
  }
  return layers;
}

/** Convert a drop point (container-relative) to canvas coordinates. */
export function dropPointToCanvas(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  viewport: { scale: number; x: number; y: number }
): { x: number; y: number } {
  return {
    x: (clientX - containerRect.left - viewport.x) / viewport.scale,
    y: (clientY - containerRect.top - viewport.y) / viewport.scale,
  };
}
