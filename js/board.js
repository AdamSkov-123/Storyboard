/* Storyboard Maker — the board: cover card, numbered frame cards, drag-to-reorder. */
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
    let lastWidth = 0;
    new ResizeObserver(
      U.debounce(() => {
        const w = root.clientWidth;
        if (w !== lastWidth) {
          lastWidth = w;
          drawThumbs();
        }
      }, 120)
    ).observe(root);
    S.subscribe((meta) => {
      if (meta.unchanged && !meta.reset) return;
      B.requestRender();
    });
  };

  /** Re-render now, or after the frame editor closes (it covers the board). */
  B.requestRender = function () {
    if (SB.editor && SB.editor.isOpen()) deferred = true;
    else B.render();
  };
  B.flush = function () {
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
    if (sortable) sortable.option('disabled', !!S.readOnly);
    const p = S.project;
    root.style.setProperty('--frame-ratio', S.aspect(p));
    const counts = SB.feedback ? SB.feedback.countsByTarget() : null;
    const frag = document.createDocumentFragment();
    frag.append(coverCard(p, counts));
    p.frames.forEach((f, i) => frag.append(frameCard(f, i, p, counts)));
    frag.append(addTile(p.frames.length === 0));
    root.replaceChildren(frag);
    for (const id of thumbCache.keys()) if (!p.frames.some((f) => f.id === id)) thumbCache.delete(id);
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
    const el = root.querySelector(`.card-frame[data-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
})(window.SB);
