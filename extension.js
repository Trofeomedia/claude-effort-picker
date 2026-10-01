'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { patchDir, unpatchDir } = require('./patcher');

const CLAUDE_ID = 'anthropic.claude-code';
// Set by the Remove command, cleared by Apply. Without it the reload that Remove offers
// would activate us again and immediately re-patch.
const REMOVED_KEY = 'removed';
// The Claude Code version we last warned about, so a broken version warns once, not every start in every window.
const WARNED_KEY = 'warnedVersion';
// When this window's extension host started. A bundle patched after that (by us or by another window)
// may not be loaded in this window's Claude panel yet.
const hostStartedAt = Date.now() - process.uptime() * 1000;

let handledPath;
let state;

function getClaude(manual) {
  const ext = vscode.extensions.getExtension(CLAUDE_ID);
  if (!ext && manual) vscode.window.showWarningMessage('Effort Picker: Claude Code (anthropic.claude-code) is not installed.');
  return ext;
}

async function offerReload(message) {
  if (await vscode.window.showInformationMessage(message, 'Reload Window') === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

function apply(ext, manual) {
  handledPath = ext.extensionPath;
  const version = ext.packageJSON.version;
  try {
    let result;
    // One retry: several windows starting at once race to write the same file (Windows rename can fail).
    try { result = patchDir(ext.extensionPath); } catch (_) { result = patchDir(ext.extensionPath); }
    const patchedAt = fs.statSync(path.join(ext.extensionPath, 'webview', 'index.js')).mtimeMs;
    if (result.changed || patchedAt > hostStartedAt) {
      offerReload(`Effort Picker applied to Claude Code ${version}. Reload the window to see it.`);
    } else if (manual) {
      vscode.window.showInformationMessage(`Effort Picker is already applied to Claude Code ${version}.`);
    }
  } catch (err) {
    if (!manual && state.get(WARNED_KEY) === version) return;
    state.update(WARNED_KEY, version);
    vscode.window.showWarningMessage(`Effort Picker could not patch Claude Code ${version}: ${err.message}`);
  }
}

function activate(context) {
  state = context.globalState;
  // Claude Code updates install into a new version folder, so re-check whenever extensions change.
  const autoApply = () => {
    const ext = vscode.extensions.getExtension(CLAUDE_ID);
    if (ext && ext.extensionPath !== handledPath && !context.globalState.get(REMOVED_KEY)) apply(ext, false);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeEffortPicker.apply', async () => {
      const ext = getClaude(true);
      if (!ext) return;
      await context.globalState.update(REMOVED_KEY, false);
      apply(ext, true);
    }),
    vscode.commands.registerCommand('claudeEffortPicker.remove', async () => {
      const ext = getClaude(true);
      if (!ext) return;
      await context.globalState.update(REMOVED_KEY, true);
      try {
        if (unpatchDir(ext.extensionPath).changed) {
          offerReload(`Effort Picker removed from Claude Code ${ext.packageJSON.version}. Reload the window to get the original pill back.`);
        } else {
          vscode.window.showInformationMessage('Effort Picker was not applied to Claude Code, nothing to remove.');
        }
      } catch (err) {
        vscode.window.showWarningMessage(`Effort Picker could not restore Claude Code: ${err.message}`);
      }
    }),
    vscode.extensions.onDidChange(autoApply),
  );

  autoApply();
}

module.exports = { activate };
