import { downloadBlob } from "../export/exportPNG";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { importPNGFile } from "../import/importPNG";
import { importSVGFile } from "../import/importSVG";
import { useAssetStore, releaseAssetsExcept } from "../assets/assetStore";
import { useEditorStore } from "../layers/layerStore";
import { useViewportStore } from "../editor/ViewportManager";
import { sanitizeFileName } from "../layers/layerUtils";
import { isHexColor } from "../utils/color";
import { addRecent } from "./storage";
import {
  PROJECT_EXT,
  embeddedAssetBlob,
  isValidProjectJson,
  migrateProject,
  serializeProject,
} from "./projectTypes";
import { readExportConfig, writeExportConfig } from "./exportConfig";

/** Serialize the current document and save it as {name}.layercut. */
export async function saveProjectAs(rawName: string): Promise<boolean> {
  const name = rawName.trim() || "layercut";
  const s = useEditorStore.getState();
  const savedVersion = s.historyVersion;
  const documentEpoch = s.documentEpoch;
  const assets = useAssetStore.getState().assets;
  const exportConfig = readExportConfig();

  const filename = `${sanitizeFileName(name)}${PROJECT_EXT}`;
  let json: string;
  if (isTauri()) {
    // Show the native dialog before serializing: embedding every PNG asset
    // can take seconds, and the dialog must not wait on that work.
    const path = await save({ defaultPath: filename, filters: [{ name: "LayerCut", extensions: ["layercut"] }] });
    if (path === null) return false;
    json = JSON.stringify(await serializeProject(name, s.canvas, s.layers, assets, exportConfig));
    await writeTextFile(path, json);
  } else {
    json = JSON.stringify(await serializeProject(name, s.canvas, s.layers, assets, exportConfig));
    downloadBlob(new Blob([json], { type: "application/json" }), filename);
  }

  await addRecent({ name, savedAt: Date.now(), layerCount: s.layers.length, json });
  const store = useEditorStore.getState();
  if (store.documentEpoch === documentEpoch) {
    store.setProjectName(name);
    store.markSaved(savedVersion, documentEpoch);
  }
  return true;
}

/**
 * Load a serialized project: rebuild assets through the normal import
 * pipeline (new asset ids), remap layer references, replace the document.
 * A single broken asset degrades its layers to empty instead of failing the
 * whole document.
 */
export async function loadProjectJson(json: string, name?: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("invalid json");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("not a layercut project");
  const project = migrateProject(parsed as Record<string, unknown>);
  if (!project || !isValidProjectJson(project)) throw new Error("not a layercut project");

  // rebuild assets (ids differ from the saved ones)
  const idMap = new Map<string, string>();
  for (const [oldId, sa] of Object.entries(project.assets ?? {})) {
    try {
      const blob = embeddedAssetBlob(sa.data, sa.mimeType);
      const file = new File([blob], sa.fileName || "asset", { type: sa.mimeType });
      if (sa.kind === "svg" || sa.mimeType === "image/svg+xml") {
        const { asset } = await importSVGFile(file);
        idMap.set(oldId, asset.id);
      } else {
        const { asset } = await importPNGFile(file);
        idMap.set(oldId, asset.id);
      }
    } catch (e) {
      // decode failure is contained: layers keep a null assetId and render
      // as empty, so one broken image cannot sink the whole document
      console.warn("project asset failed to load:", sa.fileName, e);
    }
  }

  // clamp + remap layers
  const canvas = {
    width: clampInt(project.canvas.width, 1, 8192, 1080),
    height: clampInt(project.canvas.height, 1, 8192, 1920),
    background: typeof project.canvas.background === "string" ? project.canvas.background : "transparent",
  };
  const layers = (Array.isArray(project.layers) ? project.layers : [])
    .filter((l) => l && typeof l.id === "string" && typeof l.transform === "object")
    .map((l) => ({
      ...l,
      name: typeof l.name === "string" ? l.name : "",
      opacity: finiteOr(l.opacity, 1, 0, 1),
      visible: l.visible !== false,
      locked: l.locked === true,
      aspectLocked: l.aspectLocked === true,
      occludesWhenHidden: l.occludesWhenHidden === true,
      svgFillColor: l.type === "svg" && typeof l.svgFillColor === "string" && isHexColor(l.svgFillColor) ? l.svgFillColor : null,
      svgStrokeColor: l.type === "svg" && typeof l.svgStrokeColor === "string" && isHexColor(l.svgStrokeColor) ? l.svgStrokeColor : null,
      assetId: l.assetId ? idMap.get(l.assetId) ?? null : null,
      transform: {
        x: finiteOr(l.transform.x, 0),
        y: finiteOr(l.transform.y, 0),
        scaleX: finiteOr(l.transform.scaleX, 1, 0.001, 1000),
        scaleY: finiteOr(l.transform.scaleY, 1, 0.001, 1000),
        rotation: finiteOr(l.transform.rotation, 0),
      },
    }));

  const projectName = (name ?? project.name ?? "").trim();
  useEditorStore.getState().loadProject({ canvas, layers, name: projectName });
  // the previous document is unreachable now (history reset) — free its assets
  releaseAssetsExcept(new Set(layers.map((l) => l.assetId).filter((id): id is string => Boolean(id))));
  if (project.exportConfig) writeExportConfig(project.exportConfig);
  useViewportStore.getState().fit(canvas.width, canvas.height);
}

/** Open a .layercut file picked from disk. */
export async function openProjectFile(file: File): Promise<void> {
  const json = await file.text();
  await loadProjectJson(json, file.name.replace(/\.[^.]+$/, ""));
  const name = useEditorStore.getState().projectName;
  await addRecent({
    name: name || "layercut",
    savedAt: Date.now(),
    layerCount: useEditorStore.getState().layers.length,
    json,
  });
}

function finiteOr(v: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof v === "number" && isFinite(v) ? v : fallback;
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(typeof v === "number" && isFinite(v) ? v : fallback);
  return Math.min(max, Math.max(min, n));
}
