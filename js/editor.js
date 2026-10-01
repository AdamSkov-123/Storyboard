/* Storyboard Maker — frame editor: reframe/crop, arrows, and the frame's text fields. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const R = SB.render;
  const E = (SB.editor = {});

  const COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ffffff', '#111111'];

  let dlg;
  let canvas;
  let ctx;
  let stage;
  let frameId = null;
  let tool = 'reframe';
  let selectedId = null;
  let drag = null;
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let cssW = 1;
  let cssH = 1;
  let dpr = 1;
  const style = Object.assign({}, S.ARROW_DEFAULTS);

  const $ = (id) => document.getElementById(id);
  const frame = () => (frameId ? S.frameById(frameId) : null);
  const imageOf = (f) => (f && f.imageId ? S.images.get(f.imageId) : null);
  const currentArrow = () => {
    const f = frame();
    return f && selectedId ? f.arrows.find((a) => a.id === selectedId) || null : null;
  };

  E.isOpen = () => !!(dlg && dlg.open);

  E.init = function () {
    dlg = $('editor');
    canvas = $('ed-canvas');
    ctx = canvas.getContext('2d');
    stage = $('ed-stage');

    $('ed-prev').addEventListener('click', () => E.go(-1));
    $('ed-next').addEventListener('click', () => E.go(1));
    $('ed-done').addEventListener('click', () => dlg.close());
    $('ed-move-earlier').addEventListener('click', () => move(-1));
    $('ed-move-later').addEventListener('click', () => move(1));
    $('ed-duplicate').addEventListener('click', () => {
      const id = SB.board.duplicateFrame(frameId);
      if (id) E.open(id);
    });
    $('ed-delete').addEventListener('click', deleteCurrent);
    $('ed-replace').addEventListener('click', replaceImage);
    $('ed-manage-fields').addEventListener('click', () => SB.fieldsManager.open());

    U.$$('[data-tool]', dlg).forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

    // Reframe controls
    $('ed-zoom').addEventListener('input', (e) => {
      const f = frame();
      const im = imageOf(f);
      if (!im) return;
      const minZ = R.minZoom(im.w, im.h, rect.w, rect.h);
      const t = +e.target.value / 1000;
      zoomAt(f, im, minZ * Math.pow(R.MAX_ZOOM / minZ, t), null);
      S.commit('zoom:' + f.id, { source: 'editor' });
    });
    $('ed-fit').addEventListener('click', () => setView((v, im) => ({ zoom: R.minZoom(im.w, im.h, rect.w, rect.h), cx: 0.5, cy: 0.5, flip: v.flip })));
    $('ed-fill').addEventListener('click', () => setView((v) => ({ zoom: 1, cx: v.cx, cy: v.cy, flip: v.flip })));
    $('ed-flip').addEventListener('click', () => setView((v) => ({ zoom: v.zoom, cx: 1 - v.cx, cy: v.cy, flip: !v.flip })));
    $('ed-reset').addEventListener('click', () => setView(() => ({ zoom: 1, cx: 0.5, cy: 0.5, flip: false })));

    buildArrowControls();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDoubleClick);

    new ResizeObserver(() => {
      if (!E.isOpen()) return;
      layout();
      draw();
    }).observe(stage);

    const fieldsHost = $('ed-fields');
    fieldsHost.addEventListener('input', onFieldInput);
    fieldsHost.addEventListener('focusin', onFieldFocus);

    dlg.addEventListener('keydown', onKeyDown);
    dlg.addEventListener('cancel', (e) => {
      if (selectedId || drag) {
        e.preventDefault();
        selectedId = null;
        drag = null;
        syncArrowControls();
        draw();
      }
    });
    dlg.addEventListener('close', () => {
      frameId = null;
      drag = null;
      SB.board.flush();
    });

    S.subscribe(onStoreChange);
  };

  E.open = function (id, opts) {
    if (!S.frameById(id)) return;
    frameId = id;
    selectedId = null;
    drag = null;
    if (opts && opts.tool) tool = opts.tool;
    if (!dlg.open) dlg.showModal();
    renderHeader();
    buildFields();
    syncTool();
    requestAnimationFrame(() => {
      layout();
      draw();
    });
  };

  E.go = function (delta) {
    const idx = S.frameIndex(frameId);
    const next = S.project.frames[idx + delta];
    if (next) E.open(next.id);
  };

  function move(delta) {
    SB.board.moveFrame(frameId, delta);
  }

  function deleteCurrent() {
    const idx = S.frameIndex(frameId);
    const frames = S.project.frames;
    const neighbour = frames[idx + 1] || frames[idx - 1];
    SB.board.deleteFrame(frameId);
    if (neighbour) E.open(neighbour.id);
    else dlg.close();
  }

  async function replaceImage() {
    const [file] = await U.pickFiles({ accept: 'image/*' });
    if (!file) return;
    try {
      const imageId = await S.addImageFile(file);
      const f = frame();
      if (!f) return;
      S.update(() => {
        f.imageId = imageId;
        f.view = { zoom: 1, cx: 0.5, cy: 0.5, flip: false };
      }, null);
    } catch (e) {
      U.toast(e.message + ' Use JPG, PNG or WebP images.', { type: 'error' });
    }
  }

  function onStoreChange(meta) {
    if (!E.isOpen()) return;
    if (meta.reset) {
      dlg.close();
      return;
    }
    const f = frame();
    if (!f) {
      dlg.close();
      return;
    }
    if (selectedId && !f.arrows.some((a) => a.id === selectedId)) selectedId = null;
    renderHeader();
    if (meta.source !== 'editor') syncFields();
    syncTool();
    syncArrowControls();
    layout();
    draw();
  }

  function renderHeader() {
    const idx = S.frameIndex(frameId);
    const n = S.project.frames.length;
    $('ed-num').textContent = String(idx + 1);
    $('ed-of').textContent = `of ${n}`;
    $('ed-prev').disabled = idx <= 0;
    $('ed-next').disabled = idx >= n - 1;
    $('ed-move-earlier').disabled = idx <= 0;
    $('ed-move-later').disabled = idx >= n - 1;
    const f = frame();
    $('ed-replace').querySelector('span:last-child').textContent = f && f.imageId ? 'Replace image' : 'Add image';
  }

  /* ---------- Fields ---------- */

  function fieldSignature() {
    return S.project.fields.map((fd) => `${fd.id}:${fd.label}:${fd.multiline ? 1 : 0}`).join('|');
  }

  function buildFields() {
    const host = $('ed-fields');
    const f = frame();
    host.replaceChildren();
    host.dataset.sig = fieldSignature();
    if (!f) return;
    if (!S.project.fields.length) {
      host.append(U.h('p', { class: 'muted small', text: 'This storyboard has no text fields. Use “Add or rename fields” to create some.' }));
    }
    for (const fd of S.project.fields) {
      const id = 'ed-field-' + fd.id;
      const value = f.text[fd.id] || '';
      const placeholder = S.FIELD_PLACEHOLDERS[fd.id] || '';
      let input;
      const extras = [];
      if (fd.multiline) {
        input = U.h('textarea', { id, rows: '2', class: 'input', placeholder, dataset: { field: fd.id } });
      } else {
        const listId = 'ed-dl-' + fd.id;
        input = U.h('input', { id, type: 'text', class: 'input', placeholder, autocomplete: 'off', list: listId, dataset: { field: fd.id } });
        extras.push(U.h('datalist', { id: listId }));
      }
      input.value = value;
      host.append(U.h('div', { class: 'form-row' + (value.trim() ? ' has-value' : '') }, U.h('label', { for: id, text: fd.label }), input, extras));
    }
    requestAnimationFrame(() => U.$$('textarea', host).forEach(U.autoGrow));
  }

  function syncFields() {
    const host = $('ed-fields');
    if (host.dataset.sig !== fieldSignature()) {
      buildFields();
      return;
    }
    const f = frame();
    U.$$('[data-field]', host).forEach((inp) => {
      const v = f.text[inp.dataset.field] || '';
      if (inp.value !== v) {
        inp.value = v;
        if (inp.tagName === 'TEXTAREA') U.autoGrow(inp);
      }
      inp.closest('.form-row').classList.toggle('has-value', !!v.trim());
    });
  }

  function onFieldInput(e) {
    const fid = e.target.dataset.field;
    const f = frame();
    if (!fid || !f) return;
    const v = e.target.value;
    S.update(
      () => {
        if (v) f.text[fid] = v;
        else delete f.text[fid];
      },
      `text:${f.id}:${fid}`,
      { source: 'editor' }
    );
    if (e.target.tagName === 'TEXTAREA') U.autoGrow(e.target);
    e.target.closest('.form-row').classList.toggle('has-value', !!v.trim());
  }

  function onFieldFocus(e) {
    const inp = e.target;
    if (!inp.list || !inp.dataset.field) return;
    const fid = inp.dataset.field;
    const fd = S.project.fields.find((x) => x.id === fid);
    const counts = new Map();
    for (const fr of S.project.frames) {
      const v = (fr.text[fid] || '').trim();
      if (v && fr.id !== frameId) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const used = Array.from(counts.keys()).sort((a, b) => counts.get(b) - counts.get(a));
    const options = Array.from(new Set(used.concat((fd && fd.presets) || []))).slice(0, 60);
    inp.list.replaceChildren(...options.map((v) => U.h('option', { value: v })));
  }

  /* ---------- Tools ---------- */

  function setTool(t) {
    tool = t;
    if (t !== 'arrows') selectedId = null;
    syncTool();
    syncArrowControls();
    draw();
  }

  function syncTool() {
    const f = frame();
    const hasImage = !!imageOf(f);
    U.$$('[data-tool]', dlg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tool === tool)));
    $('ed-reframe-panel').hidden = tool !== 'reframe';
    $('ed-arrow-panel').hidden = tool !== 'arrows';
    stage.dataset.tool = tool;
    U.$$('#ed-reframe-panel button, #ed-reframe-panel input').forEach((el) => (el.disabled = !hasImage));
    let hint;
    if (tool === 'reframe') hint = hasImage ? 'Drag to reposition · Scroll or use the slider to zoom' : 'Add an image to this frame to reframe it';
    else hint = 'Drag on the frame to draw an arrow · Click an arrow to select it';
    $('ed-hint').textContent = hint;
    syncReframeControls();
  }

  function syncReframeControls() {
    const f = frame();
    const im = imageOf(f);
    const zoomEl = $('ed-zoom');
    const label = $('ed-zoom-label');
    if (!im) {
      label.textContent = '—';
      return;
    }
    const minZ = R.minZoom(im.w, im.h, rect.w, rect.h);
    const z = R.clampView(Object.assign({}, f.view), im.w, im.h, rect.w, rect.h).zoom;
    const t = Math.log(z / minZ) / Math.log(R.MAX_ZOOM / minZ);
    if (document.activeElement !== zoomEl) zoomEl.value = String(Math.round(U.clamp(t, 0, 1) * 1000));
    label.textContent = Math.round(z * 100) + '%';
    $('ed-flip').setAttribute('aria-pressed', String(!!f.view.flip));
  }

  function setView(fn) {
    const f = frame();
    const im = imageOf(f);
    if (!im) return;
    const v = fn(f.view, im);
    R.clampView(v, im.w, im.h, rect.w, rect.h);
    S.update(() => (f.view = v), null, { source: 'editor' });
  }

  function zoomAt(f, im, z, p) {
    const g = R.geometry(f.view, im.w, im.h, rect.w, rect.h);
    const lx = p ? p.x - rect.x : rect.w / 2;
    const ly = p ? p.y - rect.y : rect.h / 2;
    const u = (lx - g.dx) / g.dw;
    const v = (ly - g.dy) / g.dh;
    const zoom = U.clamp(z, R.minZoom(im.w, im.h, rect.w, rect.h), R.MAX_ZOOM);
    const s = Math.max(rect.w / im.w, rect.h / im.h) * zoom;
    const dw = im.w * s;
    const dh = im.h * s;
    f.view.zoom = zoom;
    f.view.cx = u + (rect.w / 2 - lx) / dw;
    f.view.cy = v + (rect.h / 2 - ly) / dh;
    R.clampView(f.view, im.w, im.h, rect.w, rect.h);
    syncReframeControls();
    draw();
  }

  /* ---------- Arrow controls ---------- */

  function buildArrowControls() {
    const sw = $('ed-colors');
    for (const c of COLORS) {
      sw.append(U.h('button', { type: 'button', class: 'swatch', style: `--c:${c}`, title: c, 'aria-label': 'Color ' + c, dataset: { color: c } }));
    }
    const custom = U.h('input', { type: 'color', id: 'ed-color-custom', title: 'Custom color', 'aria-label': 'Custom color' });
    sw.append(U.h('label', { class: 'swatch swatch-custom', title: 'Custom color' }, custom));
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (b) applyStyle({ color: b.dataset.color }, null);
    });
    custom.addEventListener('input', () => applyStyle({ color: custom.value }, 'color'));

    $('ed-width').addEventListener('input', (e) => applyStyle({ width: +e.target.value }, 'width'));
    U.$$('#ed-heads [data-head]').forEach((b) => b.addEventListener('click', () => applyStyle({ head: b.dataset.head }, null)));
    U.$$('#ed-dash [data-dash]').forEach((b) => b.addEventListener('click', () => applyStyle({ dash: b.dataset.dash === '1' }, null)));
    $('ed-outline').addEventListener('change', (e) => applyStyle({ outline: e.target.checked }, null));
    $('ed-curve').addEventListener('input', (e) => {
      const a = currentArrow();
      if (!a) return;
      a.bend = +e.target.value / 100;
      S.commit('bend:' + a.id, { source: 'editor' });
    });
    $('ed-straighten').addEventListener('click', () => {
      const a = currentArrow();
      if (!a) return;
      S.update(() => (a.bend = 0), null, { source: 'editor' });
    });
    $('ed-reverse').addEventListener('click', () => {
      const a = currentArrow();
      if (!a) return;
      S.update(
        () => {
          [a.x1, a.y1, a.x2, a.y2] = [a.x2, a.y2, a.x1, a.y1];
          a.bend = -(a.bend || 0);
        },
        null,
        { source: 'editor' }
      );
    });
    $('ed-arrow-delete').addEventListener('click', deleteSelectedArrow);
    $('ed-arrows-clear').addEventListener('click', () => {
      const f = frame();
      if (!f || !f.arrows.length) return;
      const n = f.arrows.length;
      S.update(() => (f.arrows = []), null, { source: 'editor' });
      U.toast(`Removed ${n} arrow${n === 1 ? '' : 's'}`, { action: 'Undo', onAction: () => S.undo() });
    });
  }

  function applyStyle(patch, key) {
    Object.assign(style, patch);
    const a = currentArrow();
    if (a) {
      Object.assign(a, patch);
      S.commit(key ? `${key}:${a.id}` : null, { source: 'editor' });
    } else {
      syncArrowControls();
    }
  }

  function syncArrowControls() {
    const a = currentArrow();
    const f = frame();
    const s = a || style;
    $('ed-arrow-scope').textContent = a ? 'Selected arrow' : 'Style for new arrows';
    U.$$('#ed-colors [data-color]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color.toLowerCase() === String(s.color).toLowerCase())));
    const custom = $('ed-color-custom');
    if (/^#[0-9a-f]{6}$/i.test(s.color) && document.activeElement !== custom) custom.value = s.color;
    custom.parentElement.classList.toggle('is-active', !COLORS.some((c) => c.toLowerCase() === String(s.color).toLowerCase()));
    custom.parentElement.style.setProperty('--c', s.color);
    $('ed-width').value = String(s.width);
    $('ed-width-label').textContent = String(s.width);
    U.$$('#ed-heads [data-head]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.head === s.head)));
    U.$$('#ed-dash [data-dash]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.dash === '1') === !!s.dash)));
    $('ed-outline').checked = !!s.outline;
    const curve = $('ed-curve');
    curve.disabled = !a;
    if (document.activeElement !== curve) curve.value = String(Math.round(((a && a.bend) || 0) * 100));
    $('ed-straighten').disabled = !a || !a.bend;
    $('ed-reverse').disabled = !a;
    $('ed-arrow-delete').disabled = !a;
    $('ed-arrows-clear').disabled = !f || !f.arrows.length;
  }

  function deleteSelectedArrow() {
    const f = frame();
    const a = currentArrow();
    if (!f || !a) return;
    S.update(() => (f.arrows = f.arrows.filter((x) => x.id !== a.id)), null, { source: 'editor' });
    selectedId = null;
    syncArrowControls();
    draw();
  }

  /* ---------- Canvas ---------- */

  function layout() {
    const r = stage.getBoundingClientRect();
    cssW = Math.max(1, r.width);
    cssH = Math.max(1, r.height);
    dpr = window.devicePixelRatio || 1;
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ratio = S.aspect();
    const pad = Math.max(28, Math.min(cssW, cssH) * 0.08);
    let w = cssW - pad * 2;
    let h = w / ratio;
    if (h > cssH - pad * 2) {
      h = cssH - pad * 2;
      w = h * ratio;
    }
    rect = { x: (cssW - w) / 2, y: (cssH - h) / 2, w: Math.max(1, w), h: Math.max(1, h) };
  }

  function draw() {
    if (!E.isOpen()) return;
    const f = frame();
    if (!f) return;
    const im = imageOf(f);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (tool === 'reframe' && im) {
      // The parts of the image outside the frame, ghosted, so you can see what you are cropping.
      const g = R.geometry(f.view, im.w, im.h, rect.w, rect.h);
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.imageSmoothingQuality = 'high';
      R.drawImage(ctx, im.preview, g, rect.x, rect.y);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(rect.x, rect.y);
    R.drawFrame(ctx, f, rect.w, rect.h, { emptyLabel: 'No image — use “Add image” above' });
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.w + 1, rect.h + 1);
    if (tool === 'reframe' && im) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      for (let i = 1; i < 3; i++) {
        const x = Math.round(rect.x + (rect.w * i) / 3) + 0.5;
        const y = Math.round(rect.y + (rect.h * i) / 3) + 0.5;
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.h);
        ctx.moveTo(rect.x, y);
        ctx.lineTo(rect.x + rect.w, y);
      }
      ctx.stroke();
    }
    if (tool === 'arrows') drawSelection(f);
  }

  function drawSelection(f) {
    const a = currentArrow();
    if (!a) return;
    const g = R.arrowGeometry(a, rect.w, rect.h);
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.beginPath();
    ctx.rect(0, 0, rect.w, rect.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.45)';
    ctx.lineWidth = g.lw + 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    g.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    R.drawArrow(ctx, a, rect.w, rect.h);
    ctx.restore();
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.p1.x, g.p1.y);
    ctx.lineTo(g.p2.x, g.p2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    handle(g.p1, false);
    handle(g.p2, false);
    handle(g.apex, true);
    ctx.restore();
  }

  function handle(p, mid) {
    ctx.beginPath();
    if (mid) {
      const r = 7;
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fillStyle = '#6366f1';
    } else {
      ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
    }
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = mid ? '#ffffff' : '#6366f1';
    ctx.stroke();
  }

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  const norm = (p) => ({ x: U.clamp((p.x - rect.x) / rect.w, 0, 1), y: U.clamp((p.y - rect.y) / rect.h, 0, 1) });

  function hitTest(f, p, tol) {
    const q = { x: p.x - rect.x, y: p.y - rect.y };
    const sel = currentArrow();
    if (sel) {
      const g = R.arrowGeometry(sel, rect.w, rect.h);
      const near = (pt) => Math.hypot(pt.x - q.x, pt.y - q.y) <= tol + 2;
      if (near(g.apex)) return { arrow: sel, handle: 'mid' };
      if (near(g.p2)) return { arrow: sel, handle: 'p2' };
      if (near(g.p1)) return { arrow: sel, handle: 'p1' };
    }
    for (let i = f.arrows.length - 1; i >= 0; i--) {
      const a = f.arrows[i];
      const { dist, g } = R.arrowDistance(a, rect.w, rect.h, q.x, q.y);
      if (dist <= Math.max(tol, g.lw / 2 + 4)) return { arrow: a, handle: null };
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const f = frame();
    if (!f) return;
    const p = local(e);
    if (tool === 'reframe') {
      const im = imageOf(f);
      if (!im) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { type: 'pan', start: p, view0: R.geometry(f.view, im.w, im.h, rect.w, rect.h).view, moved: false };
      stage.classList.add('is-grabbing');
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const hit = hitTest(f, p, e.pointerType === 'touch' ? 18 : 9);
    if (hit && hit.handle) {
      selectedId = hit.arrow.id;
      drag = { type: hit.handle, arrowId: hit.arrow.id, start: p, moved: false };
    } else if (hit) {
      selectedId = hit.arrow.id;
      drag = { type: 'move', arrowId: hit.arrow.id, start: p, a0: Object.assign({}, hit.arrow), moved: false };
    } else {
      selectedId = null;
      drag = { type: 'create', start: p, arrowId: null, moved: false };
    }
    syncArrowControls();
    draw();
  }

  function onPointerMove(e) {
    const p = local(e);
    const f = frame();
    if (!f) return;
    if (!drag) {
      if (tool === 'arrows') {
        const hit = hitTest(f, p, 9);
        stage.dataset.hover = hit ? (hit.handle ? 'handle' : 'arrow') : '';
      }
      return;
    }
    if (drag.type === 'pan') {
      const im = imageOf(f);
      const g0 = R.geometry(drag.view0, im.w, im.h, rect.w, rect.h);
      f.view.cx = drag.view0.cx - (p.x - drag.start.x) / g0.dw;
      f.view.cy = drag.view0.cy - (p.y - drag.start.y) / g0.dh;
      f.view.zoom = drag.view0.zoom;
      R.clampView(f.view, im.w, im.h, rect.w, rect.h);
      drag.moved = true;
      draw();
      return;
    }
    const n = norm(p);
    if (drag.type === 'create') {
      if (!drag.arrowId) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 6) return;
        const s = norm(drag.start);
        const a = { id: U.uid('a'), x1: s.x, y1: s.y, x2: n.x, y2: n.y, bend: 0, color: style.color, width: style.width, head: style.head, dash: style.dash, outline: style.outline };
        f.arrows.push(a);
        drag.arrowId = a.id;
        selectedId = a.id;
      }
      const a = f.arrows.find((x) => x.id === drag.arrowId);
      let end = n;
      if (e.shiftKey) end = snapAngle(a.x1, a.y1, n);
      a.x2 = end.x;
      a.y2 = end.y;
    } else if (drag.type === 'p1' || drag.type === 'p2') {
      const a = f.arrows.find((x) => x.id === drag.arrowId);
      const k = drag.type === 'p1' ? '1' : '2';
      const other = k === '1' ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 };
      const pt = e.shiftKey ? snapAngle(other.x, other.y, n) : n;
      a['x' + k] = pt.x;
      a['y' + k] = pt.y;
    } else if (drag.type === 'mid') {
      const a = f.arrows.find((x) => x.id === drag.arrowId);
      const g = R.arrowGeometry(a, rect.w, rect.h);
      const q = { x: p.x - rect.x, y: p.y - rect.y };
      let bend = ((q.x - g.m.x) * g.n.x + (q.y - g.m.y) * g.n.y) / g.len;
      if (Math.abs(bend) < 0.03) bend = 0;
      a.bend = U.clamp(Math.round(bend * 100) / 100, -1, 1);
    } else if (drag.type === 'move') {
      const a = f.arrows.find((x) => x.id === drag.arrowId);
      const a0 = drag.a0;
      let dx = (p.x - drag.start.x) / rect.w;
      let dy = (p.y - drag.start.y) / rect.h;
      dx = U.clamp(dx, -Math.min(a0.x1, a0.x2), 1 - Math.max(a0.x1, a0.x2));
      dy = U.clamp(dy, -Math.min(a0.y1, a0.y2), 1 - Math.max(a0.y1, a0.y2));
      a.x1 = a0.x1 + dx;
      a.y1 = a0.y1 + dy;
      a.x2 = a0.x2 + dx;
      a.y2 = a0.y2 + dy;
    }
    drag.moved = true;
    syncArrowControls();
    draw();
  }

  /** Snap the line from (x0,y0) to n to 45° steps, measured in screen space. */
  function snapAngle(x0, y0, n) {
    const dx = (n.x - x0) * rect.w;
    const dy = (n.y - y0) * rect.h;
    const len = Math.hypot(dx, dy);
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: U.clamp(x0 + (Math.cos(ang) * len) / rect.w, 0, 1), y: U.clamp(y0 + (Math.sin(ang) * len) / rect.h, 0, 1) };
  }

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    stage.classList.remove('is-grabbing');
    if (d.moved) S.commit(null, { source: 'editor' });
    syncReframeControls();
    syncArrowControls();
    draw();
  }

  function onWheel(e) {
    if (tool !== 'reframe') return;
    const f = frame();
    const im = imageOf(f);
    if (!im) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    zoomAt(f, im, f.view.zoom * factor, local(e));
    S.commit('zoom:' + f.id, { source: 'editor' });
  }

  function onDoubleClick(e) {
    if (tool !== 'arrows') return;
    const f = frame();
    const hit = f && hitTest(f, local(e), 9);
    if (hit && hit.handle === 'mid') {
      S.update(() => (hit.arrow.bend = 0), null, { source: 'editor' });
    }
  }

  function onKeyDown(e) {
    if (U.isTyping(e.target) || (e.target.matches && e.target.matches('input[type="range"]'))) return;
    if (e.ctrlKey || e.metaKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      deleteSelectedArrow();
    } else if (e.key === 'PageUp' || (e.altKey && e.key === 'ArrowLeft') || (e.key === 'ArrowLeft' && !selectedId)) {
      e.preventDefault();
      E.go(-1);
    } else if (e.key === 'PageDown' || (e.altKey && e.key === 'ArrowRight') || (e.key === 'ArrowRight' && !selectedId)) {
      e.preventDefault();
      E.go(1);
    } else if (selectedId && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const f = frame();
      const a = currentArrow();
      const step = (e.shiftKey ? 10 : 1) / rect.w;
      const stepY = (e.shiftKey ? 10 : 1) / rect.h;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -stepY : e.key === 'ArrowDown' ? stepY : 0;
      a.x1 = U.clamp(a.x1 + dx, 0, 1);
      a.x2 = U.clamp(a.x2 + dx, 0, 1);
      a.y1 = U.clamp(a.y1 + dy, 0, 1);
      a.y2 = U.clamp(a.y2 + dy, 0, 1);
      S.commit('nudge:' + a.id + f.id, { source: 'editor' });
    } else if (e.key === 'r' || e.key === 'R') {
      setTool('reframe');
    } else if (e.key === 'a' || e.key === 'A') {
      setTool('arrows');
    }
  }
})(window.SB);
