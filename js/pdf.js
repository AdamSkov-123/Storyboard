/* Storyboard Maker — PDF export: page layout engine, live preview and jsPDF output. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const R = SB.render;
  const P = (SB.pdf = {});

  P.PAGE_SIZES = {
    letter: { label: 'US Letter (8.5 × 11 in)', w: 612, h: 792 },
    a4: { label: 'A4 (210 × 297 mm)', w: 595.28, h: 841.89 },
    tabloid: { label: 'Tabloid (11 × 17 in)', w: 792, h: 1224 },
    a3: { label: 'A3 (297 × 420 mm)', w: 841.89, h: 1190.55 },
  };
  P.PER_PAGE = [1, 2, 3, 4, 6, 8];

  // Candidate grids [columns, rows] for each frames-per-page choice. The best one is picked automatically.
  const GRIDS = { 1: [[1, 1]], 2: [[2, 1], [1, 2]], 3: [[3, 1], [1, 3]], 4: [[2, 2], [4, 1], [1, 4]], 6: [[3, 2], [2, 3]], 8: [[4, 2], [2, 4]] };

  const M = {
    margin: 36,
    headerH: 26,
    footerH: 20,
    gapX: 18,
    gapY: 18,
    badgeH: 14,
    badgeGap: 5,
    textGap: 7,
    base: 9,
    min: 6.5,
    lineH: 1.3,
    fieldGap: 0.5,
  };
  const INK = '#1b1b1f';
  const MUTED = '#6b6b76';
  const RULE = '#d4d4db';

  /* ---------- Text: sanitizing for the PDF's built-in Helvetica (Windows-1252) ---------- */

  const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const REPLACE = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '↑': '^', '↓': 'v', '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '—', '′': "'", '″': '"', '✓': 'v', '✔': 'v', '×': 'x', '\t': '    ', 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ı': 'i', 'Ħ': 'H', 'ħ': 'h', 'ŋ': 'n' };
  P.sanitize = function (str) {
    let out = '';
    for (const ch of String(str || '').normalize('NFC')) {
      const code = ch.codePointAt(0);
      if (ch === '\n') out += ch;
      else if (REPLACE[ch] != null) out += REPLACE[ch];
      else if ((code >= 32 && code < 127) || (code >= 160 && code <= 255) || CP1252_EXTRA.includes(ch)) out += ch;
      else if (code === 0x2009 || code === 0x200a || code === 0x202f || code === 0x2007) out += ' ';
      else if (code < 32 || (code >= 0x200b && code <= 0x200f) || (code >= 0xfe00 && code <= 0xfe0f)) continue;
      else {
        const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        out += base && [...base].every((c) => c.charCodeAt(0) < 256) ? base : '?';
      }
    }
    return out;
  };

  let mdoc = null;
  const widthCache = new Map();
  function textW(str, size, bold) {
    const key = (bold ? 'b' : 'n') + str;
    let u = widthCache.get(key);
    if (u === undefined) {
      if (!mdoc) mdoc = new window.jspdf.jsPDF({ unit: 'pt' });
      mdoc.setFont('helvetica', bold ? 'bold' : 'normal');
      u = mdoc.getStringUnitWidth(str);
      if (widthCache.size > 50000) widthCache.clear();
      widthCache.set(key, u);
    }
    return u * size;
  }

  /** Word-wrap text. The first line may be shorter (it shares the line with the field label). */
  function wrapText(text, size, bold, firstAvail, avail) {
    const out = [];
    for (const para of text.split('\n')) {
      const words = para.split(/ +/).filter(Boolean);
      if (!words.length) {
        out.push('');
        continue;
      }
      let line = '';
      const lim = () => (out.length === 0 ? firstAvail : avail);
      for (let w of words) {
        const test = line ? line + ' ' + w : w;
        if (textW(test, size, bold) <= lim()) {
          line = test;
          continue;
        }
        if (line) {
          out.push(line);
          line = '';
        }
        while (textW(w, size, bold) > lim()) {
          if (out.length === 0 && firstAvail < avail) {
            out.push('');
            continue;
          }
          let cut = w.length - 1;
          while (cut > 1 && textW(w.slice(0, cut), size, bold) > lim()) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }

  function frameItems(frame, project) {
    return project.fields
      .map((fd) => ({ label: P.sanitize(fd.label), value: P.sanitize((frame.text[fd.id] || '').trim()) }))
      .filter((x) => x.value.trim());
  }

  function layoutFields(items, width, size, showLabels) {
    const lh = size * M.lineH;
    const gap = size * M.fieldGap;
    const labSize = size * 0.78;
    const blocks = [];
    let h = 0;
    items.forEach((it, i) => {
      const label = showLabels ? it.label.toUpperCase() : '';
      const labW = label ? textW(label, labSize, true) + size * 0.5 : 0;
      const lines = wrapText(it.value, size, false, width - labW, width);
      if (i > 0) h += gap;
      blocks.push({ label, labW, lines, y: h });
      h += lines.length * lh;
    });
    return { blocks, height: h, size, lh, labSize, width };
  }

  /** Lay out a frame's fields in a w×h box, shrinking the font as needed and truncating as a last resort. */
  function fitFields(items, w, h, showLabels) {
    if (!items.length || w < 24 || h < 6) return null;
    for (let size = M.base; size >= M.min - 0.01; size -= 0.5) {
      const L = layoutFields(items, w, size, showLabels);
      if (L.height <= h + 0.01) return L;
    }
    const L = layoutFields(items, w, M.min, showLabels);
    const keep = [];
    let last = null;
    for (const b of L.blocks) {
      const lines = [];
      for (let j = 0; j < b.lines.length; j++) {
        if (b.y + (j + 1) * L.lh > h + 0.01) break;
        lines.push(b.lines[j]);
      }
      if (!lines.length) break;
      const nb = Object.assign({}, b, { lines });
      keep.push(nb);
      last = nb;
      if (lines.length < b.lines.length) break;
    }
    if (last) {
      const j = last.lines.length - 1;
      const avail = w - (j === 0 ? last.labW : 0);
      let t = last.lines[j];
      while (t && textW(t + '…', L.size, false) > avail) t = t.slice(0, -1);
      last.lines[j] = t.replace(/\s+$/, '') + '…';
    }
    L.blocks = keep;
    L.truncated = true;
    return L;
  }

  /* ---------- Page layout ---------- */

  function pageDims(settings) {
    const ps = P.PAGE_SIZES[settings.pageSize] || P.PAGE_SIZES.letter;
    const land = settings.orientation === 'landscape';
    return { pageW: land ? Math.max(ps.w, ps.h) : Math.min(ps.w, ps.h), pageH: land ? Math.min(ps.w, ps.h) : Math.max(ps.w, ps.h) };
  }

  function textNeeds(allItems, width, showLabels) {
    const hs = allItems
      .filter((x) => x.length)
      .map((x) => layoutFields(x, width, M.base, showLabels).height)
      .sort((a, b) => a - b);
    if (!hs.length) return { ref: 0, max: 0 };
    const typical = hs[Math.min(hs.length - 1, Math.floor(hs.length * 0.6))];
    const max = hs[hs.length - 1];
    // Size the layout for typical text; unusually long text shrinks (and, at worst, is shortened with …).
    return { ref: Math.max(typical, max * 0.4), max };
  }

  function evalCell(mode, cellW, cellH, ratio, allItems, showLabels) {
    const top = M.badgeH + M.badgeGap;
    const availH = cellH - top;
    if (availH < 20) return null;
    if (mode === 'below') {
      let textWidth = cellW;
      let img = null;
      let need = { ref: 0, max: 0 };
      for (let iter = 0; iter < 3; iter++) {
        need = textNeeds(allItems, textWidth, showLabels);
        const tH = need.ref > 0 ? Math.min(need.ref, availH * 0.6) : 0;
        const ih = availH - (tH > 0 ? tH + M.textGap : 0);
        const iw = Math.min(cellW, ih * ratio);
        img = { w: iw, h: iw / ratio };
        textWidth = Math.max(iw, 1);
      }
      need = textNeeds(allItems, textWidth, showLabels);
      const textH = availH - img.h - M.textGap;
      const fit = need.ref > 0 ? Math.min(1, textH / need.ref) : 1;
      return { mode, img, textW: textWidth, textH, need, score: img.w * img.h * Math.pow(fit, 1.5) };
    }
    let pick = null;
    for (const fr of [0.3, 0.34, 0.38, 0.42, 0.46, 0.5, 0.55, 0.6]) {
      const iw = Math.min(cellW * (1 - fr) - M.textGap * 1.5, availH * ratio);
      if (iw < 30) continue;
      const ih = iw / ratio;
      const textWidth = cellW - iw - M.textGap * 1.5;
      if (textWidth < 60) continue;
      const need = textNeeds(allItems, textWidth, showLabels);
      const fit = need.ref > 0 ? Math.min(1, availH / need.ref) : 1;
      const score = iw * ih * Math.pow(fit, 1.5);
      if (!pick || score > pick.score) pick = { mode: 'right', img: { w: iw, h: ih }, textW: textWidth, textH: availH, need, score };
      if (fit >= 1) break;
    }
    return pick;
  }

  P.computeLayout = function (project, settings) {
    const { pageW, pageH } = pageDims(settings);
    const hf = settings.headerFooter;
    const top = M.margin + (hf ? M.headerH : 0);
    const bottom = pageH - M.margin - (hf ? M.footerH : 0);
    const content = { x: M.margin, y: top, w: pageW - 2 * M.margin, h: bottom - top };
    const ratio = S.aspect(project);
    const n = P.PER_PAGE.includes(+settings.perPage) ? +settings.perPage : 4;
    const allItems = project.frames.map((f) => frameItems(f, project));
    const anyText = allItems.some((x) => x.length);
    let best = null;
    for (const [cols, rows] of GRIDS[n]) {
      const cellW = (content.w - (cols - 1) * M.gapX) / cols;
      const cellH = (content.h - (rows - 1) * M.gapY) / rows;
      for (const mode of anyText ? ['below', 'right'] : ['below']) {
        const c = evalCell(mode, cellW, cellH, ratio, allItems, settings.showLabels);
        if (!c) continue;
        Object.assign(c, { cols, rows, cellW, cellH });
        if (!best || c.score > best.score * 1.001) best = c;
      }
    }
    // When everything fits with room to spare, tighten rows and centre the grid vertically.
    const topH = M.badgeH + M.badgeGap;
    let usedH = best.cellH;
    if (best.need.max <= best.textH + 0.01) {
      const textUsed = best.need.max;
      usedH = best.mode === 'below' ? topH + best.img.h + (textUsed > 0 ? M.textGap + textUsed : 0) : topH + Math.max(best.img.h, textUsed);
      usedH = Math.min(best.cellH, usedH);
    }
    const gridH = best.rows * usedH + (best.rows - 1) * M.gapY;
    const offsetY = Math.max(0, (content.h - gridH) / 2);
    return Object.assign(best, { pageW, pageH, content, ratio, n, rowPitch: usedH + M.gapY, offsetY });
  };

  P.buildPages = function (project, settings) {
    const L = P.computeLayout(project, settings);
    const pages = [];
    if (settings.includeCover) pages.push({ type: 'cover' });
    for (let i = 0; i < project.frames.length; i += L.n) pages.push({ type: 'frames', start: i, count: Math.min(L.n, project.frames.length - i) });
    const framePages = pages.filter((p) => p.type === 'frames').length;
    let k = 0;
    for (const p of pages) if (p.type === 'frames') Object.assign(p, { num: ++k, total: framePages });
    return { L, pages };
  };

  function rightText(ops, str, xRight, y, size, bold, color) {
    ops.push({ t: 'text', x: xRight - textW(str, size, bold), y, str, size, bold, color });
  }

  P.pageOps = function (project, settings, L, page) {
    return page.type === 'cover' ? coverOps(project, L) : framePageOps(project, settings, L, page);
  };

  function framePageOps(project, settings, L, page) {
    const ops = [];
    const { pageW, pageH } = L;
    if (settings.headerFooter) {
      const title = P.sanitize(project.title || 'Untitled storyboard');
      const c = project.cover;
      const meta = P.sanitize([c.client, c.version, c.date].map((s) => (s || '').trim()).filter(Boolean).join('  ·  '));
      let metaW = meta ? textW(meta, 8, false) : 0;
      const maxTitleW = L.content.w - metaW - 24;
      let t = title;
      while (t.length > 1 && textW(t, 10, true) > maxTitleW) t = t.slice(0, -1);
      if (t !== title) t = t.replace(/\s+$/, '') + '…';
      ops.push({ t: 'text', x: M.margin, y: M.margin + 9, str: t, size: 10, bold: true, color: INK });
      if (meta) rightText(ops, meta, pageW - M.margin, M.margin + 9, 8, false, MUTED);
      ops.push({ t: 'line', x1: M.margin, y1: M.margin + 15, x2: pageW - M.margin, y2: M.margin + 15, color: RULE, lw: 0.6 });
      const first = page.start + 1;
      const last = page.start + page.count;
      ops.push({ t: 'text', x: M.margin, y: pageH - M.margin + 2, str: first === last ? `Frame ${first}` : `Frames ${first}–${last}`, size: 8, bold: false, color: MUTED });
      rightText(ops, `Page ${page.num} of ${page.total}`, pageW - M.margin, pageH - M.margin + 2, 8, false, MUTED);
    }
    for (let k = 0; k < page.count; k++) {
      const idx = page.start + k;
      const f = project.frames[idx];
      const col = k % L.cols;
      const row = Math.floor(k / L.cols);
      const cell = { x: L.content.x + col * (L.cellW + M.gapX), y: L.content.y + L.offsetY + row * L.rowPitch, w: L.cellW, h: L.cellH };
      const ix = L.mode === 'below' ? cell.x + (cell.w - L.img.w) / 2 : cell.x;
      const iy = cell.y + M.badgeH + M.badgeGap;
      const num = String(idx + 1);
      const bw = Math.max(M.badgeH + 4, textW(num, 8, true) + 10);
      ops.push({ t: 'rect', x: ix, y: cell.y, w: bw, h: M.badgeH, r: 3, fill: INK });
      ops.push({ t: 'text', x: ix + (bw - textW(num, 8, true)) / 2, y: cell.y + M.badgeH / 2 + 2.9, str: num, size: 8, bold: true, color: '#ffffff' });
      ops.push({ t: 'frame', idx, x: ix, y: iy, w: L.img.w, h: L.img.h });
      ops.push({ t: 'rect', x: ix, y: iy, w: L.img.w, h: L.img.h, stroke: '#c4c4cc', lw: 0.5 });
      const items = frameItems(f, project);
      if (!items.length) continue;
      let tx;
      let ty;
      let tw;
      if (L.mode === 'below') {
        tx = ix;
        ty = iy + L.img.h + M.textGap;
        tw = L.img.w;
      } else {
        tx = ix + L.img.w + M.textGap * 1.5;
        ty = iy;
        tw = cell.x + cell.w - tx;
      }
      const th = cell.y + L.cellH - ty;
      const T = fitFields(items, tw, th, settings.showLabels);
      if (T) pushFieldText(ops, T, tx, ty);
    }
    return ops;
  }

  function pushFieldText(ops, T, tx, ty) {
    for (const b of T.blocks) {
      b.lines.forEach((line, j) => {
        const base = ty + b.y + j * T.lh + T.size * 0.95;
        if (j === 0 && b.label) ops.push({ t: 'text', x: tx, y: base, str: b.label, size: T.labSize, bold: true, color: MUTED });
        if (line) ops.push({ t: 'text', x: tx + (j === 0 ? b.labW : 0), y: base, str: line, size: T.size, bold: false, color: INK });
      });
    }
  }

  function coverOps(project, L) {
    const ops = [];
    const { pageW, pageH } = L;
    const m = 54;
    const cw = pageW - 2 * m;
    const availH = pageH - 2 * m;
    const colW = Math.min(cw, 470);
    const c = project.cover;
    const title = P.sanitize(project.title || 'Untitled storyboard');
    const line1 = P.sanitize([c.client, c.company].map((s) => (s || '').trim()).filter(Boolean).join('  ·  '));
    const line2 = P.sanitize([c.version, c.date].map((s) => (s || '').trim()).filter(Boolean).join('  ·  '));
    const desc = P.sanitize((c.description || '').trim());
    const im = c.imageId ? S.images.get(c.imageId) : null;

    let titleSize = 30;
    let titleLines = wrapText(title, titleSize, true, cw, cw);
    while (titleLines.length > 3 && titleSize > 16) {
      titleSize -= 2;
      titleLines = wrapText(title, titleSize, true, cw, cw);
    }
    const metaBlocks = [];
    if (line1) metaBlocks.push({ lines: wrapText(line1, 13, false, cw, cw), size: 13, color: '#3a3a42' });
    if (line2) metaBlocks.push({ lines: wrapText(line2, 10, false, cw, cw), size: 10, color: MUTED });

    const headH = () => {
      let h = titleLines.length * titleSize * 1.15;
      for (const b of metaBlocks) h += 8 + b.lines.length * b.size * 1.35;
      return h;
    };
    let imgFrac = desc ? 0.4 : 0.5;
    let descSize = 10.5;
    let descLines = desc ? wrapText(desc, descSize, false, colW, colW) : [];
    const total = () => {
      const ih = im ? imgBox().h + 30 : 0;
      const dh = desc ? 26 + 22 + descLines.length * descSize * 1.45 : 0;
      return ih + headH() + dh;
    };
    function imgBox() {
      const maxH = availH * imgFrac;
      const r = im.w / im.h;
      let w = cw;
      let h = w / r;
      if (h > maxH) {
        h = maxH;
        w = h * r;
      }
      return { w, h };
    }
    while (total() > availH && descSize > 8) {
      descSize -= 0.5;
      descLines = wrapText(desc, descSize, false, colW, colW);
    }
    while (total() > availH && im && imgFrac > 0.18) imgFrac -= 0.04;
    if (total() > availH && desc) {
      const fixed = total() - descLines.length * descSize * 1.45;
      const maxLines = Math.max(1, Math.floor((availH - fixed) / (descSize * 1.45)));
      if (descLines.length > maxLines) {
        descLines = descLines.slice(0, maxLines);
        descLines[maxLines - 1] = descLines[maxLines - 1].replace(/\s+$/, '') + '…';
      }
    }

    let y = m + Math.max(0, (availH - total()) * 0.42);
    if (im) {
      const b = imgBox();
      ops.push({ t: 'cover', x: (pageW - b.w) / 2, y, w: b.w, h: b.h });
      y += b.h + 30;
    }
    for (const line of titleLines) {
      y += titleSize * 1.15;
      ops.push({ t: 'text', x: (pageW - textW(line, titleSize, true)) / 2, y: y - titleSize * 0.22, str: line, size: titleSize, bold: true, color: INK });
    }
    for (const b of metaBlocks) {
      y += 8;
      for (const line of b.lines) {
        y += b.size * 1.35;
        ops.push({ t: 'text', x: (pageW - textW(line, b.size, false)) / 2, y: y - b.size * 0.3, str: line, size: b.size, bold: false, color: b.color });
      }
    }
    if (desc) {
      y += 26;
      ops.push({ t: 'line', x1: pageW / 2 - 24, y1: y, x2: pageW / 2 + 24, y2: y, color: RULE, lw: 1 });
      y += 22;
      const x0 = (pageW - colW) / 2;
      for (const line of descLines) {
        y += descSize * 1.45;
        if (line) ops.push({ t: 'text', x: x0, y: y - descSize * 0.4, str: line, size: descSize, bold: false, color: '#2b2b31' });
      }
    }
    return ops;
  }

  /* ---------- Drawing backends ---------- */

  function canvasFont(size, bold) {
    return `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
  }

  function drawOpsCanvas(ctx, ops, project) {
    for (const op of ops) {
      if (op.t === 'text') {
        ctx.font = canvasFont(op.size, op.bold);
        ctx.fillStyle = op.color;
        ctx.fillText(op.str, op.x, op.y);
      } else if (op.t === 'rect') {
        ctx.beginPath();
        if (op.r && ctx.roundRect) ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
        else ctx.rect(op.x, op.y, op.w, op.h);
        if (op.fill) {
          ctx.fillStyle = op.fill;
          ctx.fill();
        }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.lw || 0.5;
          ctx.stroke();
        }
      } else if (op.t === 'line') {
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.lw;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
      } else if (op.t === 'frame') {
        ctx.save();
        ctx.translate(op.x, op.y);
        R.drawFrame(ctx, project.frames[op.idx], op.w, op.h, { emptyFill: '#f1f1f4', emptyLabel: false });
        ctx.restore();
      } else if (op.t === 'cover') {
        const im = S.images.get(project.cover.imageId);
        if (im) ctx.drawImage(im.preview, op.x, op.y, op.w, op.h);
      }
    }
  }

  function jpegFor(drawFn, pxW, pxH) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(pxW));
    c.height = Math.max(1, Math.round(pxH));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    drawFn(ctx, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  const DPI = 200;
  function drawOpPDF(doc, op, project) {
    if (op.t === 'text') {
      doc.setFont('helvetica', op.bold ? 'bold' : 'normal');
      doc.setFontSize(op.size);
      doc.setTextColor(op.color);
      doc.text(op.str, op.x, op.y);
    } else if (op.t === 'rect') {
      if (op.fill) doc.setFillColor(op.fill);
      if (op.stroke) {
        doc.setDrawColor(op.stroke);
        doc.setLineWidth(op.lw || 0.5);
      }
      const style = op.fill && op.stroke ? 'FD' : op.fill ? 'F' : 'S';
      if (op.r) doc.roundedRect(op.x, op.y, op.w, op.h, op.r, op.r, style);
      else doc.rect(op.x, op.y, op.w, op.h, style);
    } else if (op.t === 'line') {
      doc.setDrawColor(op.color);
      doc.setLineWidth(op.lw);
      doc.line(op.x1, op.y1, op.x2, op.y2);
    } else if (op.t === 'frame') {
      const pxW = U.clamp((op.w / 72) * DPI, 400, 2400);
      const pxH = pxW * (op.h / op.w);
      const data = jpegFor((ctx, W, H) => R.drawFrame(ctx, project.frames[op.idx], W, H, { full: true, emptyFill: '#f1f1f4', emptyLabel: false }), pxW, pxH);
      doc.addImage(data, 'JPEG', op.x, op.y, op.w, op.h, undefined, 'FAST');
    } else if (op.t === 'cover') {
      const im = S.images.get(project.cover.imageId);
      if (!im) return;
      const pxW = Math.min(im.w, U.clamp((op.w / 72) * DPI, 400, 2400));
      const pxH = pxW * (op.h / op.w);
      const data = jpegFor((ctx, W, H) => {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im.img, 0, 0, W, H);
      }, pxW, pxH);
      doc.addImage(data, 'JPEG', op.x, op.y, op.w, op.h, undefined, 'FAST');
    }
  }

  P.settings = function () {
    const s = Object.assign({}, S.project.exportSettings);
    s.includeCover = !!S.project.cover.include;
    return s;
  };

  P.exportPDF = async function (onProgress) {
    const project = S.project;
    const settings = P.settings();
    const { L, pages } = P.buildPages(project, settings);
    const { jsPDF } = window.jspdf;
    const orientation = L.pageW > L.pageH ? 'landscape' : 'portrait';
    const doc = new jsPDF({ unit: 'pt', format: [L.pageW, L.pageH], orientation, compress: true });
    doc.setProperties({ title: P.sanitize(project.title || 'Storyboard'), creator: 'Storyboard Maker' });
    const totalImages = project.frames.length + (settings.includeCover && project.cover.imageId ? 1 : 0);
    let done = 0;
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) doc.addPage([L.pageW, L.pageH], orientation);
      for (const op of P.pageOps(project, settings, L, pages[i])) {
        drawOpPDF(doc, op, project);
        if (op.t === 'frame' || op.t === 'cover') {
          done++;
          if (onProgress) onProgress(done / Math.max(1, totalImages));
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
    return { blob: doc.output('blob'), filename: U.safeFilename(project.title, 'storyboard') + '.pdf', pages: pages.length };
  };

  /* ---------- Export dialog ---------- */

  let dlg;
  let previewPage = 0;
  let busy = false;
  const $ = (id) => document.getElementById(id);

  P.init = function () {
    dlg = $('export-dialog');
    const sizeSel = $('ex-size');
    for (const [k, v] of Object.entries(P.PAGE_SIZES)) sizeSel.append(U.h('option', { value: k, text: v.label }));
    const perHost = $('ex-perpage');
    for (const n of P.PER_PAGE) perHost.append(U.h('button', { type: 'button', class: 'seg-btn', dataset: { per: String(n) }, text: String(n) }));
    perHost.addEventListener('click', (e) => {
      const b = e.target.closest('[data-per]');
      if (b) change({ perPage: +b.dataset.per });
    });
    U.$$('#ex-orient [data-orient]').forEach((b) => b.addEventListener('click', () => change({ orientation: b.dataset.orient })));
    sizeSel.addEventListener('change', () => change({ pageSize: sizeSel.value }));
    $('ex-labels').addEventListener('change', (e) => change({ showLabels: e.target.checked }));
    $('ex-header').addEventListener('change', (e) => change({ headerFooter: e.target.checked }));
    $('ex-cover').addEventListener('change', (e) => S.update((p) => (p.cover.include = e.target.checked), null, { source: 'export' }));
    $('ex-prev').addEventListener('click', () => {
      previewPage--;
      renderPreview();
    });
    $('ex-next').addEventListener('click', () => {
      previewPage++;
      renderPreview();
    });
    $('ex-cancel').addEventListener('click', () => dlg.close());
    $('ex-download').addEventListener('click', download);
    dlg.addEventListener('cancel', (e) => {
      if (busy) e.preventDefault();
    });
    S.subscribe(() => {
      if (dlg.open) sync();
    });
    new ResizeObserver(() => dlg.open && renderPreview()).observe($('ex-preview-wrap'));
  };

  function change(patch) {
    S.update((p) => Object.assign(p.exportSettings, patch), null, { source: 'export' });
  }

  P.open = function () {
    if (!S.project.frames.length && !S.project.cover.include) {
      U.toast('Add some frames first, then export.');
      return;
    }
    previewPage = 0;
    dlg.showModal();
    sync();
  };

  function sync() {
    const s = P.settings();
    U.$$('#ex-perpage [data-per]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.per === +s.perPage)));
    U.$$('#ex-orient [data-orient]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.orient === s.orientation)));
    $('ex-size').value = s.pageSize;
    $('ex-labels').checked = !!s.showLabels;
    $('ex-header').checked = !!s.headerFooter;
    $('ex-cover').checked = !!s.includeCover;
    renderPreview();
  }

  function renderPreview() {
    const project = S.project;
    const settings = P.settings();
    const { L, pages } = P.buildPages(project, settings);
    const framePages = pages.filter((p) => p.type === 'frames').length;
    $('ex-summary').textContent =
      `${project.frames.length} frame${project.frames.length === 1 ? '' : 's'} · ${framePages} page${framePages === 1 ? '' : 's'}` +
      (settings.includeCover ? ' + cover' : '');
    $('ex-download').disabled = !pages.length || busy;
    const wrap = $('ex-preview-wrap');
    const canvas = $('ex-preview');
    if (!pages.length) {
      canvas.width = 1;
      canvas.height = 1;
      $('ex-page-label').textContent = 'Nothing to export';
      return;
    }
    previewPage = U.clamp(previewPage, 0, pages.length - 1);
    $('ex-prev').disabled = previewPage === 0;
    $('ex-next').disabled = previewPage >= pages.length - 1;
    const page = pages[previewPage];
    $('ex-page-label').textContent = page.type === 'cover' ? `Cover · ${previewPage + 1} of ${pages.length}` : `Page ${previewPage + 1} of ${pages.length}`;
    const maxW = Math.max(100, wrap.clientWidth - 8);
    const maxH = Math.max(100, wrap.clientHeight - 8);
    const scale = Math.min(maxW / L.pageW, maxH / L.pageH);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.round(L.pageW * scale) + 'px';
    canvas.style.height = Math.round(L.pageH * scale) + 'px';
    canvas.width = Math.round(L.pageW * scale * dpr);
    canvas.height = Math.round(L.pageH * scale * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, L.pageW, L.pageH);
    drawOpsCanvas(ctx, P.pageOps(project, settings, L, page), project);
  }

  async function download() {
    if (busy) return;
    busy = true;
    const bar = $('ex-progress');
    const btn = $('ex-download');
    btn.disabled = true;
    bar.hidden = false;
    bar.value = 0;
    try {
      const out = await P.exportPDF((v) => (bar.value = v));
      U.downloadBlob(out.blob, out.filename);
      dlg.close();
      U.toast(`Exported ${out.filename} (${out.pages} page${out.pages === 1 ? '' : 's'})`);
    } catch (e) {
      console.error(e);
      U.toast('Could not create the PDF: ' + e.message, { type: 'error', duration: 8000 });
    } finally {
      busy = false;
      bar.hidden = true;
      btn.disabled = false;
    }
  }
})(window.SB);
