/* Storyboard Maker — the board: cover card, numbered frame cards, drag-to-reorder, and the one-at-a-time view. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const R = SB.render;
  const B = (SB.board = {});

  let root;
  let sortable = null;
  let deferred = false;
  let lastDragEnd = 0;
  const thumbCache = new Map(); // frameId -> {key, canvas}

  // One frame at a time: a big frame with its text beside it, and a filmstrip of all frames.
  const VIEW_KEY = 'sb-board-view';
  let view = U.storage.get(VIEW_KEY, 'grid') === 'single' ? 'single' : 'grid';
  let current = null; // the slide shown: a frame id or 'cover'
  let currentIndex = 1; // its position, so deleting it lands on a neighbour
  let currentProject = null;
  let filmSortable = null;
  const filmCache = new Map(); // frameId -> {key, canvas}
  let bigCache = null; // {key, canvas} for the big frame
  const openFields = new Set(); // empty fields opened for typing on the current frame
  const FILM_H = 62;
  const isSingle = () => view === 'single' && S.project.frames.length > 0;
  B.view = () => view;

  B.init = function () {
    root = document.getElementById('board');
    sortable = Sortable.create(root, {
      draggable: '.card-frame',
      filter: '.card-actions, .card-actions *, .card-badge',
      preventOnFilter: false,
      animation: 160,
      delay: 150,
      delayOnTouchOnly: true,
      ghostClass: 'card-ghost',
      chosenClass: 'card-chosen',
      dragClass: 'card-drag',
      onMove: (evt) => evt.related.classList.contains('card-frame'),
      onChange: renumberLive,
      onEnd: () => {
        lastDragEnd = Date.now();
        const order = U.$$('.card-frame', root).map((el) => el.dataset.id);
        const current = S.project.frames.map((f) => f.id);
        if (order.join() === current.join()) return;
        S.update((p) => {
          const byId = new Map(p.frames.map((f) => [f.id, f]));
          p.frames = order.map((id) => byId.get(id)).filter(Boolean);
        }, null);
      },
    });
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    root.addEventListener('input', onSingleInput);
    root.addEventListener('focusin', onSingleFocus);
    let lastWidth = 0;
    new ResizeObserver(
      U.debounce(() => {
        const w = root.clientWidth;
        if (w !== lastWidth) {
          lastWidth = w;
          drawThumbs();
        }
        drawBig();
      }, 120)
    ).observe(root);
    window.addEventListener('resize', U.debounce(drawBig, 120));
    S.subscribe((meta) => {
      if (meta.unchanged && !meta.reset) return;
      if (meta.source === 'single' && isSingle()) return; // typing in the one-at-a-time view: nothing else to redraw
      B.requestRender();
    });
    document.getElementById('board-view').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) B.setView(b.dataset.view);
    });
    syncViewButtons();
    document.addEventListener('keydown', onSingleKey);
  };

  /** Re-render now, or after the frame editor closes (it covers the board). */
  B.requestRender = function () {
    if (SB.editor && SB.editor.isOpen()) deferred = true;
    else B.render();
  };
  /** After the frame editor closes: re-render if needed, and show the frame it ended on. */
  B.flush = function (lastId) {
    if (lastId && view === 'single' && lastId !== current && S.frameById(lastId)) {
      setCurrent(lastId);
      deferred = true;
    }
    if (deferred) {
      deferred = false;
      B.render();
    }
  };

  function renumberLive() {
    U.$$('.card-frame', root).forEach((card, i) => {
      const n = card.querySelector('.num-badge');
      if (n) n.textContent = i + 1;
    });
  }

  B.render = function () {
    deferred = false;
    const p = S.project;
    if (currentProject !== S.currentId) {
      currentProject = S.currentId;
      current = null;
      currentIndex = 1;
      openFields.clear();
      filmCache.clear();
      bigCache = null;
    }
    const single = isSingle();
    if (sortable) sortable.option('disabled', !!S.readOnly || single);
    root.style.setProperty('--frame-ratio', S.aspect(p));
    root.dataset.view = single ? 'single' : 'grid';
    const counts = SB.feedback ? SB.feedback.countsByTarget() : null;
    if (single) {
      renderSingle(p, counts);
    } else {
      if (filmSortable) filmSortable.destroy();
      filmSortable = null;
      const frag = document.createDocumentFragment();
      frag.append(coverCard(p, counts));
      p.frames.forEach((f, i) => frag.append(frameCard(f, i, p, counts)));
      frag.append(addTile(p.frames.length === 0));
      root.replaceChildren(frag);
    }
    for (const id of thumbCache.keys()) if (!p.frames.some((f) => f.id === id)) thumbCache.delete(id);
    for (const id of filmCache.keys()) if (!p.frames.some((f) => f.id === id)) filmCache.delete(id);
    drawThumbs();
    const countEl = document.getElementById('frame-count');
    if (countEl) countEl.textContent = p.frames.length ? `${p.frames.length} frame${p.frames.length === 1 ? '' : 's'}` : '';
  };

  function iconButton(icon, label, act) {
    return U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm', title: label, 'aria-label': label, dataset: { act }, html: U.icon(icon, 16) });
  }

  function badge(count, target) {
    if (!count) return null;
    return U.h(
      'button',
      { type: 'button', class: 'card-badge', title: `${count} open comment${count === 1 ? '' : 's'}`, dataset: { act: 'feedback', target } },
      U.iconEl('message', 13),
      String(count)
    );
  }

  function frameCard(f, i, p, counts) {
    const filled = p.fields.filter((fd) => (f.text[fd.id] || '').trim());
    return U.h(
      'article',
      { class: 'card card-frame', tabindex: '0', dataset: { id: f.id }, 'aria-label': `Frame ${i + 1}. Press Enter to edit, Alt+arrow keys to move.` },
      U.h(
        'div',
        { class: 'card-head' },
        U.h('span', { class: 'num-badge', text: String(i + 1) }),
        badge(counts && counts[f.id], f.id),
        U.h('span', { class: 'spacer' }),
        U.h(
          'div',
          { class: 'card-actions' },
          iconButton('edit', 'Edit frame', 'edit'),
          iconButton('copy', 'Duplicate frame', 'duplicate'),
          iconButton('trash', 'Delete frame', 'delete')
        )
      ),
      U.h('div', { class: 'thumb' }),
      filled.length
        ? U.h(
            'dl',
            { class: 'card-fields' },
            filled.map((fd) => U.h('div', { class: 'cf' }, U.h('dt', { text: fd.label }), U.h('dd', { text: f.text[fd.id].trim() })))
          )
        : null
    );
  }

  function coverCard(p, counts) {
    const c = p.cover;
    const im = c.imageId ? S.images.get(c.imageId) : null;
    const meta1 = [c.client, c.company].map((s) => (s || '').trim()).filter(Boolean).join(' · ');
    const meta2 = [c.version, c.date].map((s) => (s || '').trim()).filter(Boolean).join(' · ');
    return U.h(
      'article',
      { class: 'card card-cover' + (c.include ? '' : ' is-excluded'), tabindex: '0', dataset: { act: 'cover' }, 'aria-label': 'Cover page. Press Enter to edit.' },
      U.h(
        'div',
        { class: 'card-head' },
        U.h('span', { class: 'cover-tag', html: U.icon('book', 14) + '<span>Cover page</span>' }),
        badge(counts && counts.cover, 'cover'),
        U.h('span', { class: 'spacer' }),
        c.include ? null : U.h('span', { class: 'muted small', text: 'Not in PDF' }),
        U.h('div', { class: 'card-actions' }, iconButton('edit', 'Edit cover page', 'cover'))
      ),
      U.h(
        'div',
        { class: 'cover-thumb' },
        im ? U.h('img', { src: im.url, alt: '' }) : null,
        U.h('div', { class: 'cover-title', text: p.title || 'Untitled storyboard' }),
        meta1 ? U.h('div', { class: 'cover-meta', text: meta1 }) : null,
        meta2 ? U.h('div', { class: 'cover-meta subtle', text: meta2 }) : null
      ),
      (c.description || '').trim() ? U.h('p', { class: 'cover-desc', text: c.description.trim() }) : null
    );
  }

  function addTile(empty) {
    if (empty) {
      return U.h(
        'div',
        { class: 'empty-state' },
        U.h('div', { class: 'empty-icon', html: U.icon('image', 36) }),
        U.h('h2', { text: 'Add your first frames' }),
        U.h('p', { text: 'Drop images anywhere on this page, or choose them from your computer. Each image becomes one numbered frame.' }),
        U.h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'add' }, html: U.icon('plus', 16) + '<span>Choose images</span>' }),
        U.h('p', { class: 'muted small', text: 'Tip: images are added in filename order, so naming them 01, 02, 03… keeps them in sequence.' })
      );
    }
    return U.h(
      'button',
      { type: 'button', class: 'card add-tile', dataset: { act: 'add' } },
      U.h('span', { class: 'add-tile-icon', html: U.icon('plus', 22) }),
      U.h('span', { class: 'add-tile-label', text: 'Add images' }),
      U.h('span', { class: 'muted small', text: 'or drop files anywhere' })
    );
  }

  function thumbKey(f, ratio, w) {
    const im = f.imageId ? S.images.get(f.imageId) : null;
    return [w, ratio, f.imageId, im ? 1 : 0, JSON.stringify(f.view), JSON.stringify(f.arrows)].join('|');
  }

  function drawThumbs() {
    if (!root) return;
    const first = root.querySelector('.card-frame .thumb');
    if (!first) return;
    const w = Math.round(first.clientWidth);
    if (!w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ratio = S.aspect();
    for (const card of root.querySelectorAll('.card-frame')) {
      const f = S.frameById(card.dataset.id);
      if (!f) continue;
      const key = thumbKey(f, ratio, w);
      let entry = thumbCache.get(f.id);
      if (!entry || entry.key !== key) {
        const c = entry ? entry.canvas : document.createElement('canvas');
        const W = Math.round(w * dpr);
        const H = Math.round((w / ratio) * dpr);
        c.width = W;
        c.height = H;
        R.drawFrame(c.getContext('2d'), f, W, H);
        entry = { key, canvas: c };
        thumbCache.set(f.id, entry);
      }
      const holder = card.querySelector('.thumb');
      if (entry.canvas.parentNode !== holder) holder.replaceChildren(entry.canvas);
    }
  }

  /** A small rendered thumbnail of a frame (used by the feedback panel). */
  B.thumbnailFor = function (frameId, width) {
    const f = S.frameById(frameId);
    if (!f) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return R.frameCanvas(f, S.aspect(), width * dpr);
  };

  function onClick(e) {
    if (Date.now() - lastDragEnd < 250) return;
    const actEl = e.target.closest('[data-act]');
    const card = e.target.closest('.card');
    const act = actEl ? actEl.dataset.act : null;
    if (act === 'add') {
      SB.app.addImages();
      return;
    }
    if (act === 'feedback') {
      e.stopPropagation();
      SB.feedback.open(actEl.dataset.target);
      return;
    }
    if (isSingle()) {
      singleAction(act, actEl);
      return;
    }
    if (act === 'cover' || (card && card.classList.contains('card-cover'))) {
      SB.cover.open();
      return;
    }
    if (!card || !card.classList.contains('card-frame')) return;
    const id = card.dataset.id;
    if (S.readOnly && (act === 'duplicate' || act === 'delete')) return;
    if (act === 'duplicate') B.duplicateFrame(id);
    else if (act === 'delete') B.deleteFrame(id);
    else SB.editor.open(id);
  }

  function onKey(e) {
    if (e.target.classList && e.target.classList.contains('sv-input') && e.key === 'Escape') {
      e.target.blur();
      return;
    }
    if (e.target.classList && e.target.classList.contains('sv-stage') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      SB.editor.open(current);
      return;
    }
    const card = e.target.closest && e.target.closest('.card');
    if (!card || e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (card.classList.contains('card-cover')) SB.cover.open();
      else if (card.classList.contains('card-frame')) SB.editor.open(card.dataset.id);
      return;
    }
    if (!card.classList.contains('card-frame') || S.readOnly) return;
    const id = card.dataset.id;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      B.deleteFrame(id);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
      e.preventDefault();
      B.moveFrame(id, -1);
      focusCard(id);
    } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
      e.preventDefault();
      B.moveFrame(id, 1);
      focusCard(id);
    }
  }

  function focusCard(id) {
    const el = root.querySelector(`.card-frame[data-id="${CSS.escape(id)}"]`);
    if (el) el.focus();
  }

  /* ---------- Frame operations (shared with the editor) ---------- */

  B.deleteFrame = function (id) {
    const idx = S.frameIndex(id);
    if (idx < 0) return;
    const removed = S.project.frames[idx];
    S.update((p) => p.frames.splice(idx, 1), null);
    U.toast(`Frame ${idx + 1} deleted`, {
      action: 'Undo',
      duration: 6000,
      onAction: () => {
        if (S.frameById(removed.id)) return;
        S.update((p) => p.frames.splice(Math.min(idx, p.frames.length), 0, removed), null);
      },
    });
  };

  B.duplicateFrame = function (id) {
    const idx = S.frameIndex(id);
    if (idx < 0) return null;
    const copy = JSON.parse(JSON.stringify(S.project.frames[idx]));
    copy.id = U.uid('f');
    copy.arrows.forEach((a) => (a.id = U.uid('a')));
    S.update((p) => p.frames.splice(idx + 1, 0, copy), null);
    return copy.id;
  };

  B.moveFrame = function (id, delta) {
    const idx = S.frameIndex(id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= S.project.frames.length) return false;
    S.update((p) => {
      const [f] = p.frames.splice(idx, 1);
      p.frames.splice(to, 0, f);
    }, null);
    return true;
  };

  B.scrollToFrame = function (id) {
    if (isSingle() && S.frameById(id)) {
      show(id);
      return;
    }
    const el = root.querySelector(`.card-frame[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* ---------- One frame at a time ---------- */

  B.setView = function (v) {
    v = v === 'single' ? 'single' : 'grid';
    if (v === view) return;
    const from = view;
    const visible = from === 'grid' ? firstVisibleCard() : null;
    view = v;
    U.storage.set(VIEW_KEY, v);
    syncViewButtons();
    if (v === 'single') {
      if (visible && visible !== 'cover') setCurrent(visible);
      B.render();
      window.scrollTo({ top: 0 });
    } else {
      const keep = current;
      B.render();
      const el = keep === 'cover' ? root.querySelector('.card-cover') : keep ? root.querySelector(`.card-frame[data-id="${CSS.escape(keep)}"]`) : null;
      if (el) el.scrollIntoView({ block: 'center' });
    }
  };

  function syncViewButtons() {
    U.$$('#board-view [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    const size = document.getElementById('card-size-control');
    if (size) size.hidden = view === 'single';
  }

  /** The cover or frame nearest the top of the screen, so switching views keeps your place. */
  function firstVisibleCard() {
    const cards = U.$$('.card-cover, .card-frame', root);
    const el = cards.find((x) => x.getBoundingClientRect().bottom > 120) || cards[0];
    if (!el) return null;
    return el.classList.contains('card-cover') ? 'cover' : el.dataset.id;
  }

  const slides = (p) => ['cover'].concat(p.frames.map((f) => f.id));

  function setCurrent(id) {
    if (id !== current) openFields.clear();
    current = id;
  }

  /** The slide to show: the current one, or its neighbour if it was deleted (first frame to start with). */
  function resolveCurrent(p) {
    const list = slides(p);
    if (!current || !list.includes(current)) setCurrent(list[U.clamp(current ? currentIndex : 1, 0, list.length - 1)]);
    currentIndex = list.indexOf(current);
    return current;
  }

  function show(id) {
    if (!slides(S.project).includes(id)) return;
    if (id === current) return;
    setCurrent(id);
    B.render();
  }

  B.goSlide = function (delta) {
    const list = slides(S.project);
    const i = list.indexOf(current);
    show(list[U.clamp((i < 0 ? 1 : i) + delta, 0, list.length - 1)]);
  };

  function singleAction(act, el) {
    if (act === 'prev') B.goSlide(-1);
    else if (act === 'next') B.goSlide(1);
    else if (act === 'go') show(el.dataset.slide);
    else if (act === 'edit' && current !== 'cover') SB.editor.open(current);
    else if (act === 'cover') SB.cover.open();
    else if (act === 'fields') SB.fieldsManager.open();
    else if (act === 'show-field') openField(el.dataset.field);
    else if (S.readOnly || current === 'cover') return;
    else if (act === 'duplicate') {
      const id = B.duplicateFrame(current);
      if (id) show(id);
    } else if (act === 'delete') B.deleteFrame(current);
  }

  function onSingleKey(e) {
    if (!isSingle() || SB.app.isHome() || document.querySelector('dialog[open]')) return;
    if (U.isTyping(e.target) || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (e.altKey) {
      if (S.readOnly || current === 'cover') return;
      if (k === 'ArrowLeft' || k === 'ArrowUp') {
        e.preventDefault();
        B.moveFrame(current, -1);
      } else if (k === 'ArrowRight' || k === 'ArrowDown') {
        e.preventDefault();
        B.moveFrame(current, 1);
      }
      return;
    }
    if (k === 'ArrowRight' || k === 'PageDown') {
      e.preventDefault();
      B.goSlide(1);
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault();
      B.goSlide(-1);
    }
  }

  function renderSingle(p, counts) {
    // Keep typing and the filmstrip's scroll position across re-renders (live updates, comments, undo).
    const active = document.activeElement;
    const focus = active && root.contains(active) && active.dataset && active.dataset.field ? { field: active.dataset.field, frame: active.dataset.frame, start: active.selectionStart, end: active.selectionEnd } : null;
    const oldStrip = root.querySelector('.sv-film');
    const stripScroll = oldStrip ? oldStrip.scrollLeft : 0;
    const shownBefore = root.dataset.shown;

    const id = resolveCurrent(p);
    const list = slides(p);
    const idx = list.indexOf(id);
    const isCover = id === 'cover';
    const fi = isCover ? -1 : S.frameIndex(id);
    const f = isCover ? null : p.frames[fi];

    const actions = isCover
      ? [U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { act: 'cover' }, html: U.icon('edit', 15) + '<span>Edit cover page</span>' })]
      : [
          U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { act: 'edit' }, title: 'Reframe the image, draw arrows, and edit all fields', html: U.icon('crop', 15) + `<span>${S.readOnly ? 'Open frame' : 'Reframe & arrows'}</span>` }),
          S.readOnly ? null : iconButton('copy', 'Duplicate frame', 'duplicate'),
          S.readOnly ? null : iconButton('trash', 'Delete frame', 'delete'),
        ];
    const nav = U.h(
      'div',
      { class: 'sv-nav' },
      U.h(
        'div',
        { class: 'sv-nav-side' },
        isCover ? U.h('span', { class: 'cover-tag', html: U.icon('book', 14) + '<span>Cover page</span>' }) : U.h('span', { class: 'num-badge num-badge-lg', text: String(fi + 1) }),
        badge(counts && counts[id], id)
      ),
      U.h(
        'div',
        { class: 'sv-nav-mid' },
        U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'prev' }, disabled: idx <= 0, title: 'Previous (←)', 'aria-label': 'Previous', html: U.icon('left', 18) + '<span>Previous</span>' }),
        U.h('span', { class: 'sv-label', text: isCover ? 'Cover page' : `Frame ${fi + 1} of ${p.frames.length}` }),
        U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'next' }, disabled: idx >= list.length - 1, title: 'Next (→)', 'aria-label': 'Next', html: '<span>Next</span>' + U.icon('right', 18) })
      ),
      U.h('div', { class: 'sv-nav-side sv-actions' }, actions)
    );

    const body = isCover ? U.h('div', { class: 'sv-cover-wrap' }, coverCard(p, null)) : frameBody(f, fi, p);
    const strip = U.h(
      'div',
      { class: 'sv-film', role: 'list', 'aria-label': S.readOnly ? 'All frames' : 'All frames. Drag to reorder.' },
      filmItem('cover', -1, counts),
      p.frames.map((fr, i) => filmItem(fr.id, i, counts)),
      S.readOnly ? null : U.h('button', { type: 'button', class: 'sv-film-add', dataset: { act: 'add' }, title: 'Add images', 'aria-label': 'Add images', html: U.icon('plus', 20) })
    );
    root.replaceChildren(nav, body, strip);
    root.dataset.shown = id;

    drawBig();
    drawFilm(strip);
    U.$$('textarea.sv-input', root).forEach(U.autoGrow);
    if (filmSortable) filmSortable.destroy();
    filmSortable = S.readOnly
      ? null
      : Sortable.create(strip, {
          draggable: '.sv-film-frame',
          animation: 150,
          delay: 150,
          delayOnTouchOnly: true,
          ghostClass: 'card-ghost',
          onMove: (evt) => evt.related.classList.contains('sv-film-frame'),
          onChange: () => U.$$('.sv-film-frame .sv-film-num', strip).forEach((n, i) => (n.textContent = i + 1)),
          onEnd: () => {
            lastDragEnd = Date.now();
            const order = U.$$('.sv-film-frame', strip).map((el) => el.dataset.slide);
            if (order.join() === S.project.frames.map((x) => x.id).join()) return;
            S.update((pr) => {
              const byId = new Map(pr.frames.map((x) => [x.id, x]));
              pr.frames = order.map((x) => byId.get(x)).filter(Boolean);
            }, null);
          },
        });

    // Filmstrip: keep its scroll position, and bring the current frame into view when it changes.
    strip.scrollLeft = stripScroll;
    if (shownBefore !== id || !oldStrip) {
      const cur = strip.querySelector('.is-current');
      if (cur) {
        if (cur.offsetLeft < strip.scrollLeft) strip.scrollLeft = cur.offsetLeft - 24;
        else if (cur.offsetLeft + cur.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = cur.offsetLeft + cur.offsetWidth - strip.clientWidth + 24;
      }
    }
    if (focus && focus.frame === id) {
      const inp = root.querySelector(`.sv-input[data-field="${CSS.escape(focus.field)}"]`);
      if (inp) {
        inp.closest('.sv-field').classList.add('is-open');
        inp.focus({ preventScroll: true });
        try {
          inp.setSelectionRange(focus.start, focus.end);
        } catch (err) {
          /* not a text input */
        }
      }
    }
  }

  function frameBody(f, fi, p) {
    const stage = U.h(
      'div',
      { class: 'sv-stage', role: 'button', tabindex: '0', dataset: { act: 'edit', frame: f.id }, 'aria-label': `Frame ${fi + 1}. Press Enter to ${S.readOnly ? 'open it' : 'reframe it or draw arrows'}.` },
      U.h('span', { class: 'sv-stage-hint', html: U.icon('crop', 14) + `<span>${S.readOnly ? 'Open frame' : 'Click to reframe or draw arrows'}</span>` })
    );
    const fields = U.h('div', { class: 'sv-fields' });
    const chips = [];
    for (const fd of p.fields) {
      const value = f.text[fd.id] || '';
      const filled = !!value.trim();
      if (S.readOnly && !filled) continue;
      const inputId = 'sv-field-' + fd.id;
      const attrs = { id: inputId, class: 'sv-input', placeholder: S.FIELD_PLACEHOLDERS[fd.id] || '', dataset: { field: fd.id, frame: f.id } };
      const input = fd.multiline ? U.h('textarea', Object.assign(attrs, { rows: '1' })) : U.h('input', Object.assign(attrs, { type: 'text', autocomplete: 'off', list: 'sv-dl-' + fd.id }));
      input.value = value;
      input.readOnly = !!S.readOnly;
      const open = openFields.has(fd.id);
      fields.append(
        U.h(
          'div',
          { class: 'sv-field' + (filled ? '' : ' is-empty') + (open ? ' is-open' : ''), dataset: { fieldBlock: fd.id } },
          U.h('label', { for: inputId, text: fd.label }),
          input,
          fd.multiline ? null : U.h('datalist', { id: 'sv-dl-' + fd.id })
        )
      );
      if (!S.readOnly) chips.push(U.h('button', { type: 'button', class: 'sv-chip', dataset: { act: 'show-field', field: fd.id }, hidden: filled || open }, U.iconEl('plus', 13), U.h('span', { text: fd.label })));
    }
    if (chips.length) fields.append(U.h('div', { class: 'sv-chips', hidden: chips.every((c) => c.hidden) }, U.h('span', { class: 'sv-chips-label', text: 'Add' }), chips));
    if (!S.readOnly) fields.append(U.h('button', { type: 'button', class: 'link-btn sv-fields-link', dataset: { act: 'fields' }, text: p.fields.length ? 'Add or rename fields…' : 'This storyboard has no text fields. Add some…' }));
    const hasFields = fields.children.length > 0;
    return U.h('div', { class: 'sv-body' + (hasFields ? ' has-fields' : '') }, stage, hasFields ? fields : null);
  }

  function filmItem(id, i, counts) {
    const n = counts && counts[id];
    const cover = id === 'cover';
    return U.h(
      'button',
      {
        type: 'button',
        role: 'listitem',
        class: 'sv-film-item ' + (cover ? 'sv-film-cover' : 'sv-film-frame') + (id === current ? ' is-current' : ''),
        dataset: { act: 'go', slide: id },
        title: cover ? 'Cover page' : `Frame ${i + 1}`,
        'aria-current': id === current ? 'true' : null,
      },
      U.h('span', { class: 'sv-film-thumb', html: cover ? U.icon('book', 18) : '' }),
      U.h('span', { class: 'sv-film-num', text: cover ? 'Cover' : String(i + 1) }),
      n ? U.h('span', { class: 'sv-film-count', title: `${n} open comment${n === 1 ? '' : 's'}`, text: String(n) }) : null
    );
  }

  function drawFilm(strip) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ratio = S.aspect();
    for (const item of strip.querySelectorAll('.sv-film-frame')) {
      const f = S.frameById(item.dataset.slide);
      if (!f) continue;
      const key = thumbKey(f, ratio, 'film');
      let entry = filmCache.get(f.id);
      if (!entry || entry.key !== key) {
        entry = { key, canvas: R.frameCanvas(f, ratio, FILM_H * ratio * dpr) };
        filmCache.set(f.id, entry);
      }
      item.firstElementChild.replaceChildren(entry.canvas);
    }
  }

  function drawBig() {
    const stage = root && root.querySelector('.sv-stage');
    if (!stage) return;
    const f = S.frameById(stage.dataset.frame);
    const w = Math.round(stage.clientWidth);
    if (!f || !w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ratio = S.aspect();
    const key = f.id + '|' + thumbKey(f, ratio, w);
    if (!bigCache || bigCache.key !== key) {
      const c = (bigCache && bigCache.canvas) || document.createElement('canvas');
      c.width = Math.round(w * dpr);
      c.height = Math.round((w / ratio) * dpr);
      R.drawFrame(c.getContext('2d'), f, c.width, c.height);
      bigCache = { key, canvas: c };
    }
    if (bigCache.canvas.parentNode !== stage) stage.prepend(bigCache.canvas);
  }

  /* Text fields: edit right here. Empty fields stay tucked away as "+ Field" chips until you open one. */

  function openField(fid) {
    const block = root.querySelector(`.sv-field[data-field-block="${CSS.escape(fid)}"]`);
    if (!block) return;
    openFields.add(fid);
    block.classList.add('is-open');
    syncChips();
    const inp = block.querySelector('.sv-input');
    inp.focus();
  }

  function syncChips() {
    U.$$('.sv-chip', root).forEach((chip) => {
      const block = root.querySelector(`.sv-field[data-field-block="${CSS.escape(chip.dataset.field)}"]`);
      chip.hidden = !block || !block.classList.contains('is-empty') || block.classList.contains('is-open');
    });
    const row = root.querySelector('.sv-chips');
    if (row) row.hidden = U.$$('.sv-chip', row).every((c) => c.hidden);
  }

  function onSingleFocus(e) {
    const inp = e.target;
    if (!inp.classList || !inp.classList.contains('sv-input')) return;
    const block = inp.closest('.sv-field');
    if (!block.classList.contains('is-open')) {
      openFields.add(inp.dataset.field);
      block.classList.add('is-open'); // stays put even if emptied, until you move to another frame
      syncChips();
    }
    if (inp.list) SB.editor.fillSuggestions(inp, inp.dataset.frame);
  }

  function onSingleInput(e) {
    const inp = e.target;
    const fid = inp.dataset && inp.dataset.field;
    if (!fid || !inp.classList.contains('sv-input') || S.readOnly) return;
    const f = S.frameById(inp.dataset.frame);
    if (!f) return;
    const v = inp.value;
    S.update(
      () => {
        if (v) f.text[fid] = v;
        else delete f.text[fid];
      },
      `text:${f.id}:${fid}`,
      { source: 'single' }
    );
    if (inp.tagName === 'TEXTAREA') U.autoGrow(inp);
    inp.closest('.sv-field').classList.toggle('is-empty', !v.trim());
  }
})(window.SB);
