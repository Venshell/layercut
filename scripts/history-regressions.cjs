/**
 * History / layer-store regressions (run against the REAL zustand store):
 *   P0-1  opening a project or creating a canvas resets the undo stack
 *   B1    locked layers are ignored by delete/duplicate
 *   B2    undo during a drag drops the pending snapshot instead of corrupting
 *         the redo chain when the gesture commits
 *   B16   undoing back to the saved state clears the dirty marker
 *   B18   duplicating several layers at once cannot produce duplicate names
 *   B20   reorder clamps out-of-range indices instead of splicing undefined
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', js)(name => {
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
    return require(name); // bare packages (zustand)
  }, exports);
  return exports;
}

const canvas = { width: 100, height: 100, background: 'transparent' };
const layer = (id, name = id) => ({
  id, name, type: 'empty', assetId: null,
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  opacity: 1, visible: true, locked: false, aspectLocked: false, occludesWhenHidden: false,
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('P0-1: opening a project resets history and the dirty flag', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  useEditorStore.getState().addLayers([layer('A')]);
  assert.equal(useEditorStore.getState().canUndo, true);
  useEditorStore.getState().loadProject({ canvas, layers: [layer('B')], name: 'projB' });
  const after = useEditorStore.getState();
  assert.equal(after.canUndo, false);
  assert.equal(after.canRedo, false);
  assert.equal(after.projectName, 'projB');
  assert.equal(after.historyVersion, after.savedVersion, 'loaded document is not dirty');
  // undo must be a no-op, not a window into the previous project
  after.undo();
  const undone = useEditorStore.getState();
  assert.equal(undone.layers.length, 1);
  assert.equal(undone.layers[0].id, 'B');
  assert.equal(undone.projectName, 'projB');
});

test('P0-1: new canvas resets history and marks the document dirty', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  const s = useEditorStore.getState();
  s.addLayers([layer('A')]);
  s.markSaved();
  assert.equal(useEditorStore.getState().historyVersion, useEditorStore.getState().savedVersion);
  useEditorStore.getState().newCanvas({ ...canvas, width: 128, height: 128 });
  const after = useEditorStore.getState();
  assert.equal(after.layers.length, 0);
  assert.equal(after.canUndo, false);
  assert.notEqual(after.historyVersion, after.savedVersion, 'replaced content counts as unsaved');
  after.undo();
  assert.equal(after.layers.length, 0, 'undo cannot resurrect the replaced canvas');
});

test('B2: undo during an open gesture drops the pending snapshot', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  const s = useEditorStore.getState();
  s.addLayers([layer('A')]);                    // past: [S0]
  s.updateLayerTransform('A', { x: 1 }, true);  // past: [S0, S1(x=1)], v2
  s.beginTransaction();                         // pending: S2 (x=1)
  s.updateLayerTransform('A', { x: 99 }, false);
  assert.equal(useEditorStore.getState().layers[0].transform.x, 99);
  s.undo();                                     // drops pending; undoes the x=1 commit
  assert.equal(useEditorStore.getState().layers[0].transform.x, 0);
  // the gesture commits after the undo — it must not push the stale
  // pre-drag state or wipe the redo chain
  s.commitTransaction();
  assert.equal(useEditorStore.getState().canRedo, true, 'redo chain survives the gesture');
  s.redo();
  assert.equal(useEditorStore.getState().layers[0].transform.x, 99);
});

test('B16: undoing back to the saved state clears the dirty marker', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  const s = useEditorStore.getState();
  s.addLayers([layer('A')]);
  s.markSaved();
  const savedVersion = useEditorStore.getState().savedVersion;
  s.addLayers([layer('B')]);
  assert.notEqual(useEditorStore.getState().historyVersion, savedVersion, 'dirty after edit');
  s.undo();
  assert.equal(useEditorStore.getState().historyVersion, savedVersion, 'clean after undo');
  s.redo();
  assert.notEqual(useEditorStore.getState().historyVersion, savedVersion, 'dirty again after redo');
});

test('B18: duplicating two layers at once produces distinct names', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  const s = useEditorStore.getState();
  s.addLayers([layer('A', 'A'), layer('B', 'A copy')]);
  s.setSelection(['A', 'B']);
  s.duplicateSelected();
  const names = useEditorStore.getState().layers.map(l => l.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate names: ' + names.join(', '));
  assert.ok(names.includes('A copy 2'), names.join(', '));
  assert.ok(names.includes('A copy 3'), names.join(', '));
});

test('B1: locked layers survive delete and duplicate', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  const s = useEditorStore.getState();
  s.addLayers([layer('locked'), layer('free')]);
  s.updateLayer('locked', { locked: true });
  s.setSelection(['locked']);
  s.deleteSelected();
  assert.equal(useEditorStore.getState().layers.length, 2, 'locked layer is not deleted');
  s.duplicateSelected();
  assert.equal(useEditorStore.getState().layers.length, 2, 'locked layer is not duplicated');
  // a mixed selection acts only on the unlocked layers
  s.setSelection(['locked', 'free']);
  s.deleteSelected();
  const after = useEditorStore.getState();
  assert.deepEqual(after.layers.map(l => l.id), ['locked']);
  assert.deepEqual(after.selectedIds, ['locked'], 'locked layer stays selected');
});

test('B20: reorder clamps out-of-range indices', () => {
  const { useEditorStore } = load('src/layers/layerStore.ts');
  const s = useEditorStore.getState();
  s.addLayers([layer('A'), layer('B'), layer('C')]);
  s.reorder(99, 0);
  assert.deepEqual(useEditorStore.getState().layers.map(l => l.id), ['C', 'A', 'B']);
  s.reorder(-5, 1);
  assert.deepEqual(useEditorStore.getState().layers.map(l => l.id), ['A', 'C', 'B']);
  s.reorder(1, 1);
  assert.deepEqual(useEditorStore.getState().layers.map(l => l.id), ['A', 'C', 'B'], 'no-op reorder changes nothing');
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.run(); console.log(`PASS ${t.name}`); }
    catch (e) { failed++; console.error(`FAIL ${t.name}: ${e.message}`); }
  }
  console.log(`${tests.length - failed}/${tests.length} history regressions passed`);
  if (failed) process.exitCode = 1;
})();
