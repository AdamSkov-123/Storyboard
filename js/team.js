/* Storyboard Maker — team storyboards: Google sign-in, approved members, shared storyboards (one editor at a time). */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const C = SB.cloud;
  const T = (SB.team = {});

  T.LIMIT = 1024 * 1024 * 1024; // Firestore free plan: 1 GiB stored
  const LOCK_FRESH_MS = 3 * 60 * 1000; // a lock without a heartbeat for this long has been abandoned
  const HEARTBEAT_MS = 60 * 1000;
  const IDLE_MS = 20 * 60 * 1000; // stop holding the lock after this long without activity
  const SAVE_DELAY_MS = 1200;
  const MAX_IMAGE_BYTES = 900 * 1000; // one Firestore document holds at most 1 MiB
  const SESSION = U.randomKey(8); // this tab; one person's two tabs or computers mustn't both edit

  T.status = 'off'; // off | loading | signed-out | no-team | not-approved | member | error
  T.user = null; // {uid, email, name, photo}
  T.role = null; // 'admin' | 'member'
  T.boards = []; // team storyboards (board documents)
  T.members = [];
  T.teamName = '';
  T.error = '';
  T.cloudState = ''; // '', 'saving', 'saved', 'offline', 'error'

  let conn = null;
  let unsubBoards = null;
  let unsubMembers = null;
  let session = null; // the open team storyboard: {id, editing, rev, sizes: Map, dirty, timer, unsubData, idle, createdHere}
  let readyResolve;
  T.ready = new Promise((r) => (readyResolve = r));

  const listeners = new Set();
  T.subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  function changed() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }

  const cfg = () => SB.share.settings().cfg;
  T.available = () => !!cfg();
  T.isMember = () => T.status === 'member';
  T.isAdmin = () => T.status === 'member' && T.role === 'admin';
  const isGoogle = (u) => !!(u && !u.isAnonymous && u.providerData.some((p) => p.providerId === 'google.com'));
  const millis = (t) => {
    const d = U.toDate(t);
    return d ? d.getTime() : 0;
  };

  T.explain = function (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/unauthorized-domain') {
      return `This address (${location.host}) isn’t allowed to sign in yet. In Firebase open Security → Authentication → Settings → Authorized domains and add ${location.hostname}.`;
    }
    if (code === 'auth/operation-not-allowed') {
      return 'Google sign-in is turned off. In Firebase open Security → Authentication → Sign-in method and enable Google.';
    }
    if (code === 'permission-denied') {
      return 'Firebase refused access. Publish the latest security rules from this app (Client link → More options → Change Firebase settings → Copy rules).';
    }
    return C.explainError(e);
  };

  /* ---------- Sign-in and membership ---------- */

  T.init = async function () {
    if (!cfg()) {
      T.status = 'off';
      readyResolve();
      changed();
      return;
    }
    T.status = 'loading';
    changed();
    try {
      conn = await C.connect(cfg(), { anonymous: false });
      await conn.F.getRedirectResult(conn.auth).catch((e) => console.warn(e));
      if (isGoogle(conn.auth.currentUser)) await loadMembership();
      else T.status = 'signed-out';
    } catch (e) {
      console.error(e);
      T.status = 'error';
      T.error = T.explain(e);
    }
    if (T.status !== 'member') readyResolve();
    changed();
  };

  async function loadMembership() {
    const u = conn.auth.currentUser;
    T.user = { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || (u.email || '').split('@')[0], photo: u.photoURL || '' };
    T.status = 'loading';
    changed();
    const { F, db } = conn;
    try {
      const m = await F.getDoc(F.doc(db, 'members', T.user.email));
      if (m.exists()) {
        T.role = m.data().role;
        const team = await F.getDoc(F.doc(db, 'team', 'settings')).catch(() => null);
        T.teamName = (team && team.exists() && team.data().name) || '';
        T.status = 'member';
        watchBoards();
        return;
      }
      const team = await F.getDoc(F.doc(db, 'team', 'settings'));
      T.status = team.exists() ? 'not-approved' : 'no-team';
    } catch (e) {
      console.error(e);
      T.status = 'error';
      T.error = T.explain(e);
    }
    readyResolve();
    changed();
  }

  T.canSignIn = () => location.protocol !== 'file:' || !!(cfg() && cfg().emulator);

  T.signIn = async function () {
    if (!cfg()) {
      SB.share.open({ setup: true });
      return;
    }
    if (!T.canSignIn()) {
      await U.choose({
        title: 'Sign in on the hosted version',
        message: `Google sign-in only works when the app is opened from a web address, not from a file on your computer. Open ${SB.cloud.DEFAULT_REVIEW_PAGE.replace(/review\.html$/, '')} and sign in there.`,
        buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }],
      });
      return;
    }
    try {
      conn = conn || (await C.connect(cfg(), { anonymous: false }));
      const { F, auth } = conn;
      if (cfg().emulator) {
        // Local test emulator only: sign in as any email (no real Google account involved).
        const r = await U.choose({ title: 'Sign in (test emulator)', message: 'Email for a test Google account:', input: { placeholder: 'you@example.com' }, buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'ok', label: 'Sign in', kind: 'primary' }] });
        if (!r || r.id !== 'ok' || !r.value.trim()) return;
        const email = r.value.trim().toLowerCase();
        await F.signInWithCredential(auth, F.GoogleAuthProvider.credential(JSON.stringify({ sub: 'emu-' + email, email, email_verified: true, name: email.split('@')[0] })));
      } else {
        const provider = new F.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
          await F.signInWithPopup(auth, provider);
        } catch (e) {
          if (e.code === 'auth/popup-blocked') {
            await F.signInWithRedirect(auth, provider);
            return;
          }
          throw e;
        }
      }
      await loadMembership();
      if (T.status === 'member') U.toast(`Signed in as ${T.user.email}`);
    } catch (e) {
      if (/popup-closed-by-user|cancelled-popup-request/.test(e.code || '')) return;
      console.error(e);
      U.toast('Sign-in didn’t work: ' + T.explain(e), { type: 'error', duration: 12000 });
    }
  };

  T.signOut = async function () {
    if (session) await SB.app.go(null);
    stopWatching();
    // Team storyboards cached on this computer go too, so the next person here can't see them.
    for (const r of S.listProjects()) if (r.team) await S.forgetProject(r.id);
    S.gcImages();
    if (conn) await conn.F.signOut(conn.auth).catch(() => {});
    T.user = null;
    T.role = null;
    T.boards = [];
    T.status = 'signed-out';
    changed();
  };

  T.setupTeam = async function (name) {
    const { F, db } = conn;
    const batch = F.writeBatch(db);
    batch.set(F.doc(db, 'team', 'settings'), { name: name || 'Our team', createdBy: T.user.uid, createdAt: F.serverTimestamp() });
    batch.set(F.doc(db, 'members', T.user.email), { email: T.user.email, role: 'admin', name: T.user.name || '', addedBy: T.user.email, addedAt: F.serverTimestamp() });
    await batch.commit();
    await loadMembership();
  };

  function stopWatching() {
    if (unsubBoards) unsubBoards();
    if (unsubMembers) unsubMembers();
    unsubBoards = unsubMembers = null;
  }

  function watchBoards() {
    if (unsubBoards) return;
    const { F, db } = conn;
    unsubBoards = F.onSnapshot(
      F.collection(db, 'boards'),
      (snap) => {
        T.boards = snap.docs.map((d) => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' })));
        readyResolve();
        onBoardsChanged();
        changed();
      },
      (e) => {
        console.error(e);
        T.status = 'error';
        T.error = T.explain(e);
        readyResolve();
        changed();
      }
    );
  }

  /* ---------- Members (admins approve people) ---------- */

  T.watchMembers = function () {
    if (unsubMembers || !T.isMember()) return;
    const { F, db } = conn;
    unsubMembers = F.onSnapshot(F.collection(db, 'members'), (snap) => {
      T.members = snap.docs.map((d) => d.data()).sort((a, b) => U.naturalCompare(a.email, b.email));
      changed();
    });
  };

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  T.addMember = async function (email, role) {
    email = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error('That doesn’t look like an email address.');
    const { F, db } = conn;
    await F.setDoc(F.doc(db, 'members', email), { email, role: role === 'admin' ? 'admin' : 'member', name: '', addedBy: T.user.email, addedAt: F.serverTimestamp() });
  };
  T.setRole = (email, role) => conn.F.updateDoc(conn.F.doc(conn.db, 'members', email), { role });
  T.removeMember = (email) => conn.F.deleteDoc(conn.F.doc(conn.db, 'members', email));

  /* ---------- Locks ---------- */

  T.board = (id) => T.boards.find((b) => b.id === id) || null;
  T.isTeamBoard = (id) => T.isMember() && !!T.board(id);
  T.sessionId = () => (session ? session.id : null);
  T.isEditing = () => !!(session && session.editing);

  /** 'free' | 'mine' (this tab) | 'me-elsewhere' (my other tab/computer) | 'other' */
  T.lockState = function (board) {
    const l = board && board.lock;
    if (!l || !T.user) return 'free';
    if (Date.now() - millis(l.beat) > LOCK_FRESH_MS) return 'free';
    if (l.uid === T.user.uid) return l.session === SESSION ? 'mine' : 'me-elsewhere';
    return 'other';
  };

  function lockValue() {
    return { uid: T.user.uid, name: T.user.name || T.user.email, email: T.user.email, session: SESSION, beat: conn.F.serverTimestamp() };
  }
  const boardRef = (id) => conn.F.doc(conn.db, 'boards', id);
  const takeLock = (id) => conn.F.updateDoc(boardRef(id), { lock: lockValue() });
  async function releaseLock(id) {
    const b = T.board(id);
    if (b && b.lock && b.lock.session !== SESSION) return;
    await conn.F.updateDoc(boardRef(id), { lock: null });
  }

  /* ---------- Images ---------- */

  /** Shrink an image until it fits in one Firestore document. Returns {bytes: Uint8Array, type}. */
  async function fitForCloud(blob) {
    if (blob.size <= MAX_IMAGE_BYTES && /^image\/(jpeg|png|webp|gif)$/.test(blob.type)) {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
    }
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read an image'));
      i.src = url;
    });
    URL.revokeObjectURL(url);
    let side = Math.min(2400, Math.max(img.naturalWidth, img.naturalHeight));
    let quality = 0.86;
    for (let i = 0; i < 10; i++) {
      const s = side / Math.max(img.naturalWidth, img.naturalHeight);
      const c = S.scaleToCanvas(img, Math.round(img.naturalWidth * s), Math.round(img.naturalHeight * s), true);
      const out = await S.canvasToBlob(c, 'image/jpeg', quality);
      if (out.size <= MAX_IMAGE_BYTES) return { bytes: new Uint8Array(await out.arrayBuffer()), type: 'image/jpeg' };
      if (quality > 0.62) quality -= 0.08;
      else side = Math.round(side * 0.82);
    }
    throw new Error('An image is too large to store.');
  }

  async function uploadImage(boardId, imageId) {
    const blob = await S.getImageBlob(imageId);
    if (!blob) return 0;
    const { bytes, type } = await fitForCloud(blob);
    await conn.F.setDoc(conn.F.doc(conn.db, 'boards', boardId, 'images', imageId), { data: conn.F.Bytes.fromUint8Array(bytes), type, size: bytes.length });
    return bytes.length;
  }

  /** Download a team storyboard (and any images not already on this computer). */
  async function fetchBoard(id, onProgress) {
    const { F, db } = conn;
    const snap = await F.getDocFromServer(F.doc(db, 'boards', id, 'data', 'main'));
    const d = snap.exists() ? snap.data() : {};
    let parsed = {};
    try {
      parsed = d.json ? JSON.parse(d.json) : {};
    } catch (e) {
      console.error('Damaged storyboard data', e);
    }
    const project = S.normalizeProject(parsed);
    project.uid = id;
    const missing = [];
    for (const imgId of S.imageIdsOf(project)) if (!(await S.hasImage(imgId))) missing.push(imgId);
    let done = 0;
    const worker = async () => {
      while (missing.length) {
        const imgId = missing.shift();
        const im = await F.getDoc(F.doc(db, 'boards', id, 'images', imgId)).catch(() => null);
        if (im && im.exists()) {
          const v = im.data();
          await S.cacheImage(imgId, new Blob([v.data.toUint8Array()], { type: v.type || 'image/jpeg' }));
        }
        if (onProgress) onProgress(++done);
      }
    };
    const total = missing.length;
    if (onProgress && total) onProgress(0, total);
    await Promise.all([worker(), worker(), worker()]);
    return { project, rev: d.rev || 0, sizes: new Map(Object.entries(d.images || {})), total };
  }

  function boardMeta(project, thumb) {
    return {
      title: project.title || '',
      client: (project.cover && project.cover.client) || '',
      frames: project.frames.length,
      aspect: project.aspect,
      shared: !!project.review,
      reviewBytes: (project.review && project.review.bytes) || 0,
      thumb: thumb || null,
    };
  }

  /** Create a team storyboard from a project whose images are on this computer. Leaves it unlocked. */
  async function uploadBoard(project, thumb, onProgress) {
    const { F, db } = conn;
    const id = project.uid;
    const now = F.serverTimestamp();
    const me = T.user.name || T.user.email;
    await F.setDoc(boardRef(id), Object.assign(boardMeta(project, thumb), { createdAt: now, createdBy: me, updatedAt: now, updatedBy: me, bytes: 0, lock: lockValue() }));
    const sizes = {};
    const ids = [...S.imageIdsOf(project)];
    let n = 0;
    for (const imgId of ids) {
      const size = await uploadImage(id, imgId);
      if (size) sizes[imgId] = size;
      if (onProgress) onProgress(++n, ids.length);
    }
    const json = JSON.stringify(project);
    await F.setDoc(F.doc(db, 'boards', id, 'data', 'main'), { json, images: sizes, rev: 1, savedAt: now, savedBy: me });
    const bytes = json.length + Object.values(sizes).reduce((a, b) => a + b, 0) + (thumb ? thumb.length : 0);
    await F.updateDoc(boardRef(id), { bytes, lock: lockValue() });
    await F.updateDoc(boardRef(id), { lock: null });
    return { rev: 1, sizes };
  }

  /* ---------- Creating, moving, duplicating, deleting ---------- */

  T.createBoard = async function () {
    const project = S.newProject();
    await uploadBoard(project, null);
    await S.cacheProject(project.uid, project, { team: true, cloudPending: false, baseRev: 1, createdHere: true });
    return project.uid;
  };

  T.moveToTeam = async function (id) {
    const rec = S.recordFor(id);
    if (!rec || rec.team) return null;
    const project = S.normalizeProject(JSON.parse(JSON.stringify(rec.data)));
    project.uid = T.board(id) ? U.uid('p') : id;
    const progress = U.toast('Moving to the team…', { duration: 0 });
    try {
      await uploadBoard(project, rec.thumb, (n, total) => progress.update(`Uploading images… ${n} of ${total}`));
      if (project.uid !== id) await S.forgetProject(id);
      await S.cacheProject(project.uid, project, { team: true, cloudPending: false, baseRev: 1, thumb: rec.thumb, thumbKey: rec.thumbKey });
      progress.close();
      return project.uid;
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast('Couldn’t move it to the team: ' + T.explain(e), { type: 'error', duration: 9000 });
      return null;
    }
  };

  T.duplicateBoard = async function (id) {
    const board = T.board(id);
    const progress = U.toast('Duplicating…', { duration: 0 });
    try {
      const { project } = await fetchBoard(id);
      project.uid = U.uid('p');
      project.review = null;
      project.title = (project.title || 'Untitled storyboard') + ' (copy)';
      await uploadBoard(project, board && board.thumb, (n, total) => progress.update(`Copying images… ${n} of ${total}`));
      await S.cacheProject(project.uid, project, { team: true, cloudPending: false, baseRev: 1, thumb: board && board.thumb });
      progress.close();
      return project.uid;
    } catch (e) {
      progress.close();
      console.error(e);
      U.toast('Couldn’t duplicate it: ' + T.explain(e), { type: 'error', duration: 9000 });
      return null;
    }
  };

  /** Download a team storyboard to this computer (e.g. to save it as a project file). */
  T.download = async function (id) {
    const board = T.board(id);
    const { project, rev } = await fetchBoard(id);
    await S.cacheProject(id, project, { team: true, cloudPending: false, baseRev: rev, thumb: board && board.thumb });
  };

  T.deleteBoard = async function (id, opts) {
    opts = opts || {};
    const board = T.board(id);
    if (!board) return false;
    const title = board.title || 'Untitled storyboard';
    const state = T.lockState(board);
    if (!opts.silent) {
      const ok = await U.confirm(
        `Delete “${title}” for everyone?`,
        'This permanently deletes the storyboard from the team, for everyone.' +
          (state === 'other' ? ` ${board.lock.name} is editing it right now.` : '') +
          (board.shared ? ' Its client link will also be turned off and the comments on it deleted.' : '') +
          ' If you might need it later, save a project file first (⋯ → Save project file).',
        'Delete for everyone',
        true
      );
      if (!ok) return false;
    }
    const progress = opts.silent ? null : U.toast('Deleting…', { duration: 0 });
    try {
      const { F, db } = conn;
      await takeLock(id);
      if (board.shared) {
        const d = await F.getDoc(F.doc(db, 'boards', id, 'data', 'main'));
        const review = d.exists() ? S.normalizeProject(JSON.parse(d.data().json || '{}')).review : null;
        if (review) {
          try {
            await SB.share.deleteOnline(review);
          } catch (e) {
            console.error(e);
            const anyway = await U.confirm('Couldn’t turn off the client link', C.explainError(e) + '\n\nDelete the storyboard anyway? Its client link will keep working.', 'Delete anyway', true);
            if (!anyway) {
              await releaseLock(id).catch(() => {});
              if (progress) progress.close();
              return false;
            }
          }
        }
      }
      const imgs = await F.getDocs(F.collection(db, 'boards', id, 'images'));
      for (const d of imgs.docs) await F.deleteDoc(d.ref);
      await F.deleteDoc(F.doc(db, 'boards', id, 'data', 'main'));
      await F.deleteDoc(boardRef(id));
      await S.forgetProject(id);
      S.gcImages();
      if (progress) progress.close();
      if (!opts.silent) U.toast(`Deleted “${title}”`);
      return true;
    } catch (e) {
      if (progress) progress.close();
      console.error(e);
      U.toast('Couldn’t delete it: ' + T.explain(e), { type: 'error', duration: 9000 });
      return false;
    }
  };

  /* ---------- Opening and editing (one editor at a time) ---------- */

  /** Open a team storyboard for editing (or view-only if someone else is editing). Returns false if cancelled. */
  T.open = async function (id) {
    if (session && session.id !== id) await T.close();
    const board = T.board(id);
    if (!board) return false;
    let edit = true;
    const state = T.lockState(board);
    if (state === 'other' || state === 'me-elsewhere') {
      const who = state === 'other' ? board.lock.name || board.lock.email : null;
      const r = await U.choose({
        title: who ? `${who} is editing this storyboard` : 'You’re already editing this storyboard',
        message:
          (who ? 'Only one person can edit at a time. ' : 'It’s open for editing in another tab or on another computer. ') +
          'You can view it now (it updates live) and edit when they’re done, or take over. If you take over, they’re switched to view-only, and anything they changed in the last few seconds might not be saved.',
        buttons: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'take', label: 'Take over' },
          { id: 'view', label: 'View only', kind: 'primary' },
        ],
      });
      if (!r || r === 'cancel') return false;
      edit = r === 'take';
    }
    const progress = U.toast('Opening storyboard…', { duration: 0 });
    try {
      if (edit) await takeLock(id);
      const cached = S.recordFor(id);
      const fetched = await fetchBoard(id, (n, total) => progress.update(total ? `Downloading images… ${n} of ${total}` : 'Opening storyboard…'));
      let project = fetched.project;
      let rev = fetched.rev;
      let uploadNow = false;
      if (cached && cached.team && cached.cloudPending) {
        // Changes made here that never reached the team (e.g. the tab was closed right after editing).
        if (edit && (cached.baseRev || 0) === fetched.rev) {
          project = S.normalizeProject(JSON.parse(JSON.stringify(cached.data)));
          project.uid = id;
          uploadNow = true;
        } else {
          const copyId = await S.duplicateProject(id);
          U.toast(`Changes you made here that hadn’t reached the team were kept on this computer as “${(S.recordFor(copyId) || {}).title || 'a copy'}”.`, { duration: 12000 });
        }
      }
      await S.cacheProject(id, project, { team: true, cloudPending: uploadNow, baseRev: rev, updatedAt: millis(board.updatedAt) || Date.now(), thumb: board.thumb || (cached && cached.thumb) || null });
      if (S.currentId === id) await S.replaceProject(project);
      else await S.openProject(id);
      startSession(id, edit, rev, fetched.sizes, !!(cached && cached.createdHere));
      progress.close();
      if (uploadNow) {
        session.dirty = true;
        await cloudSave();
        U.toast('Uploaded changes that hadn’t reached the team yet.');
      }
      return true;
    } catch (e) {
      progress.close();
      console.error(e);
      if (edit) releaseLock(id).catch(() => {});
      U.toast('Couldn’t open this storyboard: ' + T.explain(e), { type: 'error', duration: 9000 });
      return false;
    }
  };

  function startSession(id, editing, rev, sizes, createdHere) {
    endSession();
    session = { id, editing, rev, sizes: sizes || new Map(), dirty: false, timer: null, unsubData: null, idle: false, createdHere, lastActivity: Date.now() };
    S.setReadOnly(!editing);
    if (editing) session.timer = setInterval(heartbeat, HEARTBEAT_MS);
    else watchData();
    setCloudState(editing ? 'saved' : 'viewing');
    renderBar();
  }

  function endSession() {
    if (!session) return;
    clearInterval(session.timer);
    if (session.unsubData) session.unsubData();
    saveSoon.cancel();
    session = null;
    S.setReadOnly(false);
    setCloudState('');
    renderBar();
  }

  /** Leave the open team storyboard: finish saving and unlock it. */
  T.close = async function () {
    if (!session) return;
    const s = session;
    if (s.editing) {
      await S.flushSave();
      await flushCloud();
      await releaseLock(s.id).catch((e) => console.warn(e));
    }
    endSession();
  };

  /** Was this a brand-new storyboard that the person left without adding anything? */
  T.createdHere = () => !!(session && session.createdHere);

  function watchData() {
    const { F, db } = conn;
    const id = session.id;
    session.unsubData = F.onSnapshot(F.doc(db, 'boards', id, 'data', 'main'), async (snap) => {
      if (!session || session.id !== id || session.editing || !snap.exists()) return;
      const d = snap.data();
      if ((d.rev || 0) <= session.rev) return;
      try {
        const fetched = await fetchBoard(id);
        if (!session || session.id !== id || session.editing) return;
        session.rev = fetched.rev;
        session.sizes = fetched.sizes;
        await S.cacheProject(id, fetched.project, { team: true, cloudPending: false, baseRev: fetched.rev });
        await S.replaceProject(fetched.project);
      } catch (e) {
        console.warn('Live update failed', e);
      }
    });
  }

  async function heartbeat() {
    if (!session || !session.editing) return;
    if (Date.now() - session.lastActivity > IDLE_MS) {
      await goIdle();
      return;
    }
    takeLock(session.id).catch((e) => console.warn('Heartbeat failed', e));
  }

  async function goIdle() {
    const id = session.id;
    await S.flushSave();
    await flushCloud();
    await releaseLock(id).catch(() => {});
    clearInterval(session.timer);
    session.editing = false;
    session.idle = true;
    S.setReadOnly(true);
    watchData();
    setCloudState('viewing');
    renderBar();
  }

  /** Switch from view-only to editing (taking over if someone else is editing). */
  T.startEditing = async function () {
    if (!session || session.editing) return;
    const id = session.id;
    const board = T.board(id);
    const state = T.lockState(board);
    if (state === 'other' || state === 'me-elsewhere') {
      const who = state === 'other' ? board.lock.name || board.lock.email : 'You (in another tab or on another computer)';
      const ok = await U.confirm(`Take over from ${who}?`, 'They’ll be switched to view-only, and anything they changed in the last few seconds might not be saved.', 'Take over');
      if (!ok) return;
    }
    try {
      await takeLock(id);
      const fetched = await fetchBoard(id);
      await S.cacheProject(id, fetched.project, { team: true, cloudPending: false, baseRev: fetched.rev });
      await S.replaceProject(fetched.project);
      if (session.unsubData) session.unsubData();
      Object.assign(session, { editing: true, idle: false, rev: fetched.rev, sizes: fetched.sizes, unsubData: null, lastActivity: Date.now() });
      session.timer = setInterval(heartbeat, HEARTBEAT_MS);
      S.setReadOnly(false);
      setCloudState('saved');
      renderBar();
    } catch (e) {
      console.error(e);
      U.toast('Couldn’t start editing: ' + T.explain(e), { type: 'error' });
    }
  };

  function onBoardsChanged() {
    if (!session) return;
    const board = T.board(session.id);
    if (!board) {
      const id = session.id;
      endSession();
      U.toast('This storyboard was deleted by a teammate.', { type: 'error', duration: 8000 });
      S.forgetProject(id);
      SB.app.go(null);
      return;
    }
    if (session.editing && board.lock && board.lock.session !== SESSION && Date.now() - millis(board.lock.beat) < LOCK_FRESH_MS) {
      lostLock(board);
      return;
    }
    renderBar();
  }

  async function lostLock(board) {
    const id = session.id;
    const hadUnsaved = session.dirty;
    clearInterval(session.timer);
    saveSoon.cancel();
    session.editing = false;
    S.setReadOnly(true);
    if (hadUnsaved) {
      await S.flushSave();
      const copyId = await S.duplicateProject(id);
      U.toast(`${board.lock.name} took over editing. Your latest changes hadn’t reached the team, so they were kept on this computer as “${(S.recordFor(copyId) || {}).title || 'a copy'}”.`, { duration: 14000 });
    } else {
      U.toast(`${board.lock.name} took over editing. You’re now viewing.`, { duration: 7000 });
    }
    session.rev = -1; // pick up their version
    watchData();
    setCloudState('viewing');
    renderBar();
  }

  /* ---------- Saving to the team ---------- */

  let saving = null;
  const saveSoon = U.debounce(() => cloudSave(), SAVE_DELAY_MS);

  // Called after every local save of the open storyboard.
  S.afterSave = function (rec) {
    if (!session || !session.editing || rec.id !== session.id) return;
    session.dirty = true;
    session.lastActivity = Date.now();
    S.setRecordMeta(rec.id, { cloudPending: true, baseRev: session.rev });
    setCloudState(navigator.onLine === false ? 'offline' : 'saving');
    saveSoon();
  };

  async function flushCloud() {
    saveSoon.cancel();
    if (saving) await saving.catch(() => {});
    if (session && session.editing && session.dirty) await cloudSave().catch(() => {});
  }

  function cloudSave() {
    if (saving) return saving.then(() => cloudSave());
    saving = doCloudSave().finally(() => (saving = null));
    return saving;
  }

  async function doCloudSave() {
    if (!session || !session.editing || !session.dirty) return;
    const s = session;
    const id = s.id;
    const { F, db } = conn;
    s.dirty = false;
    const project = JSON.parse(JSON.stringify(S.project));
    setCloudState('saving');
    try {
      const refs = S.imageIdsOf(project);
      for (const imgId of refs) {
        if (s.sizes.has(imgId)) continue;
        const size = await uploadImage(id, imgId);
        if (size) s.sizes.set(imgId, size);
      }
      for (const imgId of [...s.sizes.keys()]) {
        if (refs.has(imgId)) continue;
        await F.deleteDoc(F.doc(db, 'boards', id, 'images', imgId)).catch(() => {});
        s.sizes.delete(imgId);
      }
      const json = JSON.stringify(project);
      const rev = s.rev + 1;
      const me = T.user.name || T.user.email;
      await F.setDoc(F.doc(db, 'boards', id, 'data', 'main'), { json, images: Object.fromEntries(s.sizes), rev, savedAt: F.serverTimestamp(), savedBy: me });
      const rec = S.recordFor(id);
      const thumb = (rec && rec.thumb) || null;
      const bytes = json.length + [...s.sizes.values()].reduce((a, b) => a + b, 0) + (thumb ? thumb.length : 0);
      await F.updateDoc(boardRef(id), Object.assign(boardMeta(project, thumb), { bytes, updatedAt: F.serverTimestamp(), updatedBy: me, lock: lockValue() }));
      s.rev = rev;
      if (!s.dirty) S.setRecordMeta(id, { cloudPending: false, baseRev: rev });
      if (session === s) setCloudState(s.dirty ? 'saving' : 'saved');
    } catch (e) {
      console.error('Saving to the team failed', e);
      s.dirty = true;
      if (e.code === 'permission-denied') {
        const board = T.board(id);
        if (board && board.lock && board.lock.session !== SESSION && session === s && s.editing) {
          lostLock(board);
          return;
        }
      }
      if (session === s) {
        setCloudState(navigator.onLine === false || /unavailable/.test(e.code || '') ? 'offline' : 'error');
        setTimeout(() => session === s && s.editing && s.dirty && saveSoon(), 15000);
      }
    }
  }

  window.addEventListener('online', () => session && session.editing && session.dirty && saveSoon());
  // Let others edit as soon as this tab closes (best effort; otherwise the lock expires after a few minutes).
  window.addEventListener('pagehide', () => {
    if (session && session.editing && conn) conn.F.updateDoc(boardRef(session.id), { lock: null }).catch(() => {});
  });
  ['pointerdown', 'keydown'].forEach((type) =>
    document.addEventListener(type, () => {
      if (session) session.lastActivity = Date.now();
    }, { passive: true, capture: true })
  );

  /* ---------- Status shown in the editor ---------- */

  function setCloudState(state) {
    T.cloudState = state;
    if (SB.app && SB.app.showCloudState) SB.app.showCloudState(state);
  }

  function renderBar() {
    const bar = document.getElementById('team-bar');
    if (!bar) return;
    if (!session || session.editing) {
      bar.hidden = true;
      document.body.classList.toggle('is-readonly', false);
      return;
    }
    document.body.classList.toggle('is-readonly', true);
    const board = T.board(session.id);
    const state = T.lockState(board);
    let text;
    let action;
    if (session.idle && state === 'free') {
      text = 'You were away for a while, so this storyboard was unlocked for others.';
      action = 'Continue editing';
    } else if (state === 'other') {
      text = `View only: ${board.lock.name || board.lock.email} is editing this storyboard. You’ll see their changes as they make them.`;
      action = 'Take over';
    } else if (state === 'me-elsewhere') {
      text = 'View only: you’re editing this storyboard in another tab or on another computer.';
      action = 'Edit here instead';
    } else {
      text = 'View only. Nobody is editing this storyboard right now.';
      action = 'Start editing';
    }
    bar.replaceChildren(U.h('span', { class: 'team-bar-icon', html: U.icon('eye', 16) }), U.h('span', { class: 'team-bar-text', text }), U.h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: action, onclick: () => T.startEditing() }));
    bar.hidden = false;
  }
  setInterval(() => session && !session.editing && renderBar(), 30000);

  /* ---------- Storage use (free plan: 1 GB) ---------- */

  T.usage = function () {
    let raw = 0;
    let frames = 0;
    for (const b of T.boards) {
      raw += (b.bytes || 0) + (b.reviewBytes || 0) + 2000;
      frames += b.frames || 0;
    }
    const used = Math.round(raw * 1.08); // indexes and document overhead
    const perFrame = frames ? Math.max(250 * 1024, used / frames) : 400 * 1024; // real photos are usually 250 KB+ per frame
    return { used, limit: T.LIMIT, frames, framesLeft: Math.max(0, Math.floor((T.LIMIT - used) / perFrame)), boards: T.boards.length };
  };

  /* ---------- Team members dialog ---------- */

  T.copyLink = async function () {
    const link = SB.share.teamLink();
    if (!link) return;
    U.toast((await U.copyText(link)) ? 'Team link copied. Teammates open it, sign in with Google, then an admin approves them.' : 'Couldn’t copy the link', { duration: 7000 });
  };

  T.openMembers = function () {
    T.watchMembers();
    const dlg = U.h('dialog', { class: 'modal' });
    const list = U.h('ul', { class: 'member-list' });
    const body = U.h(
      'div',
      { class: 'modal-body' },
      U.h('p', { class: 'muted small', text: T.isAdmin() ? 'Approve teammates by adding the email address they sign in to Google with. They can then see and edit all team storyboards. Admins can also approve and remove people.' : 'People who can see and edit the team’s storyboards. Ask an admin to add someone.' })
    );
    const link = SB.share.teamLink();
    if (link) {
      body.append(
        U.h(
          'div',
          { class: 'form-row' },
          U.h('label', { text: 'Team link' }),
          U.h(
            'div',
            { class: 'link-box' },
            U.h('input', { class: 'input', type: 'text', readonly: true, value: link, 'aria-label': 'Team link', onfocus: (e) => e.target.select() }),
            U.h('button', { type: 'button', class: 'btn btn-ghost', html: U.icon('copy', 15) + '<span>Copy</span>', onclick: () => T.copyLink() })
          ),
          U.h('span', { class: 'muted small', text: T.isAdmin() ? 'Send this to teammates. It sets up the app on their computer. Then they sign in with Google, and you approve their email below.' : 'Send this to teammates. It sets up the app on their computer. Then they sign in with Google, and an admin approves them.' })
        )
      );
    }
    if (T.isAdmin()) {
      // Built once, so live updates to the list never clear what's being typed.
      const email = U.h('input', { class: 'input', type: 'email', placeholder: 'teammate@gmail.com', 'aria-label': 'Email to approve' });
      const role = U.h('select', { class: 'input', 'aria-label': 'Role' }, U.h('option', { value: 'member', text: 'Member' }), U.h('option', { value: 'admin', text: 'Admin' }));
      const add = U.h('button', { type: 'button', class: 'btn btn-primary', text: 'Approve' });
      const submit = async () => {
        try {
          add.disabled = true;
          await T.addMember(email.value, role.value);
          U.toast(`Approved ${email.value.trim().toLowerCase()}`);
          email.value = '';
        } catch (err) {
          U.toast(err.code ? T.explain(err) : err.message, { type: 'error' });
        } finally {
          add.disabled = false;
        }
      };
      add.addEventListener('click', submit);
      email.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      body.append(U.h('div', { class: 'form-row member-approve' }, U.h('label', { text: 'Approve a teammate' }), U.h('div', { class: 'member-add' }, email, role, add)));
    }
    body.append(U.h('div', { class: 'form-row member-approve' }, U.h('label', { text: 'Members' }), list));
    let lastSig = '';
    const renderList = () => {
      const sig = JSON.stringify(T.members) + T.role;
      if (sig === lastSig) return;
      lastSig = sig;
      list.replaceChildren();
      for (const m of T.members) {
        const me = T.user && m.email === T.user.email;
        const role = T.isAdmin() && !me
          ? U.h('select', { class: 'input input-sm', 'aria-label': `Role for ${m.email}`, onchange: (e) => T.setRole(m.email, e.target.value).catch((err) => U.toast(T.explain(err), { type: 'error' })) }, U.h('option', { value: 'member', text: 'Member', selected: m.role !== 'admin' }), U.h('option', { value: 'admin', text: 'Admin', selected: m.role === 'admin' }))
          : U.h('span', { class: 'muted small', text: m.role === 'admin' ? 'Admin' : 'Member' });
        list.append(
          U.h(
            'li',
            { class: 'member-row' },
            U.h('div', { class: 'avatar', style: `background:${U.avatarColor(m.email)}`, text: U.initials(m.name || m.email) }),
            U.h('div', { class: 'member-email' }, U.h('span', { text: m.email }), me ? U.h('span', { class: 'muted small', text: ' (you)' }) : null),
            role,
            T.isAdmin() && !me
              ? U.h('button', {
                  type: 'button',
                  class: 'icon-btn icon-btn-sm danger',
                  title: 'Remove',
                  'aria-label': `Remove ${m.email}`,
                  html: U.icon('trash', 16),
                  onclick: async () => {
                    if (await U.confirm(`Remove ${m.email}?`, 'They’ll no longer be able to see or edit team storyboards.', 'Remove', true)) T.removeMember(m.email).catch((err) => U.toast(T.explain(err), { type: 'error' }));
                  },
                })
              : U.h('span')
          )
        );
      }
      if (!T.members.length) list.append(U.h('li', { class: 'muted small', text: 'Loading…' }));
    };
    const unsub = T.subscribe(renderList);
    renderList();
    dlg.append(U.h('div', { class: 'modal-head' }, U.h('h2', { text: T.teamName ? `Team members · ${T.teamName}` : 'Team members' })), body, U.h('div', { class: 'modal-foot' }, U.h('button', { type: 'button', class: 'btn btn-primary', text: 'Done', onclick: () => dlg.close() })));
    dlg.addEventListener('close', () => {
      unsub();
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
  };
})(window.SB);
