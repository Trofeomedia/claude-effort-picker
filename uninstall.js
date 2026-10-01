'use strict';
// Runs with plain node when VS Code finalizes the uninstall (no vscode API here).
// Restores every Claude Code install next to this extension. Must never throw.
const fs = require('fs');
const path = require('path');

try {
  const { unpatchDir } = require('./patcher');
  const root = path.join(__dirname, '..');
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith('anthropic.claude-code-')) continue;
    try {
      unpatchDir(path.join(root, name));
    } catch (_) { /* one broken folder must not stop the others */ }
  }
} catch (_) { /* nothing useful to do: VS Code ignores the result */ }
