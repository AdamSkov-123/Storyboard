/* Storyboard Maker — shared helpers (used by the editor app and the client review page). */
window.SB = window.SB || {};
(function (SB) {
  'use strict';
  const U = (SB.util = {});

  U.uid = function (prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.randomKey = function (bytes) {
    const a = new Uint8Array(bytes || 16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  };

  U.sha256Hex = async function (str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  };

  U.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  U.debounce = function (fn, ms) {
    let t = null;
    let args = null;
    function run() {
      t = null;
      fn(...args);
    }
    function d(...a) {
      args = a;
      clearTimeout(t);
      t = setTimeout(run, ms);
    }
    d.flush = () => {
      if (t) {
        clearTimeout(t);
        run();
      }
    };
    d.cancel = () => {
      clearTimeout(t);
      t = null;
    };
    return d;
  };

  U.naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Tiny hyperscript: h('div', {class: 'x', onclick: fn}, child, 'text') */
  U.h = function (tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : String(c));
    }
    return el;
  };

  U.isTyping = function (el) {
    el = el || document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
    return tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color', 'file', 'submit'].includes(el.type);
  };

  U.isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  U.mod = (e) => (U.isMac ? e.metaKey : e.ctrlKey);

  U.safeFilename = (s, fallback) =>
    String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || fallback;

  U.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = U.h('a', { href: url, download: filename, style: 'display:none' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  U.pickFiles = function (opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const input = U.h('input', { type: 'file', accept: opts.accept || '', multiple: !!opts.multiple, style: 'display:none' });
      let done = false;
      const finish = (files) => {
        if (done) return;
        done = true;
        input.remove();
        resolve(files);
      };
      input.addEventListener('change', () => finish(Array.from(input.files || [])));
      input.addEventListener('cancel', () => finish([]));
      document.body.append(input);
      input.click();
    });
  };

  U.loadScript = function (src) {
    U._scripts = U._scripts || {};
    if (!U._scripts[src]) {
      U._scripts[src] = new Promise((resolve, reject) => {
        const s = U.h('script', { src });
        s.onload = () => resolve();
        s.onerror = () => {
          delete U._scripts[src];
          reject(new Error('Could not load ' + src));
        };
        document.head.append(s);
      });
    }
    return U._scripts[src];
  };

  U.copyText = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = U.h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  };

  U.autoGrow = function (ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  };

  U.storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable; ignore */
      }
    },
  };

  /* ---------- Time formatting ---------- */

  U.toDate = function (t) {
    if (!t) return null;
    if (t instanceof Date) return t;
    if (typeof t.toDate === 'function') return t.toDate();
    if (typeof t === 'number') return new Date(t);
    if (typeof t.seconds === 'number') return new Date(t.seconds * 1000);
    return null;
  };

  U.timeAgo = function (t) {
    const d = U.toDate(t);
    if (!d) return 'just now';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(h / 24);
    if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };

  U.fullTime = function (t) {
    const d = U.toDate(t);
    return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  };

  U.initials = function (name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };

  U.avatarColor = function (name) {
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 55% 45%)`;
  };

  /* ---------- Word-level diff for suggested text edits ---------- */

  /** Returns [{type: 'same'|'del'|'ins', text}] */
  U.diffWords = function (a, b) {
    const ta = String(a || '').match(/\s+|[^\s]+/g) || [];
    const tb = String(b || '').match(/\s+|[^\s]+/g) || [];
    if (ta.length * tb.length > 400000) {
      return [
        { type: 'del', text: a },
        { type: 'ins', text: b },
      ].filter((p) => p.text);
    }
    const n = ta.length;
    const m = tb.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    const push = (type, text) => {
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += text;
      else out.push({ type, text });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ta[i] === tb[j]) {
        push('same', ta[i]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        push('del', ta[i++]);
      } else {
        push('ins', tb[j++]);
      }
    }
    while (i < n) push('del', ta[i++]);
    while (j < m) push('ins', tb[j++]);
    return out;
  };

  U.renderDiff = function (a, b) {
    const wrap = U.h('div', { class: 'diff' });
    for (const part of U.diffWords(a, b)) {
      if (part.type === 'same') wrap.append(part.text);
      else wrap.append(U.h(part.type === 'del' ? 'del' : 'ins', { text: part.text }));
    }
    return wrap;
  };

  /* ---------- Icons (Lucide-style, MIT) ---------- */

  const ICONS = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/>',
    flip: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7z"/><path d="m16 7 5 5-5 5V7z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    arrow: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    reply: '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    'view-single': '<g fill="currentColor" stroke="none"><rect x="3" y="3.5" width="18" height="12.5" rx="2"/><circle cx="8.5" cy="20" r="1.3"/><circle cx="12" cy="20" r="1.3"/><circle cx="15.5" cy="20" r="1.3"/></g>',
    'view-cols1': '<g fill="currentColor" stroke="none"><rect x="3" y="4" width="18" height="7.2" rx="1.5"/><rect x="3" y="12.8" width="18" height="7.2" rx="1.5"/></g>',
    'view-cols2': '<g fill="currentColor" stroke="none"><rect x="3" y="4" width="8.2" height="7.2" rx="1.3"/><rect x="12.8" y="4" width="8.2" height="7.2" rx="1.3"/><rect x="3" y="12.8" width="8.2" height="7.2" rx="1.3"/><rect x="12.8" y="12.8" width="8.2" height="7.2" rx="1.3"/></g>',
    'view-cols3': '<g fill="currentColor" stroke="none"><rect x="2" y="5" width="5.6" height="6.2" rx="1"/><rect x="9.2" y="5" width="5.6" height="6.2" rx="1"/><rect x="16.4" y="5" width="5.6" height="6.2" rx="1"/><rect x="2" y="12.8" width="5.6" height="6.2" rx="1"/><rect x="9.2" y="12.8" width="5.6" height="6.2" rx="1"/><rect x="16.4" y="12.8" width="5.6" height="6.2" rx="1"/></g>',
    'view-cols4': '<g fill="currentColor" stroke="none"><rect x="1.5" y="6" width="4.4" height="5" rx=".8"/><rect x="7.2" y="6" width="4.4" height="5" rx=".8"/><rect x="12.9" y="6" width="4.4" height="5" rx=".8"/><rect x="18.6" y="6" width="4.4" height="5" rx=".8"/><rect x="1.5" y="12.6" width="4.4" height="5" rx=".8"/><rect x="7.2" y="12.6" width="4.4" height="5" rx=".8"/><rect x="12.9" y="12.6" width="4.4" height="5" rx=".8"/><rect x="18.6" y="12.6" width="4.4" height="5" rx=".8"/></g>',
    logo: '<rect x="2" y="4" width="9" height="7" rx="1.5"/><rect x="13" y="4" width="9" height="7" rx="1.5"/><rect x="2" y="13" width="9" height="7" rx="1.5"/><path d="M14 15h7M14 18h5"/>',
  };

  U.icon = function (name, size) {
    const s = size || 18;
    return `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  };

  U.iconEl = function (name, size) {
    const span = document.createElement('span');
    span.className = 'icon-wrap';
    span.innerHTML = U.icon(name, size);
    return span.firstChild;
  };

  U.hydrateIcons = function (root) {
    U.$$('[data-icon]', root).forEach((el) => {
      if (!el.querySelector('svg.icon')) el.insertAdjacentHTML('afterbegin', U.icon(el.dataset.icon, +el.dataset.iconSize || 18));
    });
  };

  /* ---------- Toasts ---------- */

  U.toast = function (message, opts) {
    opts = opts || {};
    let host = document.getElementById('toasts');
    if (!host) {
      host = U.h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
      document.body.append(host);
    }
    const msg = U.h('span', { class: 'toast-msg', text: message });
    const el = U.h('div', { class: 'toast' + (opts.type ? ' toast-' + opts.type : ''), role: opts.type === 'error' ? 'alert' : 'status' }, msg);
    let timer = null;
    const close = () => {
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 180);
    };
    if (opts.action) {
      el.append(
        U.h('button', {
          class: 'toast-action',
          type: 'button',
          text: opts.action,
          onclick: () => {
            close();
            if (opts.onAction) opts.onAction();
          },
        })
      );
    }
    el.append(U.h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', html: U.icon('x', 14), onclick: close }));
    // Toasts must render above an open modal <dialog>, which lives in the top layer.
    const topDialog = U.$$('dialog[open]').pop();
    (topDialog || document.body).append(host);
    host.append(el);
    const duration = opts.duration == null ? 4000 : opts.duration;
    if (duration > 0) timer = setTimeout(close, duration);
    return {
      close,
      update(text) {
        msg.textContent = text;
      },
    };
  };

  /* ---------- Modal choice dialog ---------- */

  /** buttons: [{id, label, kind: 'primary'|'danger'|undefined}] → resolves with the id, or null if dismissed */
  U.choose = function (opts) {
    return new Promise((resolve) => {
      const dlg = U.h('dialog', { class: 'modal modal-sm' });
      let result = null;
      const footer = U.h('div', { class: 'modal-foot' });
      for (const b of opts.buttons) {
        footer.append(
          U.h('button', {
            type: 'button',
            class: 'btn ' + (b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger' : 'btn-ghost'),
            text: b.label,
            onclick: () => {
              result = b.id;
              dlg.close();
            },
          })
        );
      }
      const body = U.h('div', { class: 'modal-body' }, U.h('p', { class: 'modal-text', text: opts.message || '' }));
      if (opts.input) {
        const inp = U.h('input', { type: 'text', class: 'input', value: opts.input.value || '', placeholder: opts.input.placeholder || '', maxlength: opts.input.maxlength || 200 });
        body.append(inp);
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            result = { id: 'ok', value: inp.value };
            dlg.close();
          }
        });
        dlg._input = inp;
      }
      dlg.append(U.h('div', { class: 'modal-head' }, U.h('h2', { text: opts.title })), body, footer);
      dlg.addEventListener('close', () => {
        dlg.remove();
        if (opts.input) {
          if (result && typeof result === 'object') resolve(result);
          else resolve(result ? { id: result, value: dlg._input.value } : null);
        } else resolve(result);
      });
      document.body.append(dlg);
      dlg.showModal();
      if (dlg._input) {
        dlg._input.focus();
        dlg._input.select();
      } else {
        const primary = footer.querySelector('.btn-primary, .btn-danger');
        if (primary) primary.focus();
      }
    });
  };

  U.confirm = function (title, message, okLabel, danger) {
    return U.choose({
      title,
      message,
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: okLabel || 'OK', kind: danger ? 'danger' : 'primary' },
      ],
    }).then((r) => r === 'ok');
  };
})(window.SB);
