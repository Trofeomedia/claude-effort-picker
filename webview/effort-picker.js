/*
 * Effort Picker for Claude Code. Unofficial community add-on, not affiliated with Anthropic.
 * Appended to Claude Code's webview bundle by the claude-effort-picker extension. Splits the
 * "Opus 5.5 Medium" model pill into the model pill plus a separate effort button with a menu.
 * Fails safe: if Claude Code's internals don't look as expected, the stock UI stays untouched.
 * The leading semicolon keeps this from being parsed as a call on the bundle's last expression.
 */
;(function () {
  'use strict';
  const TAG = '[claude-effort-picker]';
  const warned = new Set();
  function warn(msg, err) {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn(TAG, msg, err === undefined ? '' : err);
  }

  try {
    if (!document.body || !document.head) {
      warn('No document body; leaving Claude Code untouched.');
      return;
    }

    // Claude Code's own labels; undefined means "Auto".
    const LABELS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
    function labelOf(level) {
      if (!level) return 'Auto';
      const s = String(level);
      return Object.hasOwn(LABELS, s) ? LABELS[s] : s.charAt(0).toUpperCase() + s.slice(1);
    }

    const style = document.createElement('style');
    style.id = 'ccep-style';
    style.textContent = `
html.ccep-on [class*="modelPillEffort_"] { display: none; }
.ccep-effort { white-space: nowrap; }
[class*="modelPillRow_"] > .ccep-effort { margin-left: 6px; flex-shrink: 0; }
.ccep-menu {
  position: fixed; z-index: 2147483647; box-sizing: border-box;
  min-width: 120px; max-height: calc(100vh - 8px); overflow-y: auto;
  padding: 4px; border-radius: 6px; user-select: none;
  background: var(--vscode-menu-background, var(--vscode-editorWidget-background, Canvas));
  color: var(--vscode-menu-foreground, var(--vscode-foreground, CanvasText));
  border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
  font-family: var(--vscode-font-family, inherit);
  font-size: var(--vscode-font-size, 13px);
}
.ccep-option {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 12px 2px 4px; border-radius: 4px;
  line-height: 22px; white-space: nowrap; cursor: pointer;
}
.ccep-option.ccep-active {
  background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground, Highlight));
  color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, HighlightText));
}
.ccep-check { display: inline-block; width: 16px; text-align: center; }
`;
    document.head.appendChild(style);

    // The sessions manager is a prop of the app root component and never changes, so cache it.
    let sessions = null;
    function findSessions() {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const container = key ? root[key] : null;
      const stack = container && container.stateNode && container.stateNode.current ? [container.stateNode.current] : [];
      for (let seen = 0; stack.length && seen < 200; seen++) {
        const fiber = stack.pop();
        const props = fiber.memoizedProps;
        if (props && typeof props === 'object') {
          for (const k of Object.keys(props)) {
            const v = props[k];
            const signal = v && typeof v === 'object' ? v.activeSession : undefined;
            if (signal && typeof signal === 'object' && 'value' in signal) return v;
          }
        }
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
      return null;
    }

    // Mirrors Claude Code's own model lookup. Returns null when the effort button should not show.
    function readState() {
      sessions = sessions || findSessions();
      if (!sessions) {
        warn('Claude Code session state not found; leaving the stock pill.');
        return null;
      }
      const session = sessions.activeSession.value;
      if (!session) return null;
      if (!session.effortLevel || !session.claudeConfig || typeof session.setEffortLevel !== 'function') {
        warn('Unexpected Claude Code session shape; leaving the stock pill.');
        return null;
      }
      const cfg = session.claudeConfig.value;
      const models = [...(cfg?.models ?? []), ...(cfg?.unavailable_models ?? [])];
      const m = session.modelSelection?.value;
      const sel = !m || m === 'default' ? 'default' : m;
      const info = models.find((x) => x.value === sel) ?? models.find((x) => x.value !== 'default' && x.resolvedModel === sel);
      if (!info?.supportsEffort) return null;
      return { level: session.effortLevel.value, levels: info.supportedEffortLevels ?? ['low', 'medium', 'high'] };
    }

    let pill = null;
    let btn = null;
    let menu = null;
    let menuLevels = [];
    let active = 0;

    function makeButton() {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'combobox');
      b.setAttribute('aria-haspopup', 'listbox');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', () => (menu ? closeMenu(true) : openMenu()));
      b.addEventListener('keydown', onButtonKey);
      // No close-on-blur: Claude re-lays out its footer whenever effort or model changes, which
      // briefly detaches the button and blurs it. Outside click, Escape, Tab and picking close it.
      return b;
    }

    // Cheap on purpose: runs once per animation frame while the DOM changes (e.g. during streaming).
    // Every write is guarded so our own mutations settle after one extra pass.
    function sync() {
      if (!pill || !pill.isConnected) {
        const label = document.querySelector('[class*="modelPillLabel_"]');
        pill = label ? label.closest('button') : null;
      }
      const state = pill ? readState() : null;
      if (!state) return off();
      if (!btn) btn = makeButton();
      const cls = pill.className + ' ccep-effort';
      if (btn.className !== cls) btn.className = cls;
      if (pill.nextSibling !== btn) pill.after(btn);
      const text = labelOf(state.level);
      if (btn.textContent !== text) {
        btn.textContent = text;
        btn.title = 'Effort: ' + text;
        btn.setAttribute('aria-label', 'Effort: ' + text);
      }
      document.documentElement.classList.add('ccep-on');
      if (menu) place();
    }

    // Back to the stock UI.
    function off() {
      closeMenu(false);
      if (btn && btn.isConnected) btn.remove();
      document.documentElement.classList.remove('ccep-on');
    }

    function openMenu() {
      const state = readState();
      if (!state || menu || !btn) return;
      menuLevels = state.levels;
      menu = document.createElement('div');
      menu.id = 'ccep-menu';
      menu.className = 'ccep-menu';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', 'Effort');
      menuLevels.forEach((level, i) => {
        const opt = document.createElement('div');
        opt.id = 'ccep-opt-' + i;
        opt.className = 'ccep-option';
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', String(level === state.level));
        const check = document.createElement('span');
        check.className = 'ccep-check';
        check.textContent = level === state.level ? String.fromCharCode(0x2713) : ''; // check mark, kept ASCII-safe
        opt.append(check, labelOf(level));
        opt.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the button
        opt.addEventListener('click', () => pick(level));
        opt.addEventListener('mousemove', () => setActive(i));
        menu.append(opt);
      });
      document.body.append(menu);
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-controls', menu.id);
      setActive(Math.max(0, menuLevels.indexOf(state.level)));
      place();
      document.addEventListener('mousedown', onOutside, true);
      window.addEventListener('keydown', onMenuKey, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      btn.focus();
    }

    function closeMenu(focusButton) {
      if (!menu) return;
      const m = menu;
      menu = null;
      m.remove();
      document.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('keydown', onMenuKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      if (!btn) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-controls');
      btn.removeAttribute('aria-activedescendant');
      if (focusButton && btn.isConnected) btn.focus();
    }

    // Read the session fresh at click time: the user may have switched sessions since the menu opened.
    function pick(level) {
      closeMenu(true);
      const session = sessions && sessions.activeSession.value;
      if (!session || typeof session.setEffortLevel !== 'function') return;
      Promise.resolve()
        .then(() => session.setEffortLevel(level))
        .catch((err) => console.warn(TAG, 'setEffortLevel failed', err));
    }

    function setActive(i) {
      if (!menu) return;
      active = i;
      const opts = menu.children;
      for (let j = 0; j < opts.length; j++) opts[j].classList.toggle('ccep-active', j === i);
      if (opts[i]) btn.setAttribute('aria-activedescendant', opts[i].id);
    }

    // Opens above the button (the footer sits at the bottom), clamped into the viewport.
    function place() {
      // While Claude re-lays out the footer the button is briefly detached; sync() puts it back and re-places.
      if (!menu || !btn || !btn.isConnected) return;
      const r = btn.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      let top = r.top - menu.offsetHeight - 4;
      if (top < 4) top = Math.min(r.bottom + 4, vh - menu.offsetHeight - 4);
      const left = Math.min(r.left, vw - menu.offsetWidth - 4);
      menu.style.top = Math.max(4, top) + 'px';
      menu.style.left = Math.max(4, left) + 'px';
    }

    function onOutside(e) {
      if (menu && !menu.contains(e.target) && !(btn && btn.contains(e.target))) closeMenu(false);
    }

    // Enter and Space open the menu through the native button click; the arrows open it here.
    function onButtonKey(e) {
      if (menu || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      openMenu();
    }

    // While open, the menu owns the keyboard wherever focus is: a footer re-layout moves focus to the
    // chat input, and Enter there must pick a level, not send the message.
    function onMenuKey(e) {
      const k = e.key;
      if (k === 'ArrowDown') {
        setActive((active + 1) % menuLevels.length);
      } else if (k === 'ArrowUp') {
        setActive((active + menuLevels.length - 1) % menuLevels.length);
      } else if (k === 'Enter' || (k === ' ' && document.activeElement === btn)) {
        pick(menuLevels[active]);
      } else if (k === 'Escape') {
        closeMenu(true); // preventDefault below also stops Claude Code's Escape-to-interrupt
      } else {
        if (k === 'Tab') closeMenu(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    }

    let queued = false;
    let dead = false;
    const observer = new MutationObserver(schedule);
    function schedule() {
      if (queued || dead) return;
      queued = true;
      requestAnimationFrame(run);
    }
    function run() {
      queued = false;
      if (dead) return;
      try {
        sync();
      } catch (err) {
        dead = true;
        observer.disconnect();
        try { off(); } catch (_) { /* best effort, the warning below still fires */ }
        warn('Disabled after an unexpected error; the stock pill is back.', err);
      }
    }

    // React re-renders the pill whenever effort, model or the active session changes, so watching
    // the DOM catches all of them without touching Claude Code's code.
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
  } catch (err) {
    warn('Failed to start; leaving Claude Code untouched.', err);
  }
})();
