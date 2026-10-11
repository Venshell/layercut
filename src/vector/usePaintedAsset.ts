import { useEffect, useRef, useState } from "react";
import type { LayerAsset } from "../assets/assetStore";
import type { Layer } from "../layers/layerTypes";
import { useEditorStore } from "../layers/layerStore";
import { getT } from "../i18n";
import { paintedAsset } from "./svgPaint";

/**
 * The asset repainted with the layer's SVG colour overrides. While a repaint
 * is in flight the overrides clear it to null, so the stale paint never shows.
 *
 * A decode failure is reported to the user: the layer silently vanishing was
 * the old behaviour and left no way to tell why it disappeared. The notice
 * fires once per layer, because a failed repaint is retried on every effect
 * run (the cache drops rejected entries) and would otherwise spam the status bar.
 */
export function usePaintedAsset(asset: LayerAsset | null, layer: Layer): LayerAsset | null {
  const [painted, setPainted] = useState<LayerAsset | null>(asset);
  const notified = useRef(false);
  useEffect(() => {
    let active = true;
    if (!asset) { setPainted(null); return; }
    setPainted(asset.kind === "svg" && (layer.svgFillColor || layer.svgStrokeColor) ? null : asset);
    paintedAsset(asset, layer).then((result) => {
      if (active) setPainted(result);
    }).catch((error) => {
      console.error("SVG paint preview failed", error);
      if (!active || notified.current) return;
      notified.current = true;
      const name = useEditorStore.getState().layers.find((l) => l.id === layer.id)?.name;
      useEditorStore.getState().setNotice(`⚠ ${getT()("paintFailed")}${name ? `: ${name}` : ""}`);
    });
    return () => { active = false; };
  }, [asset, layer.svgFillColor, layer.svgStrokeColor, layer.id]);
  return painted;
}
