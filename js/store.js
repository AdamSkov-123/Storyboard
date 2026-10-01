/* Storyboard Maker — project state, undo history, images, autosave (IndexedDB) and project files. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = (SB.store = {});

  S.ASPECTS = [
    { id: '16:9', label: '16:9 · HD widescreen', ratio: 16 / 9 },
    { id: '1.85:1', label: '1.85:1 · Cinema flat', ratio: 1.85 },
    { id: '2.39:1', label: '2.39:1 · Cinemascope', ratio: 2.39 },
    { id: '2:1', label: '2:1 · Univisium', ratio: 2 },
    { id: '4:3', label: '4:3 · Classic TV', ratio: 4 / 3 },
    { id: '3:2', label: '3:2 · Photo', ratio: 3 / 2 },
    { id: '1:1', label: '1:1 · Square', ratio: 1 },
    { id: '4:5', label: '4:5 · Social portrait', ratio: 4 / 5 },
    { id: '9:16', label: '9:16 · Vertical / Stories', ratio: 9 / 16 },
  ];

  S.SHOT_TYPES = [
    'Extreme wide shot',
    'Wide shot',
    'Full shot',
    'Medium wide shot',
    'Medium shot',
    'Medium close-up',
    'Close-up',
    'Extreme close-up',
    'Over the shoulder',
    'Point of view (POV)',
    'Two-shot',
    'Insert',
    'Establishing shot',
    'Aerial / drone',
  ];

  S.FIELD_PLACEHOLDERS = {
    setting: 'e.g. INT. KITCHEN – NIGHT',
    shot: 'e.g. Close-up, Wide shot, POV',
    action: 'What happens in this shot?',
    voiceover: 'Narration heard over this shot',
    dialogue: 'e.g. SARAH: Where were you?',
    notes: 'Production notes',
  };

  S.ARROW_DEFAULTS = { color: '#ff3b30', width: 6, head: 'end', dash: false, outline: false };

  S.MAX_IMAGE_SIDE = 3200;
  S.PREVIEW_SIDE = 1600;

  S.defaultFields = () => [
    { id: 'setting', label: 'Setting', multiline: false },
    { id: 'shot', label: 'Shot type', multiline: false, presets: S.SHOT_TYPES.slice() },
    { id: 'action', label: 'Action', multiline: true },
    { id: 'voiceover', label: 'Voiceover', multiline: true },
    { id: 'dialogue', label: 'Dialogue', multiline: true },
    { id: 'notes', label: 'Notes', multiline: true },
  ];

  S.newProject = () => ({
    formatVersion: 1,
    title: '',
    aspect: '16:9',
    fields: S.defaultFields(),
    cover: { include: true, client: '', company: '', date: '', version: '', description: '', imageId: null },
    frames: [],
    exportSettings: { perPage: 4, pageSize: 'letter', orientation: 'landscape', showLabels: true, headerFooter: true },
    review: null,
  });

  S.newFrame = (imageId) => ({
    id: U.uid('f'),
    imageId: imageId || null,
    view: { zoom: 1, cx: 0.5, cy: 0.5, flip: false },
    arrows: [],
    text: {},
  });

  function normalizeArrow(a) {
    const n = (v, d) => (Number.isFinite(+v) ? +v : d);
    return {
      id: String(a.id || U.uid('a')),
      x1: n(a.x1, 0.3),
      y1: n(a.y1, 0.5),
      x2: n(a.x2, 0.7),
      y2: n(a.y2, 0.5),
      bend: n(a.bend, 0),
      color: typeof a.color === 'string' ? a.color : S.ARROW_DEFAULTS.color,
      width: n(a.width, S.ARROW_DEFAULTS.width),
      head: ['end', 'start', 'both', 'none'].includes(a.head) ? a.head : 'end',
      dash: !!a.dash,
      outline: !!a.outline,
    };
  }

  S.normalizeProject = function (p) {
    const d = S.newProject();
    if (!p || typeof p !== 'object') return d;
    d.title = String(p.title || '');
    d.aspect = S.ASPECTS.some((a) => a.id === p.aspect) ? p.aspect : '16:9';
    if (Array.isArray(p.fields)) {
      d.fields = p.fields
        .filter((f) => f && f.id)
        .map((f) => {
          const out = { id: String(f.id), label: String(f.label || 'Field'), multiline: !!f.multiline };
          if (Array.isArray(f.presets)) out.presets = f.presets.map(String);
          return out;
        });
    }
    d.cover = Object.assign(d.cover, p.cover || {});
    d.exportSettings = Object.assign(d.exportSettings, p.exportSettings || {});
    d.frames = (Array.isArray(p.frames) ? p.frames : []).map((f) => ({
      id: String(f.id || U.uid('f')),
      imageId: f.imageId || null,
      view: Object.assign({ zoom: 1, cx: 0.5, cy: 0.5, flip: false }, f.view || {}),
      arrows: Array.isArray(f.arrows) ? f.arrows.map(normalizeArrow) : [],
      text: Object.assign({}, f.text || {}),
    }));
    d.review = p.review && p.review.id ? Object.assign({}, p.review) : null;
    return d;
  };

  S.aspect = function (project) {
    const p = project || S.project;
    const a = S.ASPECTS.find((x) => x.id === p.aspect);
    return a ? a.ratio : 16 / 9;
  };

  S.frameById = (id) => S.project.frames.find((f) => f.id === id) || null;
  S.frameIndex = (id) => S.project.frames.findIndex((f) => f.id === id);

  /* ---------- State, change notification and undo history ---------- */

  S.project = S.newProject();
  S.images = new Map();

  const listeners = new Set();
  S.subscribe = function (fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  function emit(meta) {
    for (const fn of listeners) {
      try {
        fn(meta || {});
      } catch (e) {
        console.error(e);
      }
    }
  }
  S.emit = emit;

  let past = [];
  let future = [];
  let snapshot = JSON.stringify(S.project);
  let lastKey = null;
  let lastTime = 0;

  /**
   * Record the current state as one undo step. Changes are made directly on S.project before calling.
   * Consecutive commits with the same key (e.g. typing in one field) merge into a single undo step.
   */
  S.commit = function (key, meta) {
    const json = JSON.stringify(S.project);
    if (json === snapshot) {
      emit(Object.assign({ key, unchanged: true }, meta));
      return;
    }
    const now = Date.now();
    const merge = key && key === lastKey && now - lastTime < 1500;
    if (!merge) {
      past.push(snapshot);
      if (past.length > 200) past.shift();
    }
    future = [];
    snapshot = json;
    lastKey = key || null;
    lastTime = now;
    scheduleSave();
    emit(Object.assign({ key }, meta));
  };

  S.update = function (fn, key, meta) {
    fn(S.project);
    S.commit(key, meta);
  };

  /** Apply a change that should not be undoable (e.g. review link metadata). */
  S.updateSilently = function (fn, meta) {
    fn(S.project);
    snapshot = JSON.stringify(S.project);
    // Keep history entries consistent with this non-undoable data.
    const patch = (json) => {
      const p = JSON.parse(json);
      p.review = S.project.review ? JSON.parse(JSON.stringify(S.project.review)) : null;
      return JSON.stringify(p);
    };
    past = past.map(patch);
    future = future.map(patch);
    scheduleSave();
    emit(Object.assign({ silent: true }, meta));
  };

  function restore(json, kind) {
    const keepReview = S.project.review;
    S.project = JSON.parse(json);
    S.project.review = keepReview;
    snapshot = JSON.stringify(S.project);
    lastKey = null;
    scheduleSave();
    emit({ history: kind });
  }

  S.undo = function () {
    if (!past.length) return false;
    future.push(snapshot);
    restore(past.pop(), 'undo');
    return true;
  };
  S.redo = function () {
    if (!future.length) return false;
    past.push(snapshot);
    restore(future.pop(), 'redo');
    return true;
  };
  S.canUndo = () => past.length > 0;
  S.canRedo = () => future.length > 0;

  function resetHistory() {
    past = [];
    future = [];
    snapshot = JSON.stringify(S.project);
    lastKey = null;
  }

  /* ---------- IndexedDB ---------- */

  const DB_NAME = 'storyboard-maker';
  let dbPromise = null;
  S.persistent = false;
  S.saveState = 'off';
  let saveStateListener = null;
  S.onSaveState = (fn) => (saveStateListener = fn);
  function setSaveState(s) {
    S.saveState = s;
    if (saveStateListener) saveStateListener(s);
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open database'));
      req.onblocked = () => reject(new Error('Database blocked'));
    });
    return dbPromise;
  }

  async function idb(store, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }

  S.kvGet = (key) => idb('kv', 'readonly', (s) => s.get(key)).catch(() => undefined);
  S.kvSet = (key, value) => idb('kv', 'readwrite', (s) => s.put(value, key)).catch(() => undefined);

  async function saveNow() {
    if (!S.persistent) return;
    setSaveState('saving');
    try {
      await idb('kv', 'readwrite', (s) => s.put(S.project, 'project'));
      setSaveState('saved');
    } catch (e) {
      console.error('Autosave failed', e);
      setSaveState('error');
    }
  }
  const scheduleSave = U.debounce(saveNow, 400);
  S.flushSave = () => scheduleSave.flush();

  let persistRequested = false;
  function requestPersist() {
    if (persistRequested) return;
    persistRequested = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------- Images ---------- */

  function decodeBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
    });
  }
  S.canvasToBlob = canvasToBlob;

  /** High-quality downscale by repeated halving. */
  function scaleToCanvas(src, tw, th, whiteBg) {
    let cur = src;
    let cw = src.naturalWidth || src.width;
    let ch = src.naturalHeight || src.height;
    while (cw / 2 >= tw && ch / 2 >= th) {
      const nw = Math.round(cw / 2);
      const nh = Math.round(ch / 2);
      const c = document.createElement('canvas');
      c.width = nw;
      c.height = nh;
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, nw, nh);
      cur = c;
      cw = nw;
      ch = nh;
    }
    const out = document.createElement('canvas');
    out.width = tw;
    out.height = th;
    const ctx = out.getContext('2d');
    if (whiteBg) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, tw, th);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, tw, th);
    return out;
  }
  S.scaleToCanvas = scaleToCanvas;

  function makePreview(img, w, h) {
    const max = Math.max(w, h);
    if (max <= S.PREVIEW_SIDE) return img;
    const s = S.PREVIEW_SIDE / max;
    return scaleToCanvas(img, Math.round(w * s), Math.round(h * s), false);
  }

  async function makeEntry(rec) {
    const { img, url } = await decodeBlob(rec.blob);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    return { id: rec.id, name: rec.name || '', blob: rec.blob, url, img, w, h, preview: makePreview(img, w, h) };
  }

  let storageWarned = false;
  async function storeImageRecord(entry) {
    if (!S.persistent) return;
    try {
      await idb('images', 'readwrite', (s) => s.put({ id: entry.id, name: entry.name, blob: entry.blob, w: entry.w, h: entry.h }));
    } catch (e) {
      console.warn('Could not store image', e);
      if (!storageWarned) {
        storageWarned = true;
        U.toast('Browser storage is full, so some images were not autosaved. Use File → Save project to keep your work.', { type: 'error', duration: 9000 });
      }
    }
  }

  /** Import a user-selected image file. Resolves with the new image id. */
  S.addImageFile = async function (file) {
    let decoded;
    try {
      decoded = await decodeBlob(file);
    } catch (e) {
      throw new Error(`Couldn't read "${file.name}".`);
    }
    let { img, url } = decoded;
    let blob = file;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const webSafe = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    if (!webSafe || Math.max(w, h) > S.MAX_IMAGE_SIDE || file.size > 8e6) {
      const s = Math.min(1, S.MAX_IMAGE_SIDE / Math.max(w, h));
      const c = scaleToCanvas(img, Math.round(w * s), Math.round(h * s), true);
      blob = await canvasToBlob(c, 'image/jpeg', 0.9);
      URL.revokeObjectURL(url);
      ({ img, url } = await decodeBlob(blob));
    }
    const entry = {
      id: U.uid('img'),
      name: file.name || 'image',
      blob,
      url,
      img,
      w: img.naturalWidth,
      h: img.naturalHeight,
    };
    entry.preview = makePreview(img, entry.w, entry.h);
    S.images.set(entry.id, entry);
    requestPersist();
    await storeImageRecord(entry);
    return entry.id;
  };

  function referencedImageIds(project) {
    const ids = new Set();
    for (const f of project.frames) if (f.imageId) ids.add(f.imageId);
    if (project.cover && project.cover.imageId) ids.add(project.cover.imageId);
    return ids;
  }

  /* ---------- Startup ---------- */

  S.init = async function (onProgress) {
    try {
      await openDB();
      S.persistent = true;
    } catch (e) {
      console.warn('Autosave unavailable:', e);
      S.persistent = false;
      setSaveState('off');
      resetHistory();
      return;
    }
    try {
      const saved = await idb('kv', 'readonly', (s) => s.get('project'));
      if (saved) S.project = S.normalizeProject(saved);
      const ids = referencedImageIds(S.project);
      const records = await idb('images', 'readonly', (s) => s.getAll());
      const wanted = records.filter((r) => ids.has(r.id));
      const stale = records.filter((r) => !ids.has(r.id));
      if (stale.length) {
        idb('images', 'readwrite', (s) => {
          let last;
          for (const r of stale) last = s.delete(r.id);
          return last;
        }).catch(() => {});
      }
      let done = 0;
      const queue = wanted.slice();
      const worker = async () => {
        while (queue.length) {
          const rec = queue.shift();
          try {
            S.images.set(rec.id, await makeEntry(rec));
          } catch (err) {
            console.warn('Could not decode stored image', rec.id, err);
          }
          done++;
          if (onProgress) onProgress(done, wanted.length);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setSaveState('saved');
    } catch (e) {
      console.error('Could not load saved storyboard', e);
      setSaveState('error');
    }
    resetHistory();
  };

  /* ---------- New / project files ---------- */

  async function clearAllImages() {
    for (const im of S.images.values()) URL.revokeObjectURL(im.url);
    S.images.clear();
    if (S.persistent) {
      try {
        await idb('images', 'readwrite', (s) => s.clear());
      } catch (e) {
        console.warn(e);
      }
    }
  }

  S.resetProject = async function () {
    await clearAllImages();
    S.project = S.newProject();
    resetHistory();
    await saveNow();
    emit({ reset: true });
  };

  const MAGIC = 'STRYBRD1';

  /** Project files are a small binary container: magic, JSON length, JSON, then the raw image bytes. */
  S.buildProjectFile = async function () {
    const parts = [];
    const index = [];
    let offset = 0;
    for (const id of referencedImageIds(S.project)) {
      const im = S.images.get(id);
      if (!im) continue;
      index.push({ id, name: im.name, type: im.blob.type || 'image/jpeg', offset, size: im.blob.size });
      parts.push(im.blob);
      offset += im.blob.size;
    }
    const header = new TextEncoder().encode(
      JSON.stringify({ app: 'storyboard-maker', formatVersion: 1, savedAt: new Date().toISOString(), project: S.project, images: index })
    );
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, header.length, true);
    return new Blob([MAGIC, len, header, ...parts], { type: 'application/octet-stream' });
  };

  S.readProjectFile = async function (file) {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head.length < 12 || new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) {
      throw new Error('This file is not a Storyboard project (.storyboard).');
    }
    const len = new DataView(head.buffer).getUint32(8, true);
    let meta;
    try {
      meta = JSON.parse(new TextDecoder().decode(await file.slice(12, 12 + len).arrayBuffer()));
    } catch (e) {
      throw new Error('This project file is damaged and could not be opened.');
    }
    const base = 12 + len;
    const project = S.normalizeProject(meta.project);
    const entries = [];
    for (const m of meta.images || []) {
      const bytes = await file.slice(base + m.offset, base + m.offset + m.size).arrayBuffer();
      const blob = new Blob([bytes], { type: m.type || 'image/jpeg' });
      try {
        entries.push(await makeEntry({ id: m.id, name: m.name, blob }));
      } catch (e) {
        console.warn('Skipping unreadable image in project file', m.id);
      }
    }
    return { project, entries };
  };

  S.loadProject = async function (data) {
    await clearAllImages();
    for (const e of data.entries) S.images.set(e.id, e);
    S.project = data.project;
    resetHistory();
    for (const e of data.entries) await storeImageRecord(e);
    await saveNow();
    emit({ reset: true });
  };
})(window.SB);
