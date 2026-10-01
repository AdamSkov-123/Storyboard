/* Storyboard Maker — app startup, top bar, file menu, drag & drop, keyboard shortcuts. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const A = (SB.app = {});

  const $ = (id) => document.getElementById(id);
  const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
  const isImageFile = (f) => (f.type && f.type.startsWith('image/')) || IMAGE_EXT.test(f.name || '');
  const isProjectFile = (f) => /\.storyboard$/i.test(f.name || '');

  let fileHandle = null;

  /* ---------- Adding images ---------- */

  A.addImages = async function (files) {
    if (!files) files = await U.pickFiles({ accept: 'image/*', multiple: true });
    files = Array.from(files || []).filter(isImageFile);
    if (!files.length) return;
    files.sort((a, b) => U.naturalCompare(a.name || '', b.name || ''));
    const progress = files.length > 2 ? U.toast(`Adding ${files.length} images…`, { duration: 0 }) : null;
    const ids = [];
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      try {
        ids.push(await S.addImageFile(files[i]));
      } catch (e) {
        failed.push(files[i].name);
      }
      if (progress) progress.update(`Adding images… ${i + 1} of ${files.length}`);
    }
    if (progress) progress.close();
    let firstNew = null;
    if (ids.length) {
      S.update((p) => {
        const frames = ids.map((id) => S.newFrame(id));
        firstNew = frames[0].id;
        p.frames.push(...frames);
      }, null);
      U.toast(`Added ${ids.length} frame${ids.length === 1 ? '' : 's'}`);
      requestAnimationFrame(() => SB.board.scrollToFrame(firstNew));
    }
    if (failed.length) {
      const what = failed.length === 1 ? `“${failed[0]}”` : `${failed.length} files`;
      U.toast(`Couldn't read ${what}. Please use JPG, PNG or WebP images (iPhone HEIC photos need converting first).`, { type: 'error', duration: 9000 });
    }
  };

  A.addBlankFrame = function () {
    const f = S.newFrame(null);
    S.update((p) => p.frames.push(f), null);
    requestAnimationFrame(() => SB.board.scrollToFrame(f.id));
  };

  /* ---------- Project files ---------- */

  const pickerTypes = [{ description: 'Storyboard project', accept: { 'application/octet-stream': ['.storyboard'] } }];

  A.saveProject = async function (saveAs) {
    const name = U.safeFilename(S.project.title, 'storyboard') + '.storyboard';
    const progress = U.toast('Saving project…', { duration: 0 });
    try {
      const blob = await S.buildProjectFile();
      let savedTo = null;
      if (window.showSaveFilePicker && window.self === window.top) {
        try {
          if (!fileHandle || saveAs) fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes });
          const w = await fileHandle.createWritable();
          await w.write(blob);
          await w.close();
          savedTo = fileHandle.name;
        } catch (e) {
          if (e.name === 'AbortError') {
            progress.close();
            return false;
          }
          console.warn('File picker unavailable, downloading instead', e);
          fileHandle = null;
          U.downloadBlob(blob, name);
        }
      } else {
        U.downloadBlob(blob, name);
      }
      progress.close();
      U.toast(savedTo ? `Saved to ${savedTo}` : `Downloaded ${name}`);
      return true;
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast('Could not save the project: ' + e.message, { type: 'error', duration: 8000 });
      return false;
    }
  };

  async function confirmReplace(title) {
    if (!S.project.frames.length && !S.project.title) return true;
    const r = await U.choose({
      title,
      message: 'This replaces the storyboard that is open now. Save it as a project file first if you want to keep it.',
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'save', label: 'Save first…' },
        { id: 'go', label: 'Continue', kind: 'danger' },
      ],
    });
    if (r === 'save') return A.saveProject(false);
    return r === 'go';
  }

  A.openProject = async function (file) {
    let handle = null;
    if (!file) {
      if (window.showOpenFilePicker && window.self === window.top) {
        try {
          [handle] = await window.showOpenFilePicker({ types: pickerTypes });
          file = await handle.getFile();
        } catch (e) {
          if (e.name === 'AbortError') return;
          [file] = await U.pickFiles({ accept: '.storyboard' });
        }
      } else {
        [file] = await U.pickFiles({ accept: '.storyboard' });
      }
    }
    if (!file) return;
    if (!(await confirmReplace('Open this project?'))) return;
    const progress = U.toast('Opening project…', { duration: 0 });
    try {
      const data = await S.readProjectFile(file);
      await S.loadProject(data);
      fileHandle = handle;
      progress.close();
      U.toast(`Opened “${S.project.title || file.name}”`);
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast(e.message || 'Could not open this file.', { type: 'error', duration: 8000 });
    }
  };

  A.newProject = async function () {
    if (!(await confirmReplace('Start a new storyboard?'))) return;
    await S.resetProject();
    fileHandle = null;
    U.toast('New storyboard started');
  };

  /* ---------- Top bar ---------- */

  function syncTopbar() {
    const p = S.project;
    const title = $('project-title');
    if (document.activeElement !== title) title.value = p.title;
    $('aspect-select').value = p.aspect;
    $('undo-btn').disabled = !S.canUndo();
    $('redo-btn').disabled = !S.canRedo();
    document.title = (p.title ? p.title + ' – ' : '') + 'Storyboard Maker';
  }

  function showSaveState(state) {
    const el = $('save-status');
    const text = { saving: 'Saving…', saved: 'All changes saved in this browser', error: 'Autosave failed', off: 'Autosave unavailable' }[state] || '';
    el.textContent = state === 'saved' ? 'Saved' : text;
    el.title = text;
    el.dataset.state = state;
  }

  function initTopbar() {
    const sel = $('aspect-select');
    for (const a of S.ASPECTS) sel.append(U.h('option', { value: a.id, text: a.label }));
    sel.addEventListener('change', () => S.update((p) => (p.aspect = sel.value), null));

    const title = $('project-title');
    title.addEventListener('input', () => S.update((p) => (p.title = title.value), 'title', { source: 'topbar' }));
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') title.blur();
    });

    $('undo-btn').addEventListener('click', () => S.undo());
    $('redo-btn').addEventListener('click', () => S.redo());
    $('add-images-btn').addEventListener('click', () => A.addImages());
    $('add-blank-btn').addEventListener('click', A.addBlankFrame);
    $('cover-btn').addEventListener('click', () => SB.cover.open());
    $('fields-btn').addEventListener('click', () => SB.fieldsManager.open());
    $('export-btn').addEventListener('click', () => SB.pdf.open());
    $('share-btn').addEventListener('click', () => SB.share.open());
    $('feedback-btn').addEventListener('click', () => SB.feedback.toggle());

    const size = $('card-size');
    const applySize = (v) => document.documentElement.style.setProperty('--card-w', v + 'px');
    size.value = String(U.storage.get('sb-card-size', 280));
    applySize(size.value);
    size.addEventListener('input', () => {
      applySize(size.value);
      U.storage.set('sb-card-size', +size.value);
    });

    // File menu
    const btn = $('file-btn');
    const menu = $('file-menu');
    const close = () => {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
      if (!menu.hidden) menu.querySelector('button').focus();
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target)) close();
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
        btn.focus();
      }
    });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-file]');
      if (!item) return;
      close();
      const act = item.dataset.file;
      if (act === 'new') A.newProject();
      else if (act === 'open') A.openProject();
      else if (act === 'save') A.saveProject(false);
      else if (act === 'saveas') A.saveProject(true);
    });
    U.$$('[data-shortcut]').forEach((k) => (k.textContent = (U.isMac ? '⌘' : 'Ctrl+') + k.dataset.shortcut));
  }

  /* ---------- Drag & drop, paste ---------- */

  function initDragDrop() {
    const overlay = $('drop-overlay');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const modalOpen = () => !!document.querySelector('dialog[open]');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e) || modalOpen()) return;
      depth++;
      overlay.hidden = false;
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) overlay.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = modalOpen() ? 'none' : 'copy';
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      if (modalOpen()) return;
      const files = Array.from(e.dataTransfer.files || []);
      const project = files.find(isProjectFile);
      if (project) A.openProject(project);
      else A.addImages(files);
    });
    document.addEventListener('paste', (e) => {
      if (U.isTyping() || modalOpen()) return;
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(isImageFile);
      if (files.length) {
        e.preventDefault();
        A.addImages(files);
      }
    });
  }

  /* ---------- Keyboard ---------- */

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!U.mod(e)) return;
      const key = e.key.toLowerCase();
      const modalOpen = !!document.querySelector('dialog[open]');
      if (key === 's') {
        e.preventDefault();
        A.saveProject(e.shiftKey);
      } else if (key === 'o' && !modalOpen) {
        e.preventDefault();
        A.openProject();
      } else if (key === 'z' && !U.isTyping()) {
        e.preventDefault();
        if (e.shiftKey) S.redo();
        else S.undo();
      } else if (key === 'y' && !U.isTyping()) {
        e.preventDefault();
        S.redo();
      }
    });
  }

  /* ---------- Startup ---------- */

  async function start() {
    U.hydrateIcons(document);
    initTopbar();
    S.onSaveState(showSaveState);
    await S.init();
    SB.board.init();
    SB.editor.init();
    SB.cover.init();
    SB.fieldsManager.init();
    SB.pdf.init();
    SB.share.init();
    SB.feedback.init();
    initDragDrop();
    initKeyboard();
    S.subscribe(syncTopbar);
    syncTopbar();
    showSaveState(S.saveState);
    SB.board.render();
    if (!S.persistent) {
      U.toast('Autosave isn’t available in this browser, so use File → Save project to keep your work.', { type: 'error', duration: 10000 });
    }
    const flush = () => S.flushSave();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
    window.addEventListener('beforeunload', (e) => {
      flush();
      if (!S.persistent && S.project.frames.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.SB);
