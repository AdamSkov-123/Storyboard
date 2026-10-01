/* Storyboard Maker — frame rendering: reframed image + arrows. Shared by board, editor, PDF and review upload. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const R = (SB.render = {});

  R.MAX_ZOOM = 6;

  /** Zoom is relative to "fill" (1 = image covers the frame). minZoom shows the whole image (letterboxed). */
  R.minZoom = function (iw, ih, W, H) {
    const cover = Math.max(W / iw, H / ih);
    const contain = Math.min(W / iw, H / ih);
    return contain / cover;
  };

  /** Clamp a view in place so the image never leaves an empty gap unless it is zoomed out past "fill". */
  R.clampView = function (view, iw, ih, W, H) {
    const minZ = R.minZoom(iw, ih, W, H);
    view.zoom = U.clamp(Number.isFinite(+view.zoom) ? +view.zoom : 1, minZ, R.MAX_ZOOM);
    const s = Math.max(W / iw, H / ih) * view.zoom;
    const dw = iw * s;
    const dh = ih * s;
    view.cx = dw / W > 1.0001 ? U.clamp(+view.cx || 0.5, W / (2 * dw), 1 - W / (2 * dw)) : 0.5;
    view.cy = dh / H > 1.0001 ? U.clamp(+view.cy || 0.5, H / (2 * dh), 1 - H / (2 * dh)) : 0.5;
    return view;
  };

  /** Where the (possibly flipped) image lands inside a W×H frame. cx/cy are in displayed-image coordinates. */
  R.geometry = function (view, iw, ih, W, H) {
    const v = R.clampView({ zoom: view.zoom, cx: view.cx, cy: view.cy }, iw, ih, W, H);
    const s = Math.max(W / iw, H / ih) * v.zoom;
    const dw = iw * s;
    const dh = ih * s;
    return { dx: W / 2 - v.cx * dw, dy: H / 2 - v.cy * dh, dw, dh, flip: !!view.flip, view: v };
  };

  R.drawImage = function (ctx, src, g, ox, oy) {
    ox = ox || 0;
    oy = oy || 0;
    if (g.flip) {
      ctx.save();
      ctx.translate(ox + g.dx + g.dw, oy + g.dy);
      ctx.scale(-1, 1);
      ctx.drawImage(src, 0, 0, g.dw, g.dh);
      ctx.restore();
    } else {
      ctx.drawImage(src, ox + g.dx, oy + g.dy, g.dw, g.dh);
    }
  };

  function drawPlaceholder(ctx, W, H, label, fill) {
    ctx.fillStyle = fill || '#e7e7ec';
    ctx.fillRect(0, 0, W, H);
    if (label === false) return;
    const s = Math.min(W, H);
    ctx.strokeStyle = '#a7a7b2';
    ctx.lineWidth = Math.max(1, s * 0.012);
    const iw = s * 0.2;
    const ih = iw * 0.78;
    const x = W / 2 - iw / 2;
    const y = H / 2 - ih / 2 - s * 0.06;
    ctx.strokeRect(x, y, iw, ih);
    ctx.beginPath();
    ctx.moveTo(x + iw * 0.12, y + ih * 0.85);
    ctx.lineTo(x + iw * 0.42, y + ih * 0.45);
    ctx.lineTo(x + iw * 0.62, y + ih * 0.68);
    ctx.lineTo(x + iw * 0.74, y + ih * 0.55);
    ctx.lineTo(x + iw * 0.9, y + ih * 0.85);
    ctx.stroke();
    ctx.fillStyle = '#8e8e99';
    ctx.font = `600 ${Math.max(8, s * 0.07)}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label || 'No image', W / 2, y + ih + s * 0.05);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Draw a frame (image, reframing and arrows) into a W×H box at the context's origin.
   * opts.full: use the full-resolution image (PDF/review); opts.emptyFill / opts.emptyLabel for frames without an image.
   */
  R.drawFrame = function (ctx, frame, W, H, opts) {
    opts = opts || {};
    const im = frame.imageId ? SB.store.images.get(frame.imageId) : null;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    if (im) {
      ctx.fillStyle = '#0d0d0f';
      ctx.fillRect(0, 0, W, H);
      const g = R.geometry(frame.view, im.w, im.h, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(g.dx, g.dy, g.dw, g.dh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      R.drawImage(ctx, opts.full ? im.img : im.preview, g);
    } else {
      drawPlaceholder(ctx, W, H, frame.imageId ? 'Image missing' : opts.emptyLabel, opts.emptyFill);
    }
    if (!opts.hideArrows && frame.arrows) {
      for (const a of frame.arrows) R.drawArrow(ctx, a, W, H);
    }
    ctx.restore();
  };

  /** Render a frame to a new canvas of the given pixel width. */
  R.frameCanvas = function (frame, ratio, pxW, opts) {
    const W = Math.max(1, Math.round(pxW));
    const H = Math.max(1, Math.round(pxW / ratio));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    R.drawFrame(c.getContext('2d'), frame, W, H, opts);
    return c;
  };

  /* ---------- Arrows ---------- */

  /** Thickness units are relative to frame size so arrows look the same at any render size. */
  R.arrowUnit = (W, H) => Math.sqrt(W * H) / 750;

  R.arrowGeometry = function (a, W, H) {
    const u = R.arrowUnit(W, H);
    const lw = Math.max(0.6, a.width * u);
    const p1 = { x: a.x1 * W, y: a.y1 * H };
    const p2 = { x: a.x2 * W, y: a.y2 * H };
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.max(1e-6, Math.hypot(dx, dy));
    const n = { x: -dy / len, y: dx / len };
    const m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const k = (a.bend || 0) * len;
    const c = { x: m.x + n.x * 2 * k, y: m.y + n.y * 2 * k };
    const apex = { x: m.x + n.x * k, y: m.y + n.y * k };
    const N = 48;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const mt = 1 - t;
      pts.push({ x: mt * mt * p1.x + 2 * mt * t * c.x + t * t * p2.x, y: mt * mt * p1.y + 2 * mt * t * c.y + t * t * p2.y });
    }
    let curveLen = 0;
    for (let i = 1; i < pts.length; i++) curveLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const both = a.head === 'both';
    const headLen = Math.min(lw * 3 + 7 * u, curveLen * (both ? 0.4 : 0.6));
    return { p1, p2, c, m, n, apex, len, lw, u, pts, headLen, headW: headLen * 0.55 };
  };

  /** Walk back `dist` along a polyline from its end. Returns {index, point} where pts[0..index] + point remain. */
  function cutBack(pts, dist) {
    let acc = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + seg >= dist) {
        const t = (dist - acc) / (seg || 1);
        return { index: i - 1, point: { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t } };
      }
      acc += seg;
    }
    return { index: 0, point: pts[0] };
  }

  function headPolygon(tip, from, L, Wh) {
    let dx = tip.x - from.x;
    let dy = tip.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const bx = tip.x - dx * L;
    const by = tip.y - dy * L;
    const px = -dy;
    const py = dx;
    return [
      { x: tip.x, y: tip.y },
      { x: bx + px * Wh, y: by + py * Wh },
      { x: bx + dx * L * 0.2, y: by + dy * L * 0.2 },
      { x: bx - px * Wh, y: by - py * Wh },
    ];
  }

  function polyPath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  R.arrowParts = function (a, W, H) {
    const g = R.arrowGeometry(a, W, H);
    const headStart = a.head === 'start' || a.head === 'both';
    const headEnd = a.head === 'end' || a.head === 'both';
    let line = g.pts;
    const heads = [];
    if (headEnd) {
      const cut = cutBack(line, g.headLen * 0.75);
      const dir = cutBack(line, g.headLen);
      line = line.slice(0, cut.index + 1).concat([cut.point]);
      heads.push(headPolygon(g.p2, dir.point, g.headLen, g.headW));
    }
    if (headStart) {
      const rev = line.slice().reverse();
      const cut = cutBack(rev, g.headLen * 0.75);
      const dir = cutBack(g.pts.slice().reverse(), g.headLen);
      line = rev.slice(0, cut.index + 1).concat([cut.point]).reverse();
      heads.push(headPolygon(g.p1, dir.point, g.headLen, g.headW));
    }
    return { g, line, heads };
  };

  R.drawArrow = function (ctx, a, W, H) {
    const { g, line, heads } = R.arrowParts(a, W, H);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const dash = a.dash ? [g.lw * 1.4, g.lw * 2.6] : [];
    if (a.outline) {
      const oc = luminance(a.color) > 0.62 ? 'rgba(0,0,0,0.85)' : '#ffffff';
      const ow = Math.max(1, g.lw * 0.45);
      ctx.strokeStyle = oc;
      ctx.fillStyle = oc;
      ctx.lineWidth = g.lw + ow * 2;
      ctx.setLineDash(dash);
      polyPath(ctx, line);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = ow * 2;
      for (const hp of heads) {
        polyPath(ctx, hp);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
    }
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = g.lw;
    ctx.setLineDash(dash);
    polyPath(ctx, line);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const hp of heads) {
      polyPath(ctx, hp);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  /** Distance from point (px, py) to the arrow's curve, in pixels. */
  R.arrowDistance = function (a, W, H, px, py) {
    const g = R.arrowGeometry(a, W, H);
    let best = Infinity;
    for (let i = 1; i < g.pts.length; i++) {
      const p = g.pts[i - 1];
      const q = g.pts[i];
      const vx = q.x - p.x;
      const vy = q.y - p.y;
      const l2 = vx * vx + vy * vy || 1;
      const t = U.clamp(((px - p.x) * vx + (py - p.y) * vy) / l2, 0, 1);
      best = Math.min(best, Math.hypot(px - (p.x + vx * t), py - (p.y + vy * t)));
    }
    return { dist: best, g };
  };
})(window.SB);
