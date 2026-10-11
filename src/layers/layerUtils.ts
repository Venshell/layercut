import type { Layer } from "./layerTypes";
import { uid } from "../utils/id";
import type { CanvasSettings } from "./layerTypes";

/** Selection filtered to layers that still exist (history may restore dangling ids). */
export function validSelection(layers: Layer[], selectedIds: string[]): string[] {
  const ids = new Set(layers.map((l) => l.id));
  return selectedIds.filter((id) => ids.has(id));
}

export function findLayer(layers: Layer[], id: string): Layer | undefined {
  return layers.find((l) => l.id === id);
}

export function isLayerOccluder(layer: Layer): boolean {
  return layer.visible || layer.occludesWhenHidden === true;
}

/** Center a new layer on the canvas, scaled down if larger than the canvas. */
export function initialTransform(canvas: CanvasSettings, natural: { width: number; height: number }) {
  let scale = 1;
  const maxW = canvas.width * 0.8;
  const maxH = canvas.height * 0.8;
  if (natural.width > maxW || natural.height > maxH) {
    scale = Math.min(maxW / natural.width, maxH / natural.height);
  }
  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    scaleX: scale,
    scaleY: scale,
    rotation: 0,
  };
}

export function makeLayer(opts: {
  name: string;
  type: Layer["type"];
  assetId: string | null;
  canvas: CanvasSettings;
  natural?: { width: number; height: number } | null;
  /** Exact placement, for callers that know where the layer must land (drawn shapes). */
  transform?: Layer["transform"];
}): Layer {
  return {
    id: uid("layer"),
    name: opts.name,
    type: opts.type,
    assetId: opts.assetId,
    transform: opts.transform ?? initialTransform(opts.canvas, opts.natural ?? { width: 0, height: 0 }),
    opacity: 1,
    visible: true,
    locked: false,
    aspectLocked: false,
    occludesWhenHidden: false,
  };
}

/**
 * Duplicate one layer with a name unique against `takenNames` (every name in
 * the stack; the caller keeps the set across multiple copies so one action
 * cannot produce two identical names). The chosen name is added to the set.
 */
export function duplicateLayer(layer: Layer, takenNames: Set<string>): Layer {
  const base = layer.name.replace(/ copy( \d+)?$/, "");
  let suffixIndex = 1;
  let name = `${base} copy`;
  while (takenNames.has(name)) {
    suffixIndex += 1;
    name = `${base} copy ${suffixIndex}`;
  }
  takenNames.add(name);
  // offset slightly so the copy is visible
  return {
    ...layer,
    id: uid("layer"),
    name,
    transform: { ...layer.transform, x: layer.transform.x + 16, y: layer.transform.y + 16 },
  };
}

// Windows reserves these device names with or without an extension.
const RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    // trailing dots/spaces are silently stripped by Windows; do it explicitly
    .replace(/[. ]+$/, "");
  if (RESERVED_FILE_NAMES.test(cleaned)) return `_${cleaned}`;
  return cleaned || "layer";
}
