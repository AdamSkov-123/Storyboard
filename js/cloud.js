/* Storyboard Maker — Firebase connection and review/comment data access (shared by the app and review page). */
(function (SB) {
  'use strict';
  const U = SB.util;
  const C = (SB.cloud = {});

  /** Where clients open review links when the app itself isn't hosted (e.g. opened from disk). */
  C.DEFAULT_REVIEW_PAGE = 'https://adamskov-123.github.io/Storyboard/review.html';
  C.FIREBASE_SCRIPT = 'js/vendor/firebase.js';

  C.defaultReviewPage = function () {
    if (/^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      return new URL('review.html', location.href).href.split('#')[0];
    }
    return C.DEFAULT_REVIEW_PAGE;
  };

  /** Pull apiKey and projectId out of a pasted Firebase config snippet (JS object or JSON). */
  C.parseConfig = function (text) {
    const s = String(text || '');
    const get = (k) => {
      const m = new RegExp(`["']?${k}["']?\\s*[:=]\\s*["']([^"']+)["']`).exec(s);
      return m ? m[1].trim() : '';
    };
    const apiKey = get('apiKey');
    const projectId = get('projectId');
    return apiKey && projectId ? { apiKey, projectId } : null;
  };

  /* ---------- Connection ---------- */

  const conns = new Map();

  /** cfg: {apiKey, projectId, emulator?}. Signs in anonymously (the same browser keeps the same identity). */
  C.connect = function (cfg) {
    const key = [cfg.projectId, cfg.apiKey, cfg.emulator || ''].join('|');
    if (!conns.has(key)) {
      const p = (async () => {
        await U.loadScript(C.FIREBASE_SCRIPT);
        const F = window.SBFirebase;
        const name = 'sb-' + key.replace(/[^a-z0-9-]/gi, '_');
        const app = F.initializeApp({ apiKey: cfg.apiKey, projectId: cfg.projectId, authDomain: cfg.projectId + '.firebaseapp.com' }, name);
        try {
          const auth = F.getAuth(app);
          const db = F.initializeFirestore(app, {});
          if (cfg.emulator) {
            F.connectAuthEmulator(auth, `http://${cfg.emulator}:9099`, { disableWarnings: true });
            F.connectFirestoreEmulator(db, cfg.emulator, 8080);
          }
          await auth.authStateReady();
          if (!auth.currentUser) await F.signInAnonymously(auth);
          return {
            F,
            app,
            auth,
            db,
            cfg,
            get uid() {
              return auth.currentUser ? auth.currentUser.uid : null;
            },
          };
        } catch (e) {
          // Start from scratch on the next attempt (e.g. after fixing a setting or reconnecting).
          F.deleteApp(app).catch(() => {});
          throw e;
        }
      })();
      conns.set(key, p);
      p.catch(() => conns.delete(key));
    }
    return conns.get(key);
  };

  C.explainError = function (e) {
    const code = (e && e.code) || '';
    const msg = (e && e.message) || String(e);
    if (/operation-not-allowed|admin-restricted-operation/.test(code)) {
      return 'Anonymous sign-in is turned off. In the Firebase console open Authentication → Sign-in method and enable “Anonymous”.';
    }
    if (/api-key|invalid-api-key/.test(code) || /API key not valid/i.test(msg)) {
      return 'Firebase rejected the API key. Copy the config again from Project settings → Your apps.';
    }
    if (/network-request-failed|unavailable/.test(code) || /offline/i.test(msg)) {
      return 'Couldn’t reach Firebase. Check your internet connection and try again.';
    }
    if (/permission-denied/.test(code)) {
      return 'Firebase refused access. Make sure the security rules from this app are published (Firestore Database → Rules).';
    }
    if (/not-found|failed-precondition/.test(code) || /database .* does not exist/i.test(msg)) {
      return 'No Firestore database found. In the Firebase console open Firestore Database and click “Create database”.';
    }
    if (/Could not load/.test(msg)) return 'Couldn’t load the Firebase library (js/vendor/firebase.js).';
    return msg;
  };

  /** Check a config end to end: sign-in, database and rules. */
  C.testConnection = async function (cfg) {
    const conn = await C.connect(cfg);
    const { F, db } = conn;
    const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'unavailable' })), 15000));
    await Promise.race([F.getDoc(F.doc(db, 'reviews', '__connection_test__')), timeout]);
    return conn;
  };

  /* ---------- Links ---------- */

  C.reviewLink = function (base, cfg, reviewId) {
    const params = new URLSearchParams({ r: reviewId, p: cfg.projectId, k: cfg.apiKey });
    if (cfg.emulator) params.set('emu', cfg.emulator);
    return base.split('#')[0] + '#' + params.toString();
  };

  C.parseLink = function (hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const reviewId = params.get('r');
    const projectId = params.get('p');
    const apiKey = params.get('k');
    if (!reviewId || !projectId || !apiKey) return null;
    const cfg = { projectId, apiKey };
    if (params.get('emu')) cfg.emulator = params.get('emu');
    return { reviewId, cfg };
  };

  /* ---------- Reading ---------- */

  const withId = (d) => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' }));

  C.watchReview = function (conn, reviewId, onData, onError) {
    const { F, db } = conn;
    return F.onSnapshot(
      F.doc(db, 'reviews', reviewId),
      (snap) => onData(snap.exists() ? withId(snap) : null),
      onError
    );
  };

  C.watchComments = function (conn, reviewId, onData, onError) {
    const { F, db } = conn;
    return F.onSnapshot(F.collection(db, 'reviews', reviewId, 'comments'), (snap) => onData(snap.docs.map(withId)), onError);
  };

  C.fetchImages = async function (conn, reviewId) {
    const { F, db } = conn;
    const snap = await F.getDocs(F.collection(db, 'reviews', reviewId, 'images'));
    const out = new Map();
    snap.forEach((d) => out.set(d.id, d.data()));
    return out;
  };

  C.fetchImage = async function (conn, reviewId, id) {
    const { F, db } = conn;
    const snap = await F.getDoc(F.doc(db, 'reviews', reviewId, 'images', id));
    return snap.exists() ? snap.data() : null;
  };

  /* ---------- Comments ---------- */

  C.addComment = async function (conn, reviewId, data) {
    const { F, db } = conn;
    const ref = F.doc(F.collection(db, 'reviews', reviewId, 'comments'));
    await F.setDoc(
      ref,
      Object.assign(
        {
          authorUid: conn.uid,
          isTeam: false,
          kind: 'comment',
          parentId: null,
          body: '',
          target: null,
          suggestion: null,
          status: 'open',
          edited: false,
        },
        data,
        { createdAt: F.serverTimestamp() }
      )
    );
    return ref.id;
  };

  C.editComment = function (conn, reviewId, id, patch) {
    const { F, db } = conn;
    return F.updateDoc(F.doc(db, 'reviews', reviewId, 'comments', id), Object.assign({}, patch, { edited: true, updatedAt: F.serverTimestamp() }));
  };

  /** Deletes a comment and, for a thread's first comment, its replies. */
  C.deleteComment = async function (conn, reviewId, comment, replies) {
    const { F, db } = conn;
    const batch = F.writeBatch(db);
    for (const r of replies || []) batch.delete(F.doc(db, 'reviews', reviewId, 'comments', r.id));
    batch.delete(F.doc(db, 'reviews', reviewId, 'comments', comment.id));
    await batch.commit();
  };

  C.setStatus = function (conn, reviewId, id, status, by) {
    const { F, db } = conn;
    return F.updateDoc(F.doc(db, 'reviews', reviewId, 'comments', id), {
      status,
      resolvedAt: status === 'resolved' ? F.serverTimestamp() : null,
      resolvedBy: status === 'resolved' ? by || '' : null,
    });
  };

  /* ---------- Owner operations ---------- */

  /** Prove ownership of a review from this browser by presenting the secret owner key (checked by the rules). */
  C.ensureOwner = async function (conn, reviewId, key) {
    const { F, db } = conn;
    const ref = F.doc(db, 'reviews', reviewId, 'owners', conn.uid);
    const snap = await F.getDoc(ref);
    if (!snap.exists()) await F.setDoc(ref, { key, createdAt: F.serverTimestamp() });
  };

  C.createReview = async function (conn, reviewId, key, payload) {
    const { F, db } = conn;
    const ownerKeyHash = await U.sha256Hex(key);
    await F.setDoc(F.doc(db, 'reviews', reviewId), Object.assign({}, payload, { ownerKeyHash, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() }));
    await C.ensureOwner(conn, reviewId, key);
  };

  C.updateReview = function (conn, reviewId, payload) {
    const { F, db } = conn;
    return F.updateDoc(F.doc(db, 'reviews', reviewId), Object.assign({}, payload, { updatedAt: F.serverTimestamp() }));
  };

  C.putImage = function (conn, reviewId, id, data, rev) {
    const { F, db } = conn;
    return F.setDoc(F.doc(db, 'reviews', reviewId, 'images', id), { data, rev });
  };

  C.deleteImage = function (conn, reviewId, id) {
    const { F, db } = conn;
    return F.deleteDoc(F.doc(db, 'reviews', reviewId, 'images', id));
  };

  C.deleteReview = async function (conn, reviewId) {
    const { F, db } = conn;
    const del = async (path) => {
      const snap = await F.getDocs(F.collection(db, ...path));
      let batch = F.writeBatch(db);
      let n = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref);
        if (++n % 400 === 0) {
          await batch.commit();
          batch = F.writeBatch(db);
        }
      }
      await batch.commit();
    };
    await del(['reviews', reviewId, 'comments']);
    await del(['reviews', reviewId, 'images']);
    await F.deleteDoc(F.doc(db, 'reviews', reviewId));
    await F.deleteDoc(F.doc(db, 'reviews', reviewId, 'owners', conn.uid));
  };

  /* ---------- Shared comment helpers ---------- */

  /** Group flat comments into threads: [{root, replies}], roots ordered by time, each given a pin number. */
  C.threads = function (comments) {
    const time = (c) => {
      const d = U.toDate(c.createdAt);
      return d ? d.getTime() : Date.now();
    };
    const roots = comments.filter((c) => !c.parentId).sort((a, b) => time(a) - time(b));
    const byParent = new Map();
    for (const c of comments) {
      if (!c.parentId) continue;
      if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
      byParent.get(c.parentId).push(c);
    }
    return roots.map((root, i) => ({
      root,
      pin: i + 1,
      replies: (byParent.get(root.id) || []).sort((a, b) => time(a) - time(b)),
    }));
  };

  /** Key used to group a thread: a frame id, 'cover', or 'page'. */
  C.targetKey = function (root) {
    const t = root.target || {};
    if (t.type === 'cover') return 'cover';
    if (t.frameId) return t.frameId;
    if (root.suggestion && root.suggestion.frameId) return root.suggestion.frameId;
    return 'page';
  };

  /** Small, stable fingerprint for change detection. */
  C.hash = function (str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36) + str.length.toString(36);
  };
})(window.SB);
