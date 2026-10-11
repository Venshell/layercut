const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), js)(
    name => {
      if (name in mocks) return mocks[name];
      // Unmocked relative imports are pure modules — load them for real.
      if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts', {}, globals);
      throw new Error(`Missing mock: ${name}`);
    },
    exports, ...Object.values(globals),
  );
  return exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const layer = id => ({ id, name: id, type: 'empty', assetId: null, transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, opacity: 1, visible: true, locked: false });
const canvas = { width: 100, height: 100, background: 'transparent' };
const project = () => ({ app: 'layercut', version: 1, name: 'test', canvas, assets: {}, layers: [layer('A')] });
const types = load('src/project/projectTypes.ts');

function saveHarness(serializeProject = types.serializeProject, native = {}) {
  const state = {
    canvas, layers: [layer('A')], projectName: 'A', historyVersion: 1, savedVersion: 0, documentEpoch: 1,
    loadProject(doc) { Object.assign(this, doc); },
    setProjectName(name) { this.projectName = name; },
    markSaved(version = this.historyVersion, epoch = this.documentEpoch) { if (epoch === this.documentEpoch) this.savedVersion = version; },
  };
  const downloaded = [];
  const written = [];
  const api = load('src/project/saveProject.ts', {
    '../export/exportPNG': { downloadBlob: blob => downloaded.push(blob) },
    '@tauri-apps/api/core': { isTauri: () => native.enabled === true },
    '@tauri-apps/plugin-dialog': { save: async () => native.path ?? null },
    '@tauri-apps/plugin-fs': { writeTextFile: async (path, json) => { if (native.writeError) throw native.writeError; written.push({ path, json }); } },
    '../import/importPNG': {}, '../import/importSVG': {},
    '../assets/assetStore': { useAssetStore: { getState: () => ({ assets: {} }) }, releaseAssetsExcept: () => {} },
    '../layers/layerStore': { useEditorStore: { getState: () => state } },
    '../editor/ViewportManager': { useViewportStore: { getState: () => ({ fit() {} }) } },
    '../layers/layerUtils': { sanitizeFileName: name => name },
    './storage': { addRecent: async () => {} },
    './projectTypes': { ...types, serializeProject },
    './exportConfig': { readExportConfig() {}, writeExportConfig() {} },
  });
  return { state, downloaded, written, api };
}

function autosaveHarness() {
  let state = { canvas, layers: [], projectName: 'test', documentEpoch: 1 };
  let subscriber, cleanup;
  const timers = new Map(), events = new Map(), jobs = [], writes = [];
  let timerId = 0, failWrite = false;
  const api = load('src/project/useAutosave.ts', {
    react: { useEffect: fn => { cleanup = fn(); } },
    '../layers/layerStore': { useEditorStore: { getState: () => state, subscribe: fn => { subscriber = fn; return () => {}; } } },
    '../assets/assetStore': { useAssetStore: { getState: () => ({ assets: {} }) } },
    './projectTypes': { serializeProject: async (name, c, layers, assets, exportConfig) => { const d = deferred(); jobs.push(d); await d.promise; return { name, canvas: c, layers, exportConfig }; } },
    './storage': { writeAutosave: async record => { if (failWrite) throw new Error('write rejected'); writes.push(JSON.parse(record.json)); } },
    './exportConfig': { readExportConfig: () => ({ scope: 'all', scale: 2 }) },
  }, {
    document: { visibilityState: 'hidden', addEventListener: (name, fn) => events.set(name, fn), removeEventListener() {} },
    window: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener() {} },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    console: { warn() {} },
  });
  api.useAutosave();
  return {
    jobs, writes, events,
    edit(id) { state = { ...state, layers: [layer(id)] }; subscriber(state); },
    rename(name) { state = { ...state, projectName: name }; subscriber(state); },
    fire() { const first = timers.entries().next().value; if (first) { timers.delete(first[0]); first[1](); } },
    cleanup: () => cleanup(),
    setFail(value) { failWrite = value; },
  };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }
test('save keeps edits made during serialization dirty', async () => {
  const d = deferred(); const h = saveHarness(async (name, c, layers) => { await d.promise; return { name, canvas: c, layers }; });
  const save = h.api.saveProjectAs('saved'); h.state.layers = [layer('B')]; h.state.historyVersion = 2;
  d.resolve(); await save;
  assert.equal(JSON.parse(await h.downloaded[0].text()).layers[0].id, 'A');
  assert.equal(h.state.savedVersion, 1); assert.equal(h.state.historyVersion, 2);
});
test('save cannot rename or mark a different document saved', async () => {
  const d = deferred(); const h = saveHarness(async () => { await d.promise; return project(); });
  const save = h.api.saveProjectAs('old'); h.state.documentEpoch = 2; h.state.projectName = 'new'; h.state.historyVersion = 2;
  d.resolve(); await save; assert.equal(h.state.projectName, 'new'); assert.equal(h.state.savedVersion, 0);
});
test('native save cancellation leaves project dirty', async () => {
  const h = saveHarness(types.serializeProject, { enabled: true });
  assert.equal(await h.api.saveProjectAs('cancelled'), false);
  assert.equal(h.written.length, 0); assert.equal(h.state.savedVersion, 0);
});
test('native write failure leaves project dirty', async () => {
  const h = saveHarness(types.serializeProject, { enabled: true, path: 'test.layercut', writeError: new Error('disk full') });
  await assert.rejects(h.api.saveProjectAs('failure'), /disk full/);
  assert.equal(h.state.savedVersion, 0);
});
test('native save writes JSON before marking project saved', async () => {
  const h = saveHarness(types.serializeProject, { enabled: true, path: 'test.layercut' });
  assert.equal(await h.api.saveProjectAs('test'), true);
  assert.equal(h.written[0].path, 'test.layercut');
  assert.equal(JSON.parse(h.written[0].json).name, 'test');
  assert.equal(h.state.savedVersion, 1);
});
test('project numeric bounds clamp both ends', async () => {
  const h = saveHarness(); const p = project(); p.layers[0].opacity = 9; p.layers[0].transform.scaleX = 100000; p.layers[0].transform.scaleY = -2;
  await h.api.loadProjectJson(JSON.stringify(p)); assert.equal(h.state.layers[0].opacity, 1); assert.equal(h.state.layers[0].transform.scaleX, 1000); assert.equal(h.state.layers[0].transform.scaleY, 0.001);
});
test('schema rejects incomplete and malformed projects before loading', async () => {
  const cases = [
    { ...project(), canvas: null }, { ...project(), layers: undefined }, { ...project(), assets: undefined },
    { ...project(), layers: [{ ...layer('A'), transform: null }] },
    { ...project(), layers: [{ ...layer('A'), type: 'unknown' }] },
    { ...project(), layers: [layer('A'), layer('A')] },
    { ...project(), layers: [{ ...layer('A'), type: 'png', assetId: 'missing' }] },
    { ...project(), exportConfig: { scope: 'all', scale: -1 } },
    { ...project(), assets: { A: { kind: 'png', fileName: 'a', mimeType: 'image/png', data: 'https://example.com/a' } } },
  ];
  for (const p of cases) { assert.equal(types.isValidProjectJson(p), false, JSON.stringify(p)); const h = saveHarness(); await assert.rejects(h.api.loadProjectJson(JSON.stringify(p)), /not a layercut project/); assert.equal(h.state.layers[0].id, 'A'); }
});
test('autosave serializes latest edit after an in-flight save', async () => {
  const h = autosaveHarness(); h.edit('A'); h.fire(); assert.equal(h.jobs.length, 1);
  h.edit('B'); h.fire(); assert.equal(h.jobs.length, 1, 'writes must be serialized');
  h.jobs[0].resolve(); await tick(); assert.equal(h.jobs.length, 2); h.jobs[1].resolve(); await tick();
  assert.deepEqual(h.writes.map(p => p.layers[0].id), ['A', 'B']); assert.deepEqual(h.writes[1].exportConfig, { scope: 'all', scale: 2 }); h.cleanup();
});
test('autosave cleanup flushes pending data', async () => {
  const h = autosaveHarness(); h.edit('A'); h.cleanup(); assert.equal(h.jobs.length, 1); h.jobs[0].resolve(); await tick(); assert.equal(h.writes[0].layers[0].id, 'A');
});
test('failed autosave remains retryable', async () => {
  const h = autosaveHarness(); h.edit('A'); h.fire(); h.setFail(true); h.jobs[0].resolve(); await tick();
  h.setFail(false); h.events.get('pagehide')(); assert.equal(h.jobs.length, 2); h.jobs[1].resolve(); await tick(); assert.equal(h.writes.length, 1); h.cleanup();
});
test('project name changes are included in autosave identity', async () => {
  const h = autosaveHarness(); h.edit('A'); h.fire(); h.jobs[0].resolve(); await tick();
  h.rename('renamed'); h.fire(); assert.equal(h.jobs.length, 2); h.jobs[1].resolve(); await tick(); assert.equal(h.writes[1].name, 'renamed'); h.cleanup();
});

(async () => { let failed = 0; for (const t of tests) { try { await t.run(); console.log(`PASS ${t.name}`); } catch (e) { failed++; console.error(`FAIL ${t.name}: ${e.message}`); } } console.log(`${tests.length - failed}/${tests.length} project regressions passed`); if (failed) process.exitCode = 1; })();
