/* Storyboard Maker — client review links: Firebase setup, publishing and updating the online storyboard. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const R = SB.render;
  const C = SB.cloud;
  const SH = (SB.share = {});

  const $ = (id) => document.getElementById(id);
  let dlg;
  let busy = false;
  let progressText = '';
  let lastError = '';
  let mode = {}; // how the dialog was opened: {setup: true} jumps to Firebase settings, {home: true} from the home page

  /* ---------- Settings (kept per browser) ---------- */

  const emulatorHost = () => U.storage.get('sb-emulator', '') || new URLSearchParams(location.search).get('emulator') || '';

  /** The Firebase project built into this copy of the app (js/config.js), or null. Ignored when testing with the local emulator. */
  SH.builtIn = function () {
    const c = window.SB_FIREBASE_CONFIG;
    if (emulatorHost()) return null;
    if (!c || !isToken(c.apiKey) || !isToken(c.projectId)) return null;
    const cfg = { apiKey: c.apiKey, projectId: c.projectId };
    const databaseId = C.normalizeDatabaseId(c.databaseId);
    if (databaseId) cfg.databaseId = databaseId;
    return cfg;
  };

  SH.settings = function () {
    const emulator = emulatorHost();
    const stored = U.storage.get('sb-firebase-config', null);
    const cfg = SH.builtIn() || (stored && stored.apiKey ? stored : null);
    return {
      cfg: cfg ? Object.assign({}, cfg, emulator ? { emulator } : {}) : emulator ? { apiKey: 'demo-key', projectId: 'demo-storyboard', emulator } : null,
      reviewBase: U.storage.get('sb-review-base', '') || C.defaultReviewPage(),
      teamName: U.storage.get('sb-team-name', ''),
    };
  };

  /** Settings saved inside project files so any computer that opens one is ready to create client links. */
  SH.portableSettings = function () {
    const cfg = SH.builtIn() || U.storage.get('sb-firebase-config', null);
    if (!cfg || !cfg.apiKey || !cfg.projectId) return null;
    const out = { firebase: { apiKey: cfg.apiKey, projectId: cfg.projectId } };
    if (cfg.databaseId) out.firebase.databaseId = cfg.databaseId;
    const base = U.storage.get('sb-review-base', '');
    if (base) out.reviewBase = base;
    return out;
  };

  const isWebUrl = (s) => {
    try {
      return /^https?:$/.test(new URL(s).protocol);
    } catch (e) {
      return false;
    }
  };
  const isToken = (s) => typeof s === 'string' && /^[A-Za-z0-9_.:-]{3,200}$/.test(s);

  /**
   * Fill in this browser's Firebase settings from an opened project (its saved settings, or the config its
   * existing link uses). Never overwrites settings the browser already has. Returns true if anything was set.
   */
  SH.adoptSettings = function (settings, review) {
    const current = U.storage.get('sb-firebase-config', null);
    if (SH.builtIn() || (current && current.apiKey)) return false;
    let fb = settings && settings.firebase;
    let base = settings && settings.reviewBase;
    if (!fb && review && review.apiKey && !review.emulator) {
      fb = { apiKey: review.apiKey, projectId: review.projectId, databaseId: review.databaseId };
      base = base || review.base;
    }
    if (!fb || !isToken(fb.apiKey) || !isToken(fb.projectId)) return false;
    const databaseId = C.normalizeDatabaseId(fb.databaseId);
    const cfg = { apiKey: fb.apiKey, projectId: fb.projectId };
    if (databaseId) cfg.databaseId = databaseId;
    U.storage.set('sb-firebase-config', cfg);
    if (base && isWebUrl(base) && !U.storage.get('sb-review-base', '')) U.storage.set('sb-review-base', base);
    return true;
  };

  /** The Firebase config a project's existing link lives in (so the link keeps working if settings change). */
  SH.projectCfg = function (review) {
    review = review || S.project.review;
    if (!review) return null;
    const cfg = { apiKey: review.apiKey, projectId: review.projectId };
    if (review.databaseId) cfg.databaseId = review.databaseId;
    if (review.emulator) cfg.emulator = review.emulator;
    return cfg;
  };

  /* ---------- Team link: connects another computer to the same Firebase project ---------- */

  /** The app's address for teammates (where it's hosted), with this browser's Firebase project IDs in it. */
  SH.teamLink = function () {
    const cfg = SH.settings().cfg;
    if (!cfg) return null;
    if (SH.builtIn()) return SH.appAddress(); // already connected: just the app's address
    const params = new URLSearchParams({ team: '1', p: cfg.projectId, k: cfg.apiKey });
    if (cfg.databaseId) params.set('d', cfg.databaseId);
    if (cfg.emulator) params.set('emu', cfg.emulator);
    return SH.appAddress() + '#' + params.toString();
  };

  SH.appAddress = () => new URL('./', SH.settings().reviewBase).href;

  /**
   * Read a team link (#team=1&p=…&k=…&d=…). Returns null if the hash isn't one, otherwise
   * {cfg, status: 'joined' | 'same' | 'different'}. 'joined' means this browser had no Firebase settings and now
   * has the team's; 'different' means it already uses another project (call SH.useTeamCfg to switch).
   */
  SH.readTeamLink = function (hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (params.get('team') !== '1') return null;
    if (SH.builtIn()) return { status: 'builtin' }; // this copy is already connected
    const projectId = params.get('p');
    const apiKey = params.get('k');
    const databaseId = C.normalizeDatabaseId(params.get('d'));
    if (!isToken(projectId) || !isToken(apiKey) || databaseId === null) return { status: 'invalid' };
    const cfg = { apiKey, projectId };
    if (databaseId) cfg.databaseId = databaseId;
    const current = U.storage.get('sb-firebase-config', null);
    if (current && current.apiKey) {
      const same = current.apiKey === apiKey && current.projectId === projectId && (current.databaseId || '') === (cfg.databaseId || '');
      return { cfg, status: same ? 'same' : 'different', current };
    }
    U.storage.set('sb-firebase-config', cfg);
    return { cfg, status: 'joined' };
  };

  SH.useTeamCfg = function (cfg) {
    U.storage.set('sb-firebase-config', cfg);
  };

  SH.link = function (review) {
    review = review || S.project.review;
    return review ? C.reviewLink(review.base, SH.projectCfg(review), review.id) : '';
  };

  /** Ask once for the name shown on the team's replies. */
  SH.ensureTeamName = async function () {
    let name = SH.settings().teamName;
    if (name) return name;
    const r = await U.choose({
      title: 'Your name for replies',
      message: 'Clients will see this name, with a “Team” badge, on replies you post. You can change it later in Client link settings.',
      input: { placeholder: 'e.g. Sam at Northlight Films', maxlength: 80 },
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: 'Save name', kind: 'primary' },
      ],
    });
    name = r && r.id === 'ok' ? r.value.trim() : '';
    if (name) U.storage.set('sb-team-name', name);
    return name || null;
  };

  /* ---------- Publishing ---------- */

  const frameFP = (f, aspect) => C.hash(JSON.stringify([f.imageId, f.view, f.arrows, aspect]));

  function payload(project, fps) {
    const fields = project.fields.map((fd) => ({ id: fd.id, label: fd.label }));
    const frames = project.frames.map((f) => {
      const text = {};
      for (const fd of project.fields) {
        const v = (f.text[fd.id] || '').trim();
        if (v) text[fd.id] = f.text[fd.id];
      }
      return { id: f.id, text, rev: f.imageId ? fps[f.id] : null };
    });
    const c = project.cover;
    return {
      title: project.title || 'Untitled storyboard',
      aspect: { id: project.aspect, ratio: S.aspect(project) },
      fields,
      frames,
      cover: {
        include: !!c.include,
        client: c.client || '',
        company: c.company || '',
        date: c.date || '',
        version: c.version || '',
        description: c.description || '',
        rev: c.imageId ? fps.cover : null,
      },
      teamName: SH.settings().teamName || '',
    };
  }

  function currentFingerprints(project) {
    const fps = {};
    for (const f of project.frames) fps[f.id] = frameFP(f, project.aspect);
    if (project.cover.imageId) fps.cover = C.hash('cover:' + project.cover.imageId);
    return fps;
  }

  /** True when the storyboard has changed since the link was last updated. */
  SH.isOutdated = function () {
    const review = S.project.review;
    if (!review) return false;
    const p = payload(S.project, currentFingerprints(S.project));
    delete p.teamName;
    return C.hash(JSON.stringify(p)) !== review.sig;
  };

  /** Render a frame as a JPEG data URL small enough for one Firestore document (< 1 MB). */
  function frameImageData(frame, ratio) {
    let maxSide = 1400;
    let quality = 0.82;
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = ratio >= 1 ? maxSide : maxSide * ratio;
      const c = R.frameCanvas(frame, ratio, w, { full: true });
      const data = c.toDataURL('image/jpeg', quality);
      if (data.length < 900000) return data;
      quality = Math.max(0.5, quality - 0.1);
      maxSide = Math.round(maxSide * 0.85);
    }
    throw new Error('A frame image is too large to upload.');
  }

  function coverImageData(im) {
    const max = Math.max(im.w, im.h);
    const s = Math.min(1, 1400 / max);
    const c = S.scaleToCanvas(im.img, Math.round(im.w * s), Math.round(im.h * s), true);
    return c.toDataURL('image/jpeg', 0.85);
  }

  SH.publish = async function () {
    if (busy) return false;
    const project = S.project;
    const existing = project.review;
    const settings = SH.settings();
    const cfg = existing ? SH.projectCfg(existing) : settings.cfg;
    if (!cfg) {
      SH.open();
      return false;
    }
    busy = true;
    lastError = '';
    setProgress('Connecting…');
    try {
      const conn = await C.connect(cfg);
      const fps = currentFingerprints(project);
      const ratio = S.aspect(project);
      let review = existing;
      const data = payload(project, fps);
      if (!review) {
        review = {
          id: U.randomKey(12),
          key: U.randomKey(16),
          apiKey: cfg.apiKey,
          projectId: cfg.projectId,
          base: settings.reviewBase,
          fp: {},
        };
        if (cfg.databaseId) review.databaseId = cfg.databaseId;
        if (cfg.emulator) review.emulator = cfg.emulator;
        setProgress('Creating link…');
        await C.createReview(conn, review.id, review.key, Object.assign({}, data, { frames: [], revision: 0 }));
        // Remember the link right away so a failed upload can be resumed with "Update link".
        S.updateSilently((p) => (p.review = Object.assign({}, review, { sig: '' })));
      } else {
        await C.ensureOwner(conn, review.id, review.key);
      }
      const oldFp = Object.assign({}, review.fp || {});
      const sizes = Object.assign({}, review.sizes || {}); // bytes stored per uploaded image (for the team storage bar)
      const toUpload = project.frames.filter((f) => f.imageId && oldFp[f.id] !== fps[f.id]);
      let done = 0;
      for (const f of toUpload) {
        setProgress(`Uploading frame ${S.frameIndex(f.id) + 1} (${++done} of ${toUpload.length})…`);
        const img = frameImageData(f, ratio);
        await C.putImage(conn, review.id, f.id, img, fps[f.id]);
        sizes[f.id] = img.length;
        await new Promise((r) => setTimeout(r, 0));
      }
      const coverIm = project.cover.imageId ? S.images.get(project.cover.imageId) : null;
      if (coverIm && oldFp.cover !== fps.cover) {
        setProgress('Uploading cover image…');
        const img = coverImageData(coverIm);
        await C.putImage(conn, review.id, 'cover', img, fps.cover);
        sizes.cover = img.length;
      }
      const stale = Object.keys(oldFp).filter((id) => !(id in fps) || (id !== 'cover' && !S.frameById(id)?.imageId));
      for (const id of stale) {
        await C.deleteImage(conn, review.id, id).catch(() => {});
        delete sizes[id];
      }
      for (const id of Object.keys(sizes)) if (!(id in fps)) delete sizes[id];
      const bytes = Object.values(sizes).reduce((a, b) => a + b, 0) + JSON.stringify(data).length;
      setProgress('Finishing…');
      await C.updateReview(conn, review.id, Object.assign({}, data, { revision: (review.revision || 0) + 1 }));
      const sigData = Object.assign({}, data);
      delete sigData.teamName;
      const newFp = {};
      for (const [k, v] of Object.entries(fps)) if (k === 'cover' || S.frameById(k)?.imageId) newFp[k] = v;
      S.updateSilently((p) => {
        p.review = Object.assign({}, review, { fp: newFp, sizes, bytes, sig: C.hash(JSON.stringify(sigData)), revision: (review.revision || 0) + 1, publishedAt: Date.now() });
      });
      SB.feedback.connect();
      U.toast(existing ? 'Client link updated' : 'Client link created');
      return true;
    } catch (e) {
      console.error(e);
      lastError = C.explainError(e);
      U.toast('Couldn’t update the client link: ' + lastError, { type: 'error', duration: 9000 });
      return false;
    } finally {
      busy = false;
      setProgress('');
    }
  };

  /** Turn off a client link: deletes the online copy and its comments. Works for any storyboard's link. */
  SH.deleteOnline = async function (review) {
    const conn = await C.connect(SH.projectCfg(review));
    await C.ensureOwner(conn, review.id, review.key);
    await C.deleteReview(conn, review.id);
  };

  SH.stopSharing = async function () {
    const review = S.project.review;
    if (!review) return;
    const ok = await U.confirm(
      'Stop sharing this storyboard?',
      'The client link will stop working and all comments on it will be permanently deleted. You can create a new link later.',
      'Stop sharing',
      true
    );
    if (!ok) return;
    busy = true;
    setProgress('Deleting the online copy…');
    try {
      await SH.deleteOnline(review);
    } catch (e) {
      console.error(e);
      busy = false;
      setProgress('');
      const forget = await U.confirm('Couldn’t delete the online copy', C.explainError(e) + '\n\nRemove the link from this storyboard anyway?', 'Remove link', true);
      if (!forget) return;
    }
    busy = false;
    setProgress('');
    S.updateSilently((p) => (p.review = null));
    SB.feedback.connect();
    U.toast('Sharing stopped');
  };

  /* ---------- Dialog ---------- */

  SH.init = function () {
    dlg = $('share-dialog');
    dlg.addEventListener('cancel', (e) => {
      if (busy) e.preventDefault();
    });
    S.subscribe(() => {
      if (dlg.open && !busy) render();
    });
  };

  SH.open = function (opts) {
    lastError = '';
    mode = opts || {};
    render();
    if (!dlg.open) dlg.showModal();
  };

  function setProgress(text) {
    progressText = text;
    if (dlg && dlg.open) render();
  }

  function render() {
    const body = $('share-body');
    const foot = $('share-foot');
    const settings = SH.settings();
    const review = S.project.review;
    const showSetup = !SH.builtIn() && (mode.setup || (!review && !settings.cfg));
    $('share-h').textContent = mode.home ? 'Connect Firebase' : 'Client review link';
    $('share-h').nextElementSibling.textContent = mode.home
      ? 'Team storyboards are kept in your own free Firebase project, the same one client links use.'
      : 'Clients open the link in any browser, type their name once, and leave comments and suggested edits. No account needed.';
    body.replaceChildren();
    foot.replaceChildren();
    if (showSetup) renderSetup(body, foot, settings);
    else if (!review) renderReady(body, foot, settings);
    else renderShared(body, foot, settings, review);
    if (progressText) {
      foot.prepend(U.h('span', { class: 'muted small', text: progressText }), U.h('span', { class: 'spacer' }));
      U.$$('button', foot).forEach((b) => (b.disabled = true));
    }
  }

  function closeBtn(label) {
    return U.h('button', { type: 'button', class: 'btn btn-ghost', text: label || 'Close', onclick: () => dlg.close() });
  }

  const appHost = (settings) => {
    try {
      return new URL(settings.reviewBase).hostname;
    } catch (e) {
      return 'adamskov-123.github.io';
    }
  };

  function renderSetup(body, foot, settings) {
    const steps = U.h(
      'ol',
      { class: 'steps' },
      U.h('li', { html: 'Go to <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">console.firebase.google.com</a>, sign in with a Google account and click <b>Create a project</b>. Any name works, and you can turn Google Analytics off. The free “Spark” plan is all you need.' }),
      U.h('li', { html: 'In the left menu open <b>Databases &amp; Storage → Firestore</b> and click <b>Add database</b> (older consoles: <b>Build → Firestore Database → Create database</b>). Choose <b>Standard edition</b>. For <b>Database ID</b>, keep <code>(default)</code> if it’s offered. If you type your own ID instead, enter the same ID in the <b>Database ID</b> box on this screen. Pick a location near you, choose <b>Production mode</b>, and click <b>Create</b>.' }),
      U.h('li', {}, U.h('span', { html: 'When the database is ready, open its <b>Rules</b> tab, replace everything with these rules, then click <b>Publish</b>. ' }), U.h('button', { type: 'button', class: 'link-btn', text: 'Copy rules', onclick: async () => U.toast((await U.copyText(SB.FIRESTORE_RULES)) ? 'Rules copied, now paste them in Firebase' : 'Copy failed. The rules are in firestore.rules in this project.') })),
      U.h('li', { html: `In the left menu open <b>Security → Authentication</b> (older consoles: <b>Build → Authentication</b>) and click <b>Get started</b> if you see it. On the <b>Sign-in method</b> tab, enable <b>Anonymous</b> (for client links; clients never see a sign-in screen). For team storyboards, also enable <b>Google</b>, then on the <b>Settings</b> tab open <b>Authorized domains</b> and add <code>${appHost(settings)}</code>.` }),
      U.h('li', { html: 'Open <b>Project settings</b> (gear icon next to <b>Project Overview</b>) → <b>Your apps</b> → the <b>&lt;/&gt;</b> (Web) button. Register an app with any nickname (you don’t need Firebase Hosting), then copy the <code>firebaseConfig</code> code it shows and paste it here.' })
    );
    const cfgText = U.h('textarea', { class: 'input', rows: '7', placeholder: 'const firebaseConfig = {\n  apiKey: "…",\n  authDomain: "…",\n  projectId: "…",\n  …\n};' });
    const current = U.storage.get('sb-firebase-config', null);
    const draft = U.storage.get('sb-firebase-draft', null);
    if (current) cfgText.value = `apiKey: "${current.apiKey}",\nprojectId: "${current.projectId}"`;
    else if (draft && draft.text) cfgText.value = draft.text;
    const dbInput = U.h('input', { class: 'input', type: 'text', value: (current && current.databaseId) || (draft && draft.databaseId) || '', placeholder: '(default)', autocomplete: 'off', spellcheck: 'false' });
    const base = U.h('input', { class: 'input', type: 'url', value: (!current && draft && draft.base) || settings.reviewBase });
    const saveDraft = () => U.storage.set('sb-firebase-draft', { text: cfgText.value, databaseId: dbInput.value, base: base.value });
    [cfgText, dbInput, base].forEach((el) => el.addEventListener('input', saveDraft));
    const status = U.h('div');
    if (lastError) status.append(U.h('p', { class: 'notice notice-warn', text: lastError }));
    const connect = U.h('button', { type: 'button', class: 'btn btn-primary', text: 'Connect' });
    connect.addEventListener('click', async () => {
      const cfg = C.parseConfig(cfgText.value);
      if (!cfg) {
        status.replaceChildren(U.h('p', { class: 'notice notice-warn', text: 'Couldn’t find apiKey and projectId in what you pasted. Paste the whole firebaseConfig block.' }));
        return;
      }
      const databaseId = C.normalizeDatabaseId(dbInput.value);
      if (databaseId === null) {
        status.replaceChildren(U.h('p', { class: 'notice notice-warn', text: 'That Database ID doesn’t look right. Copy it exactly as shown in Firestore, or leave the box empty to use “(default)”.' }));
        return;
      }
      if (databaseId) cfg.databaseId = databaseId;
      let url = base.value.trim();
      try {
        url = new URL(url).href;
      } catch (e) {
        status.replaceChildren(U.h('p', { class: 'notice notice-warn', text: 'The review page address must be a full web address starting with https://' }));
        return;
      }
      connect.disabled = true;
      status.replaceChildren(U.h('p', { class: 'notice', text: 'Checking your Firebase project…' }));
      try {
        await C.testConnection(cfg);
        U.storage.set('sb-firebase-config', cfg);
        U.storage.set('sb-review-base', url);
        try {
          localStorage.removeItem('sb-firebase-draft');
        } catch (err) {
          /* ignore */
        }
        lastError = '';
        U.toast('Connected to Firebase');
        if (mode.home) {
          // Set up from the home page for team storyboards: carry on there.
          dlg.close();
          SB.team.init();
          return;
        }
        mode = {};
        render();
      } catch (e) {
        console.error(e);
        lastError = C.explainError(e);
        status.replaceChildren(U.h('p', { class: 'notice notice-warn', text: lastError }));
      } finally {
        connect.disabled = false;
      }
    });
    body.append(
      U.h(
        'div',
        { class: 'share-grid' },
        U.h(
          'div',
          {},
          U.h('p', { class: 'muted', text: 'One-time setup, about 10 minutes. Client links, their comments and team storyboards are stored in your own free Firebase project. Clients don’t need any account.' }),
          steps,
          U.h('p', { class: 'muted small', text: 'You only do this once. Teammates don’t need to: they open the team link (from Team members on the home page). Project files you save carry these settings too.' })
        ),
        U.h(
          'div',
          { class: 'form-stack' },
          U.h('div', { class: 'form-row' }, U.h('label', { text: 'Firebase config' }), cfgText),
          U.h(
            'div',
            { class: 'form-row' },
            U.h('label', { text: 'Database ID' }),
            dbInput,
            U.h('span', { class: 'muted small', text: 'Leave empty if your database is called “(default)”. Otherwise type the ID you gave it in step 2.' })
          ),
          U.h(
            'div',
            { class: 'form-row' },
            U.h('label', { text: 'Review page address' }),
            base,
            U.h('span', { class: 'muted small', html: 'Where clients open links. With GitHub Pages turned on for this repository this is <code>https://&lt;you&gt;.github.io/Storyboard/review.html</code>. See the README.' })
          ),
          status
        )
      )
    );
    foot.append(closeBtn('Cancel'), connect);
  }

  function teamNameRow(settings) {
    const input = U.h('input', { class: 'input', type: 'text', value: settings.teamName, placeholder: 'e.g. Sam at Northlight Films', maxlength: '80' });
    input.addEventListener('change', () => U.storage.set('sb-team-name', input.value.trim()));
    return U.h('div', { class: 'form-row' }, U.h('label', { text: 'Your name on replies' }), input, U.h('span', { class: 'muted small', text: 'Shown with a “Team” badge when you reply to client comments.' }));
  }

  function renderReady(body, foot, settings) {
    body.append(
      U.h(
        'div',
        { class: 'form-stack' },
        U.h('p', { class: 'notice notice-ok', text: `Connected to Firebase project “${settings.cfg.projectId}”${settings.cfg.databaseId ? ` (database “${settings.cfg.databaseId}”)` : ''}.` }),
        U.h('p', { text: 'Creating a link uploads a copy of this storyboard (frames as you see them, with framing and arrows, plus the filled-in text and cover page). Anyone with the link can view it and comment. Nobody can find it without the link.' }),
        teamNameRow(settings),
        lastError ? U.h('p', { class: 'notice notice-warn', text: lastError }) : null,
        SH.builtIn() ? null : U.h('button', { type: 'button', class: 'link-btn', text: 'Change Firebase settings…', onclick: () => SH.open({ setup: true }) })
      )
    );
    const create = U.h('button', { type: 'button', class: 'btn btn-primary', html: U.icon('link', 16) + '<span>Create client link</span>' });
    create.addEventListener('click', async () => {
      if (!S.project.frames.length) {
        U.toast('Add some frames before sharing.');
        return;
      }
      await SH.publish();
      render();
    });
    if (S.readOnly) {
      body.append(U.h('p', { class: 'notice', text: 'Only the person editing this storyboard can create its client link.' }));
      foot.append(closeBtn());
      return;
    }
    if (!SB.team.isMember()) {
      // The security rules only let team members create links (so nobody else can use up the free storage).
      body.append(
        U.h(
          'p',
          { class: 'notice notice-warn', text: SB.team.status === 'no-team' ? 'Set up your team on the home page first: only team members can create client links.' : 'Only team members can create client links. Sign in with Google on the home page first.' }
        )
      );
      foot.append(closeBtn(), U.h('button', { type: 'button', class: 'btn btn-primary', text: 'Go to home page', onclick: () => (dlg.close(), SB.app.goHome()) }));
      return;
    }
    foot.append(closeBtn(), create);
  }

  function renderShared(body, foot, settings, review) {
    const link = SH.link(review);
    const linkInput = U.h('input', { class: 'input', type: 'text', readonly: true, value: link, 'aria-label': 'Client link' });
    linkInput.addEventListener('focus', () => linkInput.select());
    const outdated = SH.isOutdated();
    body.append(
      U.h(
        'div',
        { class: 'form-stack' },
        U.h(
          'div',
          { class: 'form-row' },
          U.h('label', { text: 'Send this link to your client' }),
          U.h(
            'div',
            { class: 'link-box' },
            linkInput,
            U.h('button', {
              type: 'button',
              class: 'btn btn-primary',
              html: U.icon('copy', 15) + '<span>Copy</span>',
              onclick: async () => U.toast((await U.copyText(link)) ? 'Link copied' : 'Select the link and copy it'),
            }),
            U.h('a', { class: 'btn btn-ghost', href: link, target: '_blank', rel: 'noopener', html: U.icon('eye', 15) + '<span>Open</span>' })
          )
        ),
        U.h(
          'div',
          { class: 'share-status' },
          outdated
            ? U.h('span', { class: 'notice notice-warn', text: 'You’ve changed the storyboard since the link was last updated. Clients still see the older version.' })
            : U.h('span', { class: 'notice notice-ok', text: 'The client link shows the latest version.' }),
          review.publishedAt ? U.h('span', { class: 'muted small', text: `Last updated ${U.timeAgo(review.publishedAt)}` }) : null
        ),
        lastError ? U.h('p', { class: 'notice notice-warn', text: lastError }) : null,
        teamNameRow(settings),
        U.h(
          'details',
          { class: 'share-advanced' },
          U.h('summary', { text: 'More options' }),
          U.h(
            'div',
            { class: 'stack-sm' },
            U.h('p', { class: 'muted small', text: `Stored in Firebase project “${review.projectId}”. Comments stay attached to frames when you reorder or update them.` }),
            U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm danger', text: 'Stop sharing and delete comments…', onclick: () => SH.stopSharing() }),
            SH.builtIn() ? null : U.h('button', { type: 'button', class: 'link-btn', text: 'Change Firebase settings for new links…', onclick: () => SH.open({ setup: true }) })
          )
        )
      )
    );
    const update = U.h('button', { type: 'button', class: 'btn ' + (outdated ? 'btn-primary' : 'btn-ghost'), html: U.icon('refresh', 15) + '<span>Update link</span>' });
    update.addEventListener('click', async () => {
      await SH.publish();
      render();
    });
    if (S.readOnly) {
      U.$$('.share-advanced', body).forEach((el) => el.remove());
      body.append(U.h('p', { class: 'notice', text: 'Only the person editing this storyboard can update or stop its client link.' }));
    }
    foot.append(
      ...[
        U.h('button', { type: 'button', class: 'btn btn-ghost', html: U.icon('message', 15) + '<span>View feedback</span>', onclick: () => (dlg.close(), SB.feedback.open()) }),
        U.h('span', { class: 'spacer' }),
        closeBtn(),
        S.readOnly ? null : update,
      ].filter(Boolean)
    );
  }
})(window.SB);
