/**
 * Export naming regressions: renaming output files and the automatic "(1)"
 * disambiguation of duplicates inside one batch.
 *
 * Run `npm run dev`, then open
 *   http://localhost:5173/scripts/export-naming-regressions.html
 * and check that the result line ends with PASS.
 *
 * The last block is the important one: it drives the real `exportLayers` with a
 * stubbed folder picker and asserts that the names the dialog previews are
 * exactly the names that get written.
 */
import { resolveFileNames, defaultBaseName, exportName, compositeName, compositeBaseName, normalizedBase, COMPOSITE_NAME_KEY } from "../src/export/naming";
import { exportLayers, planExportFiles } from "../src/export/exportAll";
import { useEditorStore } from "../src/layers/layerStore";
import { useAssetStore } from "../src/assets/assetStore";
import { loadSVGImage } from "../src/renderer/SVGRenderer";
import type { Layer } from "../src/layers/layerTypes";
import type { LayerAsset } from "../src/assets/assetStore";

const assert = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
const eq = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: got ${String(actual)}, want ${String(expected)}`);
};
const eqList = (actual: string[], expected: string[], message: string) => {
  eq(actual.join(" | "), expected.join(" | "), message);
};

// ---------------------------------------------------------------------------
// Pure naming rules
// ---------------------------------------------------------------------------
function namingTests() {
  eq(exportName(1, "background"), "001_background.png", "default batch name");
  eq(exportName(12, "a/b:c"), "012_a_b_c.png", "layer names are sanitized");
  eq(defaultBaseName(3, "Layer 3"), "003_Layer 3", "default base name has no extension");
  eq(compositeName(), "layercut_composite.png", "composite name");
  eq(compositeBaseName(), "layercut_composite", "composite base name");
  eq(normalizedBase("  "), undefined, "blank override means default");
  eq(normalizedBase(""), undefined, "empty override means default");
  eq(normalizedBase("logo"), "logo", "non-blank override is kept");

  eqList(resolveFileNames(["a", "b"], "png"), ["a.png", "b.png"], "unique names pass through");
  eqList(resolveFileNames(["logo", "logo", "logo"], "png"), ["logo.png", "logo (1).png", "logo (2).png"], "duplicates get a counter");
  eqList(resolveFileNames(["Logo", "logo"], "png"), ["Logo.png", "logo (1).png"], "duplicates are case-insensitive");
  eqList(resolveFileNames(["a", "b", "a"], "png"), ["a.png", "b.png", "a (1).png"], "the counter follows batch order");
  eqList(resolveFileNames(["x", "x", "x (1)"], "png"), ["x.png", "x (1).png", "x (1) (1).png"], "an explicit suffix can still collide");
  eqList(resolveFileNames(["a/b:c"], "png"), ["a_b_c.png"], "separators are replaced");
  eqList(resolveFileNames(["   "], "png"), ["layer.png"], "an unusable name falls back");
  eqList(resolveFileNames(["logo"], "svg"), ["logo.svg"], "the extension is preserved for svg");
  eqList(resolveFileNames(["logo", "logo"], "svg"), ["logo.svg", "logo (1).svg"], "the counter goes before the extension");
  assert(resolveFileNames([], "png").length === 0, "an empty batch resolves to nothing");
}

// ---------------------------------------------------------------------------
// The shared export plan
// ---------------------------------------------------------------------------
function layerOf(id: string, name: string, visible = true): Layer {
  return {
    id,
    name,
    type: "svg",
    assetId: "asset",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    visible,
    locked: false,
    aspectLocked: false,
    occludesWhenHidden: false,
  };
}

function planTests() {
  const layers = [layerOf("a", "background"), layerOf("b", "logo", false), layerOf("c", "logo")];
  // the plan filters entries that cannot produce an output file, so it needs
  // the asset map (contents are irrelevant to naming, presence is not)
  const assets = { asset: { kind: "svg" } as unknown as LayerAsset };

  const all = planExportFiles({ assets, layers, selectedIds: [], scope: "all", ext: "png" });
  eq(all.length, 2, "hidden layers are not planned");
  eqList(all.map((f) => f.fileName), ["001_background.png", "003_logo.png"], "default names keep the layer stack index");
  eqList(all.map((f) => f.key), ["a", "c"], "plan is in stack order");

  const selected = planExportFiles({ assets, layers, selectedIds: ["c"], scope: "selected", ext: "png" });
  eqList(selected.map((f) => f.fileName), ["003_logo.png"], "selection narrows the plan");

  const picked = planExportFiles({ assets, layers, selectedIds: ["a"], scope: "current", ext: "png" });
  eqList(picked.map((f) => f.fileName), ["001_background.png"], "current scope uses the selected layer");

  // renaming: identical user input must be disambiguated
  const renamed = planExportFiles({
    assets,
    layers,
    selectedIds: [],
    scope: "all",
    ext: "png",
    overrides: { a: "art", c: "art" },
  });
  eqList(renamed.map((f) => f.fileName), ["art.png", "art (1).png"], "renamed duplicates get a counter");
  eqList(renamed.map((f) => f.base), ["art", "art"], "the editable base stays what the user typed");

  const partial = planExportFiles({
    assets,
    layers,
    selectedIds: [],
    scope: "all",
    ext: "svg",
    overrides: { c: "icon" },
  });
  eqList(partial.map((f) => f.fileName), ["001_background.svg", "icon.svg"], "renaming only affects the edited file");
  eqList(
    planExportFiles({ assets, layers, selectedIds: [], scope: "all", ext: "png", overrides: { a: "   " } }).map((f) => f.fileName),
    ["001_background.png", "003_logo.png"],
    "a blank rename falls back to the default"
  );

  const composite = planExportFiles({ assets, layers, selectedIds: [], scope: "composite", ext: "png" });
  eq(composite.length, 1, "the composite is one file");
  eq(composite[0].key, COMPOSITE_NAME_KEY, "the composite plan uses the composite key");
  eq(composite[0].fileName, "layercut_composite.png", "composite default name");
  eq(
    planExportFiles({ assets, layers, selectedIds: [], scope: "composite", ext: "png", overrides: { [COMPOSITE_NAME_KEY]: "final art" } })[0].fileName,
    "final art.png",
    "the composite can be renamed"
  );

  // the name the user sees is the user's text plus the resolved file name
  const messy = planExportFiles({ assets, layers, selectedIds: [], scope: "all", ext: "png", overrides: { a: "a/b" } });
  eq(messy[0].base, "a/b", "the raw base is reported back for the input field");
  eq(messy[0].fileName, "a_b.png", "the resolved name is sanitized");
}

// ---------------------------------------------------------------------------
// End to end: the planned names are the written names
// ---------------------------------------------------------------------------
const SVG = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="${fill}"/></svg>`;

let written: string[] = [];

/** Stub the File System Access folder picker and record the created file names. */
function stubFolderPicker(): void {
  (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => ({
    getFileHandle: async (name: string) => {
      written.push(name);
      return {
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      };
    },
  });
}

async function writerTests() {
  const bitmap = await loadSVGImage(SVG("#ff0000"));
  const asset: LayerAsset = {
    id: "asset",
    kind: "svg",
    fileName: "art.svg",
    mimeType: "image/svg+xml",
    naturalWidth: 40,
    naturalHeight: 40,
    bitmap,
    svgText: SVG("#ff0000"),
    previewUrl: bitmap.src,
  };
  useAssetStore.getState().put(asset);

  const canvas = { width: 60, height: 60, background: "transparent" as const };
  const layers = [layerOf("a", "background"), layerOf("c", "logo")];
  useEditorStore.getState().loadProject({ canvas, layers, name: "naming test" });

  // --- renames reach the writer, and duplicates get a counter
  const overrides = { a: "art", c: "art" };
  const planned = planExportFiles({
    assets: useAssetStore.getState().assets,
    layers: useEditorStore.getState().layers,
    selectedIds: [],
    scope: "all",
    ext: "png",
    overrides,
  }).map((f) => f.fileName);
  written = [];
  stubFolderPicker();
  eq(await exportLayers("all", 1, "png", undefined, "folder", overrides), "folder", "png export to folder");
  eqList(written, ["art.png", "art (1).png"], "the writer uses the renamed, disambiguated names");
  eqList(written, planned, "the preview equals the written files");

  // --- the extension follows the format, the base survives the switch
  written = [];
  eq(await exportLayers("all", 1, "svg", undefined, "folder", overrides), "folder", "svg export to folder");
  eqList(written, ["art.svg", "art (1).svg"], "svg export keeps the rename and swaps the extension");

  // --- the composite output can be renamed too
  written = [];
  eq(
    await exportLayers("composite", 1, "png", undefined, "folder", { [COMPOSITE_NAME_KEY]: "final art" }),
    "folder",
    "composite export to folder"
  );
  eqList(written, ["final art.png"], "the composite rename reaches the writer");

  // --- default names still work with no overrides at all
  written = [];
  eq(await exportLayers("all", 1, "png", undefined, "folder"), "folder", "export without overrides");
  eqList(written, ["001_background.png", "002_logo.png"], "default names are unchanged");

  // --- a scope with nothing to export is still reported as cancelled
  eq(await exportLayers("selected", 1, "png", undefined, "folder"), "cancelled", "empty selection cancels");
}

async function main() {
  namingTests();
  planTests();
  await writerTests();
  document.getElementById("result")!.textContent =
    "PASS: sanitizing, rename, (1)/(2) disambiguation, case-insensitive collisions, export plan, preview equals written files (png/svg/composite)";
}

main().catch((error) => {
  document.getElementById("result")!.textContent = `FAIL: ${error}`;
});
