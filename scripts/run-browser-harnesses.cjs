#!/usr/bin/env node
/**
 * Run the browser-based regression harnesses headlessly.
 *
 * These six harnesses import from `src/` and need a real browser: they decode
 * SVG, rasterize canvases and mount react-konva. Until now they could only be
 * opened by hand at a dev-server URL, which in practice meant nobody ran them —
 * the `<use>` silent-wrong-output bug lived in exactly that blind spot.
 *
 * Design notes:
 *  - The browser is auto-detected from the usual install paths, or set
 *    BROWSER_PATH. With no browser available the run is SKIPPED (exit 0) so a
 *    machine without Edge/Chrome is not blocked.
 *  - The dev server is spawned with `stdio: 'ignore'` and polled over HTTP.
 *    Nothing pipes a child's stdio: capturing a child's output through a pipe is
 *    blocked in some sandboxes, so the DOM dump is redirected to a FILE by a
 *    shell instead (`cmd /c ... > file`), which keeps the browser's stdout out
 *    of this process entirely.
 *  - `--virtual-time-budget` gives each page time to finish its async work
 *    (image decoding, rasterization, react render) before the DOM is captured.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HARNESSES = [
  'vector-regressions',
  'shape-regressions',
  'layer-visibility-regressions',
  'svg-paint-regressions',
  'canvas-pan-regressions',
  'export-naming-regressions',
];
const PORT = Number(process.env.HARNESS_PORT || 5399);
const VIRTUAL_TIME_MS = Number(process.env.HARNESS_VIRTUAL_TIME || 30000);
const DUMP_TIMEOUT_MS = Number(process.env.HARNESS_TIMEOUT || 120000);

function findBrowser() {
  if (process.env.BROWSER_PATH) {
    return fs.existsSync(process.env.BROWSER_PATH) ? process.env.BROWSER_PATH : null;
  }
  const candidates = [
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
    '/snap/bin/chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function waitForServer(url, deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url).then((res) => (res.ok ? resolve() : retry())).catch(retry);
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error(`dev server did not answer at ${url}`));
      else setTimeout(attempt, 250);
    };
    attempt();
  });
}

async function startServer() {
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  const stop = () => { if (!child.killed) child.kill(); };
  try {
    await waitForServer(`http://localhost:${PORT}/`, Date.now() + 30000);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** Run the browser with its stdout redirected to `outFile` by a shell. */
function dumpDomToFile(browser, url, profileDir, outFile) {
  return new Promise((resolve, reject) => {
    const flags = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${profileDir}`,
      `--virtual-time-budget=${VIRTUAL_TIME_MS}`,
      '--dump-dom',
      url,
    ];
    // Quote everything, then let a shell perform the redirection: the browser's
    // stdout must not come back through a pipe we own (see the header note).
    const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const redirect = process.platform === 'win32' ? '2>nul' : '2>/dev/null';
    const command = `${quote(browser)} ${flags.map(quote).join(' ')} > ${quote(outFile)} ${redirect}`;
    const child = spawn(command, {
      shell: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${DUMP_TIMEOUT_MS}ms`));
    }, DUMP_TIMEOUT_MS);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

/** Read the harness verdict out of a dumped page. */
function verdictOf(dom) {
  const structured = /<pre id="result">(\{[\s\S]*?\})<\/pre>/.exec(dom);
  if (structured) {
    try {
      const parsed = JSON.parse(structured[1]);
      return { ok: parsed.passed === parsed.total, label: `${parsed.passed}/${parsed.total}` };
    } catch { /* fall through to the plain-text form */ }
  }
  const plain = /<pre id="result">([\s\S]*?)<\/pre>/.exec(dom);
  if (plain) {
    const text = plain[1].trim();
    return text.startsWith('PASS') ? { ok: true, label: 'PASS' } : { ok: false, label: text.split('\n')[0] };
  }
  return { ok: false, label: 'no #result element (page did not run)' };
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    // A silent skip that reports success is exactly how the `<use>` bug stayed
    // hidden: the harnesses "passed" because nobody ran them. Skipping is still
    // allowed for a developer without a browser, but it must be requested.
    if (process.env.HARNESS_ALLOW_SKIP === '1') {
      console.log('SKIP browser harnesses: no browser found (HARNESS_ALLOW_SKIP=1)');
      return;
    }
    console.error(
      'FAIL browser harnesses: no Edge/Chrome found.\n' +
        '  Install one, set BROWSER_PATH, or set HARNESS_ALLOW_SKIP=1 to skip explicitly.'
    );
    process.exitCode = 1;
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'layercut-harness-'));
  let stop = null;
  let failed = 0;
  try {
    stop = await startServer();
    for (const name of HARNESSES) {
      const profileDir = path.join(tmpRoot, `profile-${name}`);
      const outFile = path.join(tmpRoot, `${name}.html`);
      const url = `http://localhost:${PORT}/scripts/${name}.html`;
      let line;
      try {
        await dumpDomToFile(browser, url, profileDir, outFile);
        const { ok, label } = verdictOf(fs.readFileSync(outFile, 'utf8'));
        if (!ok) failed++;
        line = `${ok ? 'PASS' : 'FAIL'} ${name} (${label})`;
      } catch (error) {
        failed++;
        line = `FAIL ${name} (${error.message})`;
      } finally {
        fs.rmSync(profileDir, { recursive: true, force: true });
        fs.rmSync(outFile, { force: true });
      }
      console.log(line);
    }
  } finally {
    if (stop) stop();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`browser harness runner failed: ${error.message}`);
  process.exitCode = 1;
});
