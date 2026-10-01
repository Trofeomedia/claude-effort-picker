'use strict';
// Pure Node (no vscode API) so uninstall.js and the tests can use it too.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BEGIN = '\n/*claude-effort-picker:begin';
const END = '\n/*claude-effort-picker:end*/\n';
const PAYLOAD_FILE = path.join(__dirname, 'webview', 'effort-picker.js');

// Everything from our begin marker to the end of the file is ours; cutting it gives back the original.
function removePatch(src) {
  const i = src.indexOf(BEGIN);
  return i === -1 ? src : src.slice(0, i);
}

function applyPatch(src, payload) {
  const orig = removePatch(src);
  if (!orig.includes('createRoot(') || !orig.includes('setEffortLevel(')) {
    throw new Error('Unsupported Claude Code version: its webview bundle does not look as expected, so it was not patched.');
  }
  const hash = crypto.createHash('sha1').update(payload).digest('hex').slice(0, 8);
  return `${orig}${BEGIN} ${hash}*/\n${payload}${END}`;
}

// latin1 maps every byte to exactly one char and back, so the round trip is byte-identical
// no matter what encoding quirks the bundle has.
function update(dir, change) {
  const file = path.join(dir, 'webview', 'index.js');
  if (!fs.existsSync(file)) throw new Error(`Claude Code webview bundle not found: ${file}`);
  const src = fs.readFileSync(file, 'latin1');
  const out = change(src);
  if (out === src) return { changed: false };
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, out, 'latin1');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch (_) { /* the original error below is the one that matters */ }
    throw err;
  }
  return { changed: true };
}

function patchDir(dir, payload = fs.readFileSync(PAYLOAD_FILE, 'latin1')) {
  return update(dir, (src) => applyPatch(src, payload));
}

function unpatchDir(dir) {
  return update(dir, removePatch);
}

module.exports = { applyPatch, removePatch, patchDir, unpatchDir };
