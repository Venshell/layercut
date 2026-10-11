const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function harness(picker, layers = [], assets = { a: { kind: 'svg' } }) {
  let pickerCalls = 0, downloads = 0;
  global.window = picker ? { showDirectoryPicker: async function (options) {
    pickerCalls++;
    return picker(options);
  } } : {};
  global.document = {
    body: { appendChild() {} },
    createElement: () => ({ click() { downloads++; }, remove() {} }),
  };
  const source = process.env.REGRESSION_REF
    ? execFileSync('git', ['show', `${process.env.REGRESSION_REF}:src/export/exportAll.ts`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'src/export/exportAll.ts'), 'utf8');
  const blob = new Blob(['image-data']);
  class Zip { file() {} async generateAsync() { return new Blob(['zip-data']); } }
  const deps = {
    jszip: Zip,
    '../assets/assetStore': { useAssetStore: { getState: () => ({ assets }) } },
    '../layers/layerStore': { useEditorStore: { getState: () => ({ canvas: {}, layers, selectedIds: [] }) } },
    '../layers/layerUtils': {
      validSelection: () => [],
      isLayerOccluder: l => l.visible || l.occludesWhenHidden === true,
    },
    './exportPNG': {
      canvasToBlob: async () => blob,
      rasterizeComposite: () => ({}),
      exportableLayers: ls => ls.map((layer, index) => ({ layer, index })).filter(({ layer }) => layer.visible),
      downloadBlob: () => document.createElement('a').click(),
    },
    './naming': {
      COMPOSITE_NAME_KEY: 'composite',
      normalizedBase: value => (typeof value === 'string' && value.trim() !== '' ? value : undefined),
      compositeBaseName: () => 'layercut_composite',
      compositeName: () => 'layercut_composite.png',
      defaultBaseName: (index, name) => `${String(index).padStart(3, '0')}_${String(name ?? 'layer')}`,
      // These cases assert the save destination, not name disambiguation; the
      // real dedupe/rename rules are covered by scripts/export-naming-regressions.html.
      resolveFileNames: (bases, ext) => bases.map(base => `${base}.${ext}`),
    },
    // Both exports the real module imports must exist here. Missing
    // svgHasPartialAlpha used to make the opacity gate unreachable — and then
    // crash with a TypeError the moment a case supplied svgText.
    '../vector/svgSafety': {
      analyzeSvgSafety: () => ({ safe: true }),
      svgHasPartialAlpha: svgText => /\b(?:fill|stroke)?opacity\s*[:=]\s*["']?0?\.\d/.test(String(svgText ?? '')),
    },
    '../occlusion/OcclusionEngine': { computeOcclusion: () => ({ byLayerId: new Map() }) },
    '../vector/svgBoolean': {
      // Gate tests only care about reaching the vector engine, not its result.
      computeVectorOcclusion: ls => ({ byLayerId: new Map(ls.map(l => [l.id, '<svg/>'])) }),
    },
    // Layers carry per-layer paint overrides in the real pipeline; these tests
    // only cover the save destination, so paint resolution is an identity pass.
    '../vector/svgPaint': { paintedAssetsForLayers: async (_layers, assets) => assets },
  };
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  const module = { exports: {} };
  const originalTimeout = global.setTimeout;
  // URL cleanup is synchronous in this adapter; no five-second test timer.
  global.setTimeout = fn => { fn(); return 0; };
  new Function('require', 'module', 'exports', js)(name => {
    if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
    return deps[name];
  }, module, module.exports);
  return {
    export: destination => module.exports.exportLayers('composite', 1, 'png', undefined, destination),
    exportSvg: destination => module.exports.exportLayers('all', 1, 'svg', undefined, destination),
    counts: () => ({ pickerCalls, downloads }),
    dispose: () => { global.setTimeout = originalTimeout; },
  };
}

async function main() {
  const cases = [
    ['explicit ZIP never opens a restricted folder picker', async () => {
      const h = harness(() => { throw new DOMException('Restricted directory', 'AbortError'); });
      try { assert.equal(await h.export('zip'), 'zip'); assert.deepEqual(h.counts(), { pickerCalls: 0, downloads: 1 }); }
      finally { h.dispose(); }
    }],
    ['composite cancellation is not reported as folder success', async () => {
      const h = harness(() => { throw new DOMException('Cancelled', 'AbortError'); });
      try { assert.equal(await h.export('folder'), 'cancelled'); assert.equal(h.counts().downloads, 0); }
      finally { h.dispose(); }
    }],
    ['unavailable folder API reports ZIP destination', async () => {
      const h = harness();
      try { assert.equal(await h.export('folder'), 'zip'); assert.equal(h.counts().downloads, 1); }
      finally { h.dispose(); }
    }],
    ['folder write is awaited and reports folder destination', async () => {
      let writes = 0, closes = 0;
      const h = harness(async () => ({ getFileHandle: async () => ({ createWritable: async () => ({
        write: async data => { assert(data instanceof Blob); writes++; }, close: async () => { closes++; },
      }) }) }));
      try { assert.equal(await h.export('folder'), 'folder'); assert.equal(writes, 1); assert.equal(closes, 1); }
      finally { h.dispose(); }
    }],
    ['a hidden empty layer does not veto SVG export', async () => {
      const layers = [
        { id: 'empty', type: 'empty', assetId: null, visible: false, occludesWhenHidden: true },
        { id: 'svg1', type: 'svg', assetId: 'a', visible: true, occludesWhenHidden: false },
      ];
      const h = harness(undefined, layers);
      try { assert.equal(await h.exportSvg('zip'), 'zip'); assert.equal(h.counts().downloads, 1); }
      finally { h.dispose(); }
    }],
    ['a hidden non-empty PNG occluder still vetoes SVG export', async () => {
      const layers = [
        { id: 'png', type: 'png', assetId: null, visible: false, occludesWhenHidden: true },
        { id: 'svg1', type: 'svg', assetId: 'a', visible: true, occludesWhenHidden: false },
      ];
      const h = harness(undefined, layers);
      try { await assert.rejects(h.exportSvg('zip'), { message: 'svg_needs_all_svg' }); }
      finally { h.dispose(); }
    }],
    // The opacity gate was unreachable before: the asset had no svgText and the
    // layers carried no opacity, so both of its branches short-circuited.
    ['a partially transparent SVG source vetoes SVG export', async () => {
      const layers = [{ id: 'svg1', type: 'svg', assetId: 'a', visible: true, occludesWhenHidden: false, opacity: 1 }];
      const assets = { a: { kind: 'svg', svgText: '<svg><rect fill-opacity="0.5"/></svg>' } };
      const h = harness(undefined, layers, assets);
      try { await assert.rejects(h.exportSvg('zip'), { message: 'svg_partial_opacity' }); }
      finally { h.dispose(); }
    }],
    ['a partially transparent layer opacity vetoes SVG export', async () => {
      const layers = [{ id: 'svg1', type: 'svg', assetId: 'a', visible: true, occludesWhenHidden: false, opacity: 0.5 }];
      const assets = { a: { kind: 'svg', svgText: '<svg><rect fill="#ff0000"/></svg>' } };
      const h = harness(undefined, layers, assets);
      try { await assert.rejects(h.exportSvg('zip'), { message: 'svg_partial_opacity' }); }
      finally { h.dispose(); }
    }],
    ['a fully opaque SVG source still exports', async () => {
      const layers = [{ id: 'svg1', type: 'svg', assetId: 'a', visible: true, occludesWhenHidden: false, opacity: 1 }];
      const assets = { a: { kind: 'svg', svgText: '<svg><rect fill="#ff0000"/></svg>' } };
      const h = harness(undefined, layers, assets);
      try { assert.equal(await h.exportSvg('zip'), 'zip'); assert.equal(h.counts().downloads, 1); }
      finally { h.dispose(); }
    }],
  ];
  let failed = 0;
  for (const [name, run] of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
