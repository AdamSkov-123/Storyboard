/* Storyboard Maker — app startup, navigation (home ↔ storyboard), file menu, drag & drop, shortcuts. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const A = (SB.app = {});

  const $ = (id) => document.getElementById(id);
  const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
  const isImageFile = (f) => (f.type && f.type.startsWith('image/')) || IMAGE_EXT.test(f.name || '');
  const isProjectFile = (f) => /\.storyboard$/i.test(f.name || '');

  let fileHandle = null; // where "Save project" writes for the open storyboard (Chrome/Edge)

  /* ---------- Navigation: #home or #p=<id> ---------- */

  const routeId = () => {
    const m = /^#p=([A-Za-z0-9_-]+)$/.exec(location.hash);
    return m ? m[1] : null;
  };

  /** Open a storyboard by id, or the home page with null. Uses the URL hash so Back works. Resolves when done. */
  let expectedHash = null;
  A.go = function (id) {
    const hash = id ? '#p=' + id : '#home';
    if (location.hash !== hash) {
      expectedHash = hash;
      location.hash = hash;
    }
    return route();
  };
  function onHashChange() {
    if (location.hash === expectedHash) {
      expectedHash = null; // our own navigation; already handled
      return;
    }
    expectedHash = null;
    route();
  }
  A.goHome = () => A.go(null);
  A.isHome = () => !$('home-view').hidden;

  let routing = Promise.resolve();
  function route() {
    routing = routing.then(doRoute).catch((e) => console.error(e));
    return routing;
  }

  function closeOverlays() {
    U.$$('dialog[open]').forEach((d) => d.close());
    SB.feedback.close();
    $('file-menu').hidden = true;
  }

  async function doRoute() {
    const id = routeId();
    closeOverlays();
    // Leaving a team storyboard: finish saving and unlock it first.
    if (SB.team.sessionId() && SB.team.sessionId() !== id) {
      const leaving = SB.team.sessionId();
      const discard = SB.team.createdHere() && isEmptyProject(S.project);
      await SB.team.close();
      if (discard) {
        await S.closeProject();
        await SB.team.deleteBoard(leaving, { silent: true });
      }
    }
    if (id && SB.team.isTeamBoard(id)) {
      if (SB.team.sessionId() !== id) {
        fileHandle = null;
        $('home-view').hidden = true;
        $('editor-view').hidden = false;
        $('board').replaceChildren(U.h('div', { class: 'loading', text: 'Opening storyboard…' }));
        if (!(await SB.team.open(id))) {
          history.replaceState(null, '', '#home');
          return doRoute();
        }
        SB.share.adoptSettings(null, S.project.review);
      }
      $('home-view').hidden = true;
      $('editor-view').hidden = false;
      syncTopbar();
      SB.board.render();
      window.scrollTo(0, 0);
    } else if (id && S.hasProject(id) && !S.recordFor(id).team) {
      if (S.currentId !== id) {
        fileHandle = null;
        $('home-view').hidden = true;
        $('editor-view').hidden = false;
        $('board').replaceChildren(U.h('div', { class: 'loading', text: 'Opening storyboard…' }));
        await S.openProject(id);
        SB.share.adoptSettings(null, S.project.review);
      }
      $('home-view').hidden = true;
      $('editor-view').hidden = false;
      syncTopbar();
      SB.board.render();
      window.scrollTo(0, 0);
    } else {
      if (id) U.toast(S.hasProject(id) ? 'Sign in to open team storyboards.' : 'That storyboard isn’t in this browser.', { type: 'error' });
      if (S.currentId) {
        const leaving = S.currentId;
        const empty = isEmptyProject(S.project) && !(S.recordFor(leaving) || {}).team;
        await S.closeProject();
        if (empty) await S.deleteProject(leaving); // "New storyboard" clicked but nothing added
      }
      fileHandle = null;
      $('editor-view').hidden = true;
      $('home-view').hidden = false;
      SB.home.render();
    }
    $('drop-title').textContent = A.isHome() ? 'Drop images to start a new storyboard' : 'Drop images to add frames';
  }

  /* ---------- Storyboards ---------- */

  function isEmptyProject(p) {
    const c = p.cover || {};
    return !p.frames.length && !(p.title || '').trim() && !p.review && !c.imageId && ![c.client, c.company, c.date, c.version, c.description].some((v) => (v || '').trim());
  }

  A.newProject = async function (files) {
    let id;
    if (SB.team.isMember()) {
      // Signed in to a team: new storyboards are team storyboards.
      try {
        id = await SB.team.createBoard();
      } catch (e) {
        console.error(e);
        U.toast('Couldn’t create a team storyboard: ' + SB.team.explain(e), { type: 'error', duration: 9000 });
        return;
      }
    } else {
      id = await S.createProject();
    }
    await A.go(id);
    if (files && files.length && S.currentId === id) await A.addImages(files);
  };

  /* ---------- Adding images ---------- */

  A.addImages = async function (files) {
    if (S.readOnly && S.currentId) {
      U.toast('This storyboard is view-only right now.');
      return;
    }
    if (!files) files = await U.pickFiles({ accept: 'image/*', multiple: true });
    files = Array.from(files || []).filter(isImageFile);
    if (!files.length) return;
    if (!S.currentId) {
      await A.newProject(files);
      return;
    }
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
  const canPick = () => window.showSaveFilePicker && window.self === window.top;

  /** Write a storyboard to a .storyboard file. handle: an existing file handle to overwrite, if any. */
  async function writeProjectFile(projectId, name, handle, forcePick) {
    const blob = await S.buildProjectFile(SB.share.portableSettings(), projectId);
    if (canPick()) {
      try {
        if (!handle || forcePick) handle = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return { handle, savedTo: handle.name };
      } catch (e) {
        if (e.name === 'AbortError') return null;
        console.warn('File picker unavailable, downloading instead', e);
      }
    }
    U.downloadBlob(blob, name);
    return { handle: null, savedTo: null };
  }

  A.saveProject = async function (saveAs) {
    if (!S.currentId) return false;
    await S.flushSave();
    const name = U.safeFilename(S.project.title, 'storyboard') + '.storyboard';
    const progress = U.toast('Saving project file…', { duration: 0 });
    try {
      const out = await writeProjectFile(S.currentId, name, fileHandle, saveAs);
      progress.close();
      if (!out) return false;
      fileHandle = out.handle;
      U.toast(out.savedTo ? `Saved to ${out.savedTo}` : `Downloaded ${name}`);
      return true;
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast('Could not save the project file: ' + e.message, { type: 'error', duration: 8000 });
      return false;
    }
  };

  /** Save any storyboard in the library as a file (from the home page). */
  A.saveProjectFile = async function (id) {
    if (id === S.currentId) return A.saveProject(true);
    const r = S.listProjects().find((x) => x.id === id);
    if (!r) return false;
    const name = U.safeFilename(r.title, 'storyboard') + '.storyboard';
    const progress = U.toast('Saving project file…', { duration: 0 });
    try {
      const out = await writeProjectFile(id, name, null, true);
      progress.close();
      if (out) U.toast(out.savedTo ? `Saved to ${out.savedTo}` : `Downloaded ${name}`);
      return !!out;
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast('Could not save the project file: ' + e.message, { type: 'error', duration: 8000 });
      return false;
    }
  };

  /** Add a .storyboard file to your storyboards and open it. */
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
    const progress = U.toast('Opening project file…', { duration: 0 });
    let data;
    try {
      data = await S.readProjectFile(file);
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast(e.message || 'Could not open this file.', { type: 'error', duration: 8000 });
      return;
    }
    progress.close();
    let asCopy = false;
    if (S.hasProject(data.project.uid)) {
      const existing = S.listProjects().find((r) => r.id === data.project.uid);
      const r = await U.choose({
        title: 'You already have this storyboard',
        message: `“${existing.title || 'Untitled storyboard'}” (edited ${U.timeAgo(existing.updatedAt)}) is already in your storyboards. Replace it with the version in this file, or keep both?`,
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'copy', label: 'Keep both' },
          { id: 'replace', label: 'Replace', kind: 'primary' },
        ],
      });
      if (!r || r === 'cancel') return;
      asCopy = r === 'copy';
    }
    try {
      const id = await S.importProject(data, asCopy);
      if (SB.share.adoptSettings(data.settings, S.project.review)) {
        U.toast('Client link settings came with this project, so this browser is ready to create client links.', { duration: 7000 });
      }
      await A.go(id);
      fileHandle = asCopy ? null : handle;
      U.toast(`Opened “${S.project.title || file.name}”`);
    } catch (e) {
      console.error(e);
      U.toast('Could not open this project: ' + e.message, { type: 'error', duration: 8000 });
    }
  };

  /* ---------- Top bar ---------- */

  function syncTopbar() {
    if (!S.currentId) return;
    const p = S.project;
    const title = $('project-title');
    if (document.activeElement !== title) title.value = p.title;
    $('aspect-select').value = p.aspect;
    $('undo-btn').disabled = !S.canUndo();
    $('redo-btn').disabled = !S.canRedo();
    document.title = (p.title ? p.title + ' – ' : '') + 'Storyboard Maker';
  }

  /** Team storyboards: show whether changes have reached the team. */
  A.showCloudState = function (state) {
    if (!state) {
      showSaveState(S.saveState);
      return;
    }
    const el = $('save-status');
    const text = { saving: 'Saving to team…', saved: 'Saved to team', offline: 'Offline: changes will reach the team when you reconnect', error: 'Couldn’t save to team; retrying…', viewing: 'View only: someone else can edit this storyboard right now' }[state] || '';
    el.textContent = { saved: 'Saved to team', saving: 'Saving…', offline: 'Offline', viewing: 'View only' }[state] || 'Not saved to team';
    el.title = text;
    el.dataset.state = state === 'saved' || state === 'saving' || state === 'viewing' ? 'saved' : 'error';
  };

  function showSaveState(state) {
    if (SB.team && SB.team.sessionId() && SB.team.cloudState) return;
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

    $('home-btn').addEventListener('click', A.goHome);
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
      if (act === 'home') A.goHome();
      else if (act === 'new') A.newProject();
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
        if (S.currentId) A.saveProject(e.shiftKey);
      } else if (key === 'o' && !modalOpen) {
        e.preventDefault();
        A.openProject();
      } else if (key === 'z' && !U.isTyping() && S.currentId) {
        e.preventDefault();
        if (e.shiftKey) S.redo();
        else S.undo();
      } else if (key === 'y' && !U.isTyping() && S.currentId) {
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
    SB.home.init();
    initDragDrop();
    initKeyboard();
    S.subscribe(syncTopbar);
    S.subscribe((meta) => {
      if (meta.readOnly) document.body.classList.toggle('is-readonly', S.readOnly);
    });
    SB.team.subscribe(() => {
      if (A.isHome()) SB.home.render();
    });
    // A team link (#team=1&p=…) connects this browser to the team's Firebase project.
    const join = SB.share.readTeamLink(location.hash);
    if (join) {
      history.replaceState(null, '', location.href.split('#')[0] + '#home');
      if (join.status === 'invalid') U.toast('That team link is incomplete. Ask a teammate to copy it again.', { type: 'error' });
      if (join.status === 'different') {
        const ok = await U.confirm(
          'Switch to this team?',
          `This browser is connected to another Firebase project (“${join.current.projectId}”). Switch to “${join.cfg.projectId}”? Storyboards on this computer stay, and client links you’ve already sent keep working.`,
          'Switch'
        );
        if (ok) {
          for (const r of S.listProjects()) if (r.team) await S.forgetProject(r.id);
          S.gcImages();
          SB.share.useTeamCfg(join.cfg);
        }
      }
    }
    // Team sign-in status (don't hold up the app for long if offline).
    await Promise.race([SB.team.init().then(() => SB.team.ready), new Promise((r) => setTimeout(r, 6000))]);
    if (join && join.cfg && SB.team.status === 'signed-out') U.toast('Connected to your team. Sign in with Google to see its storyboards.', { duration: 8000 });
    showSaveState(S.saveState);
    window.addEventListener('hashchange', onHashChange);
    await route();
    if (!S.persistent) {
      U.toast('This browser can’t store storyboards, so use File → Save project to keep your work.', { type: 'error', duration: 10000 });
    }
    const flush = () => S.flushSave();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
    window.addEventListener('beforeunload', (e) => {
      flush();
      if (!S.persistent && S.listProjects().length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.SB);
