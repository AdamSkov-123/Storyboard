/* Storyboard Maker — client review page: view the storyboard, pin comments anywhere, suggest edits, reply. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const C = SB.cloud;

  const $ = (id) => document.getElementById(id);
  const NAME_KEY = 'sb-reviewer-name';
  const drafts = SB.threads.Drafts();

  let conn = null;
  let reviewId = null;
  let review = null;
  let comments = [];
  let threads = [];
  const images = new Map(); // id -> {rev, data}
  let commentMode = true;
  let pending = null; // {target, anchorKey, x, y, kind, fieldId?}
  let activeThread = null;
  let showResolved = false;
  let docSig = '';

  /* ---------- Startup ---------- */

  async function start() {
    U.hydrateIcons(document);
    const link = C.parseLink(location.hash);
    if (!link) {
      showState('This link is incomplete', 'Please copy the whole link from the email or message you received.');
      return;
    }
    reviewId = link.reviewId;
    try {
      conn = await C.connect(link.cfg);
    } catch (e) {
      console.error(e);
      showState('Couldn’t open this storyboard', C.explainError(e), true);
      return;
    }
    let first = true;
    C.watchReview(
      conn,
      reviewId,
      async (data) => {
        if (!data) {
          showState('This storyboard isn’t available', 'The link may have been turned off. Ask the team for a new link.');
          return;
        }
        review = data;
        if (first) {
          first = false;
          await loadAllImages();
          initChrome();
        } else {
          await refreshImages();
        }
        renderDoc();
      },
      (e) => showState('Couldn’t open this storyboard', C.explainError(e), true)
    );
    C.watchComments(
      conn,
      reviewId,
      (list) => {
        comments = list;
        threads = C.threads(comments);
        renderPins();
        renderPanel();
      },
      (e) => console.error(e)
    );
  }

  function showState(title, text, retry) {
    $('rv-title').textContent = title;
    $('rv-doc').replaceChildren(
      U.h('div', { class: 'rv-state' }, U.h('h2', { text: title }), U.h('p', { class: 'muted', text }), retry ? U.h('button', { type: 'button', class: 'btn btn-ghost', text: 'Try again', onclick: () => location.reload() }) : null)
    );
    $('rv-panel').hidden = true;
  }

  async function loadAllImages() {
    try {
      const all = await C.fetchImages(conn, reviewId);
      for (const [id, v] of all) if (typeof v.data === 'string' && v.data.startsWith('data:image/')) images.set(id, v);
    } catch (e) {
      console.error(e);
    }
  }

  async function refreshImages() {
    const wanted = review.frames.filter((f) => f.rev).map((f) => [f.id, f.rev]);
    if (review.cover && review.cover.rev) wanted.push(['cover', review.cover.rev]);
    await Promise.all(
      wanted
        .filter(([id, rev]) => !images.has(id) || images.get(id).rev !== rev)
        .map(async ([id]) => {
          const v = await C.fetchImage(conn, reviewId, id).catch(() => null);
          if (v && typeof v.data === 'string' && v.data.startsWith('data:image/')) images.set(id, v);
        })
    );
  }

  let chromeReady = false;
  function initChrome() {
    if (chromeReady) return;
    chromeReady = true;
    $('rv-panel').hidden = false;
    if (!U.storage.get('sb-review-hint-dismissed', false)) $('rv-hint').hidden = false;
    $('rv-hint-close').addEventListener('click', () => {
      $('rv-hint').hidden = true;
      U.storage.set('sb-review-hint-dismissed', true);
    });
    updateNameButton();
    $('rv-name-btn').addEventListener('click', () => askName(true));
    $('rv-mode-btn').addEventListener('click', () => {
      commentMode = !commentMode;
      $('rv-mode-btn').setAttribute('aria-pressed', String(commentMode));
      $('rv-mode-btn').lastElementChild.textContent = commentMode ? 'Commenting on' : 'Commenting off';
      document.body.classList.toggle('rv-browse', !commentMode);
      if (!commentMode) closePopover();
    });
    $('rv-panel-btn').addEventListener('click', () => document.body.classList.toggle('rv-panel-open'));
    $('rv-doc').addEventListener('click', onDocClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('rv-popover').hidden) closePopover();
    });
    document.addEventListener('mousedown', (e) => {
      const pop = $('rv-popover');
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.rv-pin-pending') && !e.target.closest('dialog')) {
        if (pop.dataset.dirty !== '1') closePopover();
      }
    });
    window.addEventListener('resize', U.debounce(positionPopover, 50));
    setInterval(renderPanel, 60000);
  }

  /* ---------- Names ---------- */

  const myName = () => U.storage.get(NAME_KEY, '');

  function updateNameButton() {
    const b = $('rv-name-btn');
    const n = myName();
    b.hidden = !n;
    b.textContent = n ? `Commenting as ${n}` : '';
    b.title = 'Change your name';
  }

  async function askName(change) {
    const r = await U.choose({
      title: change ? 'Change your name' : 'What’s your name?',
      message: change ? 'New comments will use this name.' : 'So the team knows who left each comment. This browser will remember it.',
      input: { value: myName(), placeholder: 'Your name', maxlength: 80 },
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: change ? 'Save' : 'Continue', kind: 'primary' },
      ],
    });
    const name = r && r.id === 'ok' ? r.value.trim().slice(0, 80) : '';
    if (name) {
      U.storage.set(NAME_KEY, name);
      updateNameButton();
    }
    return name || myName() || null;
  }

  async function ensureName() {
    return myName() || (await askName(false));
  }

  /* ---------- Storyboard rendering ---------- */

  const fieldLabel = (fid) => {
    const fd = (review.fields || []).find((f) => f.id === fid);
    return fd ? fd.label : 'Text';
  };
  const frameIndex = (id) => review.frames.findIndex((f) => f.id === id);

  function renderDoc() {
    const sig = JSON.stringify([review.revision, review.title, review.cover, review.frames, review.fields, review.aspect, Array.from(images.values()).map((v) => v.rev)]);
    if (sig === docSig) return;
    docSig = sig;
    document.title = `${review.title} – Review`;
    $('rv-title').textContent = review.title;
    const c = review.cover || {};
    $('rv-sub').textContent = [c.client, c.version, c.date].map((s) => (s || '').trim()).filter(Boolean).join(' · ');
    const doc = $('rv-doc');
    const ratio = (review.aspect && review.aspect.ratio) || 16 / 9;
    doc.style.setProperty('--frame-ratio', ratio);
    const parts = [];
    if (c.include) parts.push(coverSection(review));
    parts.push(
      U.h(
        'div',
        { class: 'rv-grid' },
        review.frames.map((f, i) => frameCard(f, i))
      )
    );
    if (!review.frames.length) parts.push(U.h('p', { class: 'muted rv-state', text: 'This storyboard has no frames yet.' }));
    doc.replaceChildren(...parts);
    renderPins();
  }

  function coverSection(r) {
    const c = r.cover;
    const img = images.get('cover');
    const meta1 = [c.client, c.company].map((s) => (s || '').trim()).filter(Boolean).join(' · ');
    const meta2 = [c.version, c.date].map((s) => (s || '').trim()).filter(Boolean).join(' · ');
    return U.h(
      'section',
      { class: 'rv-cover', dataset: { anchor: 'cover' } },
      img && c.rev ? U.h('img', { src: img.data, alt: '' }) : null,
      U.h('h2', { text: r.title }),
      meta1 ? U.h('p', { class: 'rv-cover-meta', text: meta1 }) : null,
      meta2 ? U.h('p', { class: 'rv-cover-meta subtle', text: meta2 }) : null,
      (c.description || '').trim() ? U.h('p', { class: 'rv-cover-desc', text: c.description.trim() }) : null
    );
  }

  function frameCard(f, i) {
    const img = f.rev ? images.get(f.id) : null;
    const fields = (review.fields || []).filter((fd) => (f.text[fd.id] || '').trim());
    return U.h(
      'article',
      { class: 'rv-frame', dataset: { anchor: `frame:${f.id}:card`, frame: f.id } },
      U.h(
        'div',
        { class: 'rv-frame-head' },
        U.h('span', { class: 'num-badge', text: String(i + 1) }),
        U.h('span', { class: 'spacer' }),
        U.h('button', { type: 'button', class: 'rv-mini-btn', dataset: { suggestFrame: f.id }, html: U.icon('edit', 13) + '<span>Suggest text</span>' })
      ),
      U.h(
        'div',
        { class: 'rv-img', dataset: { anchor: `frame:${f.id}:image` } },
        img ? U.h('img', { src: img.data, alt: `Frame ${i + 1}`, draggable: 'false' }) : U.h('span', { class: 'muted small', text: f.rev ? 'Loading…' : 'No image' })
      ),
      fields.length
        ? U.h(
            'dl',
            { class: 'rv-fields' },
            fields.map((fd) =>
              U.h(
                'div',
                { class: 'rv-field', dataset: { anchor: `field:${f.id}:${fd.id}` } },
                U.h('dt', {}, U.h('span', { text: fd.label }), U.h('button', { type: 'button', class: 'rv-mini-btn rv-field-suggest', dataset: { suggestFrame: f.id, suggestField: fd.id }, html: U.icon('edit', 12) + '<span>Suggest edit</span>' })),
                U.h('dd', { text: f.text[fd.id].trim() })
              )
            )
          )
        : null
    );
  }

  /* ---------- Pins ---------- */

  function anchorKeyFor(target) {
    if (!target) return 'page';
    if (target.type === 'cover') return 'cover';
    if (target.type === 'field') return `field:${target.frameId}:${target.fieldId}`;
    if (target.type === 'frame') return `frame:${target.frameId}:${target.area || 'card'}`;
    return 'page';
  }

  function findAnchor(key) {
    return $('rv-doc').querySelector(`[data-anchor="${CSS.escape(key)}"]`) || (key === 'page' ? $('rv-doc') : null);
  }

  function pinPlacement(t) {
    const target = t.root.target || {};
    let el = findAnchor(anchorKeyFor(target));
    let x = target.x;
    let y = target.y;
    if (!el && target.frameId) {
      // The field was emptied or removed since; fall back to the frame card's corner.
      el = findAnchor(`frame:${target.frameId}:card`);
      x = 1;
      y = 0;
    }
    if (!el) return null;
    return { el, x: U.clamp(x == null ? 1 : x, 0, 1), y: U.clamp(y == null ? 0 : y, 0, 1) };
  }

  function renderPins() {
    const doc = $('rv-doc');
    U.$$('.rv-pin', doc).forEach((p) => p.remove());
    if (!review) return;
    for (const t of threads) {
      const resolved = t.root.status === 'resolved';
      if (resolved && !showResolved) continue;
      const place = pinPlacement(t);
      if (!place) continue;
      const pin = U.h('button', {
        type: 'button',
        class: 'rv-pin' + (resolved ? ' is-resolved' : '') + (t.root.kind === 'suggestion' ? ' is-suggestion' : '') + (activeThread === t.root.id ? ' is-active' : ''),
        style: `left:${place.x * 100}%;top:${place.y * 100}%`,
        title: `${t.root.authorName}: ${t.root.kind === 'suggestion' ? 'suggested an edit' : (t.root.body || '').slice(0, 80)}`,
        'aria-label': `Comment ${t.pin} by ${t.root.authorName}`,
        dataset: { thread: t.root.id },
        text: String(t.pin),
      });
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        focusThread(t.root.id, true);
      });
      place.el.append(pin);
    }
    if (pending) placePendingPin();
  }

  function focusThread(id, fromPin) {
    activeThread = id;
    U.$$('.rv-pin', $('rv-doc')).forEach((p) => p.classList.toggle('is-active', p.dataset.thread === id));
    const root = threads.find((t) => t.root.id === id);
    if (root && root.root.status === 'resolved' && !showResolved) {
      showResolved = true;
      renderPins();
    }
    renderPanel();
    document.body.classList.add('rv-panel-open');
    const el = $('rv-panel').querySelector(`[data-thread="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!fromPin) {
      const pin = $('rv-doc').querySelector(`.rv-pin[data-thread="${CSS.escape(id)}"]`);
      if (pin) pin.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ---------- Composer popover ---------- */

  function onDocClick(e) {
    const pop = $('rv-popover');
    if (!pop.hidden && pop.dataset.dirty === '1' && !e.target.closest('.rv-pin')) {
      // Don't throw away a comment that's being written.
      const ta = pop.querySelector('textarea');
      if (ta) ta.focus();
      pop.classList.remove('nudge');
      void pop.offsetWidth;
      pop.classList.add('nudge');
      return;
    }
    const sug = e.target.closest('[data-suggest-frame]');
    if (sug) {
      e.stopPropagation();
      openSuggest(sug.dataset.suggestFrame, sug.dataset.suggestField || null, sug);
      return;
    }
    if (!commentMode || !review) return;
    if (e.target.closest('button, a, input, textarea, select, .rv-popover')) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).trim()) return;
    const anchor = e.target.closest('[data-anchor]');
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const x = U.clamp((e.clientX - r.left) / r.width, 0, 1);
    const y = U.clamp((e.clientY - r.top) / r.height, 0, 1);
    openComment(anchor.dataset.anchor, x, y);
  }

  function targetFromAnchor(key, x, y) {
    const parts = key.split(':');
    if (parts[0] === 'cover') return { type: 'cover', x, y };
    if (parts[0] === 'field') return { type: 'field', frameId: parts[1], fieldId: parts[2], x, y };
    if (parts[0] === 'frame') return { type: 'frame', frameId: parts[1], area: parts[2], x, y };
    return { type: 'page', x, y };
  }

  function contextFor(target) {
    if (!target || target.type === 'page') return 'General';
    if (target.type === 'cover') return 'Cover page';
    const idx = frameIndex(target.frameId);
    const base = idx >= 0 ? `Frame ${idx + 1}` : 'Removed frame';
    if (target.type === 'field' || target.fieldId) return `${base} · ${fieldLabel(target.fieldId)}`;
    return target.area === 'image' ? `${base} · Image` : base;
  }

  function placePendingPin() {
    U.$$('.rv-pin-pending').forEach((p) => p.remove());
    if (!pending) return;
    const el = findAnchor(pending.anchorKey);
    if (!el) return;
    el.append(U.h('span', { class: 'rv-pin rv-pin-pending', style: `left:${pending.x * 100}%;top:${pending.y * 100}%`, text: '+' }));
  }

  function showPopover(pop) {
    pop.dataset.dirty = '';
    pop.oninput = () => (pop.dataset.dirty = '1');
    pop.hidden = false;
  }

  function closePopover() {
    pending = null;
    $('rv-popover').dataset.dirty = '';
    $('rv-popover').hidden = true;
    U.$$('.rv-pin-pending').forEach((p) => p.remove());
  }

  function positionPopover() {
    const pop = $('rv-popover');
    if (pop.hidden || !pending) return;
    const pin = document.querySelector('.rv-pin-pending') || findAnchor(pending.anchorKey);
    if (!pin) return;
    const r = pin.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.left + r.width / 2 + 14;
    let top = r.top + r.height / 2 - 20;
    if (left + w > window.innerWidth - 12) left = Math.max(12, r.left - w - 14);
    if (top + h > window.innerHeight - 12) top = Math.max(12, window.innerHeight - h - 12);
    pop.style.left = left + window.scrollX + 'px';
    pop.style.top = Math.max(12, top) + window.scrollY + 'px';
  }

  /** Comments show up immediately (Firestore applies writes locally); the server confirms in the background. */
  async function send(data, what) {
    try {
      activeThread = await C.addComment(conn, reviewId, data);
      renderPins();
      renderPanel();
    } catch (e) {
      console.error(e);
      U.toast(`Couldn’t post your ${what}: ${C.explainError(e)}`, { type: 'error', duration: 0, action: 'Try again', onAction: () => send(data, what) });
    }
  }

  async function openComment(anchorKey, x, y) {
    const name = await ensureName();
    if (!name) return;
    pending = { anchorKey, x, y, target: targetFromAnchor(anchorKey, x, y) };
    placePendingPin();
    const pop = $('rv-popover');
    const ta = U.h('textarea', { class: 'input', rows: '3', placeholder: 'Add a comment…', maxlength: '5000' });
    const post = U.h('button', { type: 'button', class: 'btn btn-primary btn-sm', html: U.icon('send', 14) + '<span>Post</span>' });
    const submit = () => {
      const body = ta.value.trim();
      if (!body) return;
      const data = { kind: 'comment', body, authorName: myName(), target: pending.target };
      closePopover();
      send(data, 'comment');
    };
    post.addEventListener('click', submit);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    });
    pop.replaceChildren(
      U.h('div', { class: 'rv-pop-head' }, U.h('span', { class: 'rv-pop-context', text: contextFor(pending.target) }), U.h('span', { class: 'muted small', text: `as ${myName()}` })),
      ta,
      U.h('div', { class: 'composer-row' }, U.h('span', { class: 'muted small', text: U.isMac ? '⌘↵ to post' : 'Ctrl+Enter to post' }), U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cancel', onclick: closePopover }), post)
    );
    pop.setAttribute('aria-label', 'New comment');
    showPopover(pop);
    positionPopover();
    ta.focus({ preventScroll: true });
  }

  async function openSuggest(frameId, fieldId, sourceEl) {
    const name = await ensureName();
    if (!name) return;
    const frame = review.frames.find((f) => f.id === frameId);
    if (!frame) return;
    const fields = review.fields || [];
    if (!fields.length) return;
    let fid = fieldId || (fields.find((fd) => (frame.text[fd.id] || '').trim()) || fields[0]).id;
    const anchorKey = fieldId ? `field:${frameId}:${fieldId}` : `frame:${frameId}:card`;
    pending = { anchorKey, x: 1, y: 0, target: null };
    placePendingPin();
    const pop = $('rv-popover');
    const select = U.h('select', { class: 'input input-sm', 'aria-label': 'Field' }, fields.map((fd) => U.h('option', { value: fd.id, text: fd.label + ((frame.text[fd.id] || '').trim() ? '' : ' (empty)'), selected: fd.id === fid })));
    const original = U.h('div', { class: 'rv-original' });
    const proposed = U.h('textarea', { class: 'input', rows: '3', maxlength: '5000', placeholder: 'Your suggested wording' });
    const note = U.h('textarea', { class: 'input', rows: '1', maxlength: '2000', placeholder: 'Why? (optional)' });
    const fill = () => {
      const cur = frame.text[fid] || '';
      proposed.value = cur;
      original.replaceChildren(cur.trim() ? U.h('span', {}, U.h('b', { text: 'Current: ' }), cur) : U.h('span', { class: 'muted', text: 'This field is empty. Suggest text to add.' }));
      requestAnimationFrame(() => U.autoGrow(proposed));
    };
    select.addEventListener('change', () => {
      fid = select.value;
      fill();
    });
    proposed.addEventListener('input', () => U.autoGrow(proposed));
    fill();
    const post = U.h('button', { type: 'button', class: 'btn btn-primary btn-sm', html: U.icon('send', 14) + '<span>Suggest</span>' });
    post.addEventListener('click', async () => {
      const cur = frame.text[fid] || '';
      if (proposed.value.trim() === cur.trim()) {
        U.toast('Change the text first, then send your suggestion.');
        return;
      }
      const target = cur.trim() ? { type: 'field', frameId, fieldId: fid, x: 1, y: 0 } : { type: 'frame', frameId, area: 'card', fieldId: fid, x: 1, y: 0 };
      const data = {
        kind: 'suggestion',
        body: note.value.trim(),
        authorName: myName(),
        target,
        suggestion: { frameId, fieldId: fid, original: cur, proposed: proposed.value },
      };
      closePopover();
      send(data, 'suggestion');
    });
    pop.replaceChildren(
      ...[
        U.h('div', { class: 'rv-pop-head' }, U.h('span', { class: 'rv-pop-context', text: `Suggest an edit · Frame ${frameIndex(frameId) + 1}` }), U.h('span', { class: 'muted small', text: `as ${myName()}` })),
        fieldId ? null : select,
        original,
        proposed,
        note,
        U.h('div', { class: 'composer-row' }, U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cancel', onclick: closePopover }), post),
      ].filter(Boolean)
    );
    pop.setAttribute('aria-label', 'Suggest an edit');
    showPopover(pop);
    positionPopover();
    proposed.focus({ preventScroll: true });
    if (sourceEl && sourceEl.blur) sourceEl.blur();
  }

  /* ---------- Comments panel ---------- */

  function sortKey(t) {
    const key = C.targetKey(t.root);
    const order = key === 'page' ? -2 : key === 'cover' ? -1 : frameIndex(key) >= 0 ? frameIndex(key) : 1e6;
    return order * 1e4 + t.pin;
  }

  function renderPanel() {
    const panel = $('rv-panel');
    if (!review) return;
    drafts.capture();
    const scroll = panel.querySelector('.rv-list')?.scrollTop || 0;
    const open = threads.filter((t) => t.root.status !== 'resolved').sort((a, b) => sortKey(a) - sortKey(b));
    const resolved = threads.filter((t) => t.root.status === 'resolved').sort((a, b) => sortKey(a) - sortKey(b));
    const count = $('rv-count');
    count.hidden = !open.length;
    count.textContent = String(open.length);
    const list = U.h('div', { class: 'rv-list' });
    const ctx = {
      uid: conn.uid,
      canModerate: false,
      drafts,
      fieldLabel,
      replyPlaceholder: 'Write a reply…',
      async onReply(root, text) {
        const name = await ensureName();
        if (!name) return false;
        try {
          await C.addComment(conn, reviewId, { kind: 'reply', parentId: root.id, body: text, authorName: name });
          return true;
        } catch (e) {
          U.toast('Couldn’t send your reply: ' + C.explainError(e), { type: 'error', duration: 8000 });
          return false;
        }
      },
      async onEdit(c, patch) {
        try {
          await C.editComment(conn, reviewId, c.id, patch);
          return true;
        } catch (e) {
          U.toast('Couldn’t save: ' + C.explainError(e), { type: 'error', duration: 8000 });
          return false;
        }
      },
      async onDelete(c, replies) {
        try {
          await C.deleteComment(conn, reviewId, c, replies);
        } catch (e) {
          U.toast('Couldn’t delete: ' + C.explainError(e), { type: 'error', duration: 8000 });
        }
      },
      onSelect: (root) => focusThread(root.id, false),
    };
    const add = (t) => list.append(SB.threads.render(t, Object.assign({}, ctx, { pin: t.pin, context: contextFor(Object.assign({}, t.root.target || {}, t.root.suggestion ? { fieldId: t.root.suggestion.fieldId, frameId: t.root.suggestion.frameId } : {})), active: activeThread === t.root.id })));
    if (!threads.length) {
      list.append(U.h('div', { class: 'fb-empty' }, U.iconEl('message', 30), U.h('p', { text: 'No comments yet. Click anywhere on the storyboard to add the first one.' })));
    }
    open.forEach(add);
    if (resolved.length) {
      list.append(
        U.h('button', {
          type: 'button',
          class: 'link-btn rv-resolved-toggle',
          text: showResolved ? `Hide resolved (${resolved.length})` : `Show resolved (${resolved.length})`,
          onclick: () => {
            showResolved = !showResolved;
            renderPins();
            renderPanel();
          },
        })
      );
      if (showResolved) resolved.forEach(add);
    }
    panel.replaceChildren(
      U.h(
        'div',
        { class: 'rv-panel-head' },
        U.h('h2', { text: 'Comments' }),
        U.h('span', { class: 'muted small', text: open.length ? `${open.length} open` : '' }),
        U.h('span', { class: 'spacer' }),
        U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm rv-panel-close', 'aria-label': 'Close comments', html: U.icon('x', 16), onclick: () => document.body.classList.remove('rv-panel-open') })
      ),
      list
    );
    list.scrollTop = scroll;
    drafts.restore(panel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.SB);
