'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { applyPatch, removePatch, patchDir, unpatchDir } = require('../patcher');

const REPO = path.join(__dirname, '..');
// Smallest valid module that passes the sanity check.
const ORIG = 'var root={createRoot(){}};root.createRoot(document.querySelector("#root"));var s={setEffortLevel(){}};s.setEffortLevel("high");\n';
const OLD = '/*payload v1*/console.log(1);';
const NEW = '/*payload v2*/console.log(2);';

const countBlocks = (src) => src.split('claude-effort-picker:begin').length - 1;

function withFakeExt(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccep-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'webview'));
    const file = path.join(dir, 'webview', 'index.js');
    fs.writeFileSync(file, content);
    fn(dir, file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function parsesAsModule(dir, file) {
  const mjs = path.join(dir, 'check.mjs');
  fs.copyFileSync(file, mjs);
  execFileSync(process.execPath, ['--check', mjs], { stdio: 'pipe' });
}

test('apply then remove is byte-identical', () => {
  const patched = applyPatch(ORIG, NEW);
  assert.ok(patched.startsWith(ORIG));
  assert.ok(patched.includes(NEW));
  assert.ok(patched.endsWith('/*claude-effort-picker:end*/\n'));
  assert.strictEqual(removePatch(patched), ORIG);
  assert.strictEqual(removePatch(ORIG), ORIG);
});

test('applying the same payload twice is a no-op', () => {
  const once = applyPatch(ORIG, NEW);
  assert.strictEqual(applyPatch(once, NEW), once);
});

test('an older payload block is replaced, never stacked', () => {
  const patched = applyPatch(applyPatch(ORIG, OLD), NEW);
  assert.strictEqual(countBlocks(patched), 1);
  assert.ok(patched.includes(NEW));
  assert.ok(!patched.includes(OLD));
  assert.strictEqual(patched, applyPatch(ORIG, NEW));
});

test('sanity check refuses bundles without createRoot( or setEffortLevel(', () => {
  assert.throws(() => applyPatch('var a=1;', NEW), /Unsupported Claude Code version/);
  assert.throws(() => applyPatch('x.createRoot(y);', NEW), /Unsupported Claude Code version/);
  assert.throws(() => applyPatch('s.setEffortLevel(1);', NEW), /Unsupported Claude Code version/);
  withFakeExt('x.createRoot(y);', (dir, file) => {
    assert.throws(() => patchDir(dir, NEW), /Unsupported Claude Code version/);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'x.createRoot(y);');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['index.js']);
  });
});

test('missing bundle gives a clear error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccep-test-'));
  try {
    assert.throws(() => patchDir(dir, NEW), /webview bundle not found/);
    assert.throws(() => unpatchDir(dir), /webview bundle not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchDir / unpatchDir round trip on disk, no temp files left', () => {
  // BOM, invalid UTF-8 and multi-byte chars must survive byte for byte.
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(ORIG), Buffer.from([0xff, 0xfe, 0xc3, 0xa9, 0x0a])]);
  withFakeExt(original, (dir, file) => {
    assert.deepStrictEqual(patchDir(dir, OLD), { changed: true });
    assert.deepStrictEqual(patchDir(dir, OLD), { changed: false });
    assert.deepStrictEqual(patchDir(dir, NEW), { changed: true });
    assert.strictEqual(countBlocks(fs.readFileSync(file, 'latin1')), 1);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['index.js']);
    assert.deepStrictEqual(unpatchDir(dir), { changed: true });
    assert.deepStrictEqual(unpatchDir(dir), { changed: false });
    assert.ok(fs.readFileSync(file).equals(original));
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['index.js']);
  });
});

test('default payload is webview/effort-picker.js and the patched bundle still parses', () => {
  const payload = fs.readFileSync(path.join(REPO, 'webview', 'effort-picker.js'), 'latin1');
  withFakeExt(ORIG, (dir, file) => {
    assert.deepStrictEqual(patchDir(dir), { changed: true });
    assert.strictEqual(fs.readFileSync(file, 'latin1'), applyPatch(ORIG, payload));
    parsesAsModule(dir, file);
  });
});

test('uninstall.js restores sibling Claude Code folders and never throws', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccep-test-'));
  try {
    const self = path.join(root, 'trofeomedia.claude-effort-picker-0.1.0');
    fs.mkdirSync(path.join(self, 'webview'), { recursive: true });
    for (const f of ['patcher.js', 'uninstall.js', path.join('webview', 'effort-picker.js')]) {
      fs.copyFileSync(path.join(REPO, f), path.join(self, f));
    }
    const claude = path.join(root, 'anthropic.claude-code-9.9.9');
    fs.mkdirSync(path.join(claude, 'webview'), { recursive: true });
    fs.writeFileSync(path.join(claude, 'webview', 'index.js'), ORIG);
    patchDir(claude);
    fs.mkdirSync(path.join(root, 'anthropic.claude-code-0.0.1-broken')); // no bundle: must be skipped, not fatal
    execFileSync(process.execPath, [path.join(self, 'uninstall.js')], { stdio: 'pipe' });
    assert.strictEqual(fs.readFileSync(path.join(claude, 'webview', 'index.js'), 'latin1'), ORIG);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Read-only use of the real install: only a COPY in a temp dir is ever patched.
function newestClaudeBundle() {
  const root = path.join(os.homedir(), '.vscode', 'extensions');
  let names;
  try {
    names = fs.readdirSync(root).filter((n) => n.startsWith('anthropic.claude-code-'));
  } catch (_) {
    return null;
  }
  names.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const n of names) {
    const file = path.join(root, n, 'webview', 'index.js');
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const realBundle = newestClaudeBundle();
test('real Claude Code bundle: patched copy parses, unpatch is byte-identical', { skip: !realBundle && 'no Claude Code install found' }, () => {
  // The install may already be patched (this add-on installed), so start from its unpatched form.
  const original = Buffer.from(removePatch(fs.readFileSync(realBundle, 'latin1')), 'latin1');
  withFakeExt(original, (dir, file) => {
    assert.deepStrictEqual(patchDir(dir), { changed: true });
    parsesAsModule(dir, file);
    assert.deepStrictEqual(unpatchDir(dir), { changed: true });
    assert.ok(fs.readFileSync(file).equals(original));
  });
});
