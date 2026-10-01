/* Storyboard Maker — client feedback panel: grouped comments, suggested edits, replies, resolve/accept. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const C = SB.cloud;
  const FB = (SB.feedback = {});

  const $ = (id) => document.getElementById(id);
  let panel;
  let conn = null;
  let unsub = null;
  let watchingId = null;
  let comments = [];
  let status = 'idle'; // idle | connecting | live | error
  let errorText = '';
  let filter = 'open';
  let focusTarget = null;
  const drafts = SB.threads.Drafts();

  FB.init = function () {
    panel = $('feedback-panel');
    S.subscribe((meta) => {
      if (meta.unchanged) return;
      if ((S.project.review && S.project.review.id) !== watchingId) FB.connect();
      else if (!panel.hidden) render();
    });
    FB.connect();
    setInterval(() => {
      if (!panel.hidden && status === 'live' && !document.activeElement?.dataset?.draft) render();
    }, 60000);
  };

  FB.isOpen = () => !panel.hidden;
  FB.toggle = () => (panel.hidden ? FB.open() : FB.close());
  FB.close = () => {
    panel.hidden = true;
  };
  FB.open = function (target) {
    panel.hidden = false;
    focusTarget = target || null;
    if (target) filter = 'open';
    render();
    if (target) {
      const g = panel.querySelector(`[data-group="${CSS.escape(target)}"]`);
      if (g) g.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  /** (Re)start listening to comments for the current project's review link. */
  FB.connect = async function () {
    const review = S.project.review;
    const id = review ? review.id : null;
    if (id === watchingId && status !== 'error') return;
    if (unsub) unsub();
    unsub = null;
    comments = [];
    watchingId = id;
    if (!review) {
      status = 'idle';
      updateBadges();
      if (!panel.hidden) render();
      return;
    }
    status = 'connecting';
    if (!panel.hidden) render();
    try {
      conn = await C.connect(SB.share.projectCfg(review));
      if (watchingId !== id) return;
      unsub = C.watchComments(
        conn,
        id,
        (list) => {
          comments = list;
          status = 'live';
          updateBadges();
          if (!panel.hidden) render();
        },
        (e) => {
          status = 'error';
          errorText = C.explainError(e);
          if (!panel.hidden) render();
        }
      );
    } catch (e) {
      status = 'error';
      errorText = C.explainError(e);
      if (!panel.hidden) render();
    }
  };

  /** Open thread counts per frame id (and 'cover', 'page') for the board badges. */
  FB.countsByTarget = function () {
    const counts = {};
    for (const t of C.threads(comments)) {
      if (t.root.status === 'resolved') continue;
      const k = C.targetKey(t.root);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  };

  function updateBadges() {
    const open = C.threads(comments).filter((t) => t.root.status !== 'resolved').length;
    const pill = $('feedback-count');
    pill.hidden = !open;
    pill.textContent = String(open);
    SB.board.requestRender();
  }

  const fieldLabel = (fid) => {
    const fd = S.project.fields.find((f) => f.id === fid);
    return fd ? fd.label : 'text';
  };

  function contextLabel(root) {
    const t = root.target || {};
    const key = C.targetKey(root);
    const parts = [];
    if (key === 'cover') parts.push('Cover');
    else if (key === 'page') parts.push('General');
    else {
      const idx = S.frameIndex(key);
      parts.push(idx >= 0 ? `Frame ${idx + 1}` : 'Removed frame');
    }
    const fid = (root.suggestion && root.suggestion.fieldId) || t.fieldId;
    if (fid) parts.push(fieldLabel(fid));
    else if (t.area === 'image') parts.push('Image');
    return parts.join(' · ');
  }

  /* ---------- Actions ---------- */

  async function ownerConn() {
    const review = S.project.review;
    const c = await C.connect(SB.share.projectCfg(review));
    await C.ensureOwner(c, review.id, review.key);
    return c;
  }

  async function run(fn, failMsg) {
    try {
      await fn();
      return true;
    } catch (e) {
      console.error(e);
      U.toast(`${failMsg}: ${C.explainError(e)}`, { type: 'error', duration: 8000 });
      return false;
    }
  }

  const ctxBase = {
    drafts,
    fieldLabel,
    canModerate: true,
    replyPlaceholder: 'Reply to the client…',
    async onReply(root, text) {
      const name = await SB.share.ensureTeamName();
      if (!name) return false;
      return run(async () => {
        const c = await ownerConn();
        await C.addComment(c, S.project.review.id, { kind: 'reply', parentId: root.id, body: text, authorName: name, isTeam: true });
      }, 'Couldn’t send the reply');
    },
    onEdit(c, patch) {
      return run(async () => C.editComment(await ownerConn(), S.project.review.id, c.id, patch), 'Couldn’t save');
    },
    onDelete(c, replies) {
      return run(async () => C.deleteComment(await ownerConn(), S.project.review.id, c, replies), 'Couldn’t delete');
    },
    onResolve(root, resolved) {
      return run(async () => C.setStatus(await ownerConn(), S.project.review.id, root.id, resolved ? 'resolved' : 'open', SB.share.settings().teamName || 'Team'), 'Couldn’t update');
    },
    onAccept: acceptSuggestion,
  };

  async function acceptSuggestion(root) {
    const s = root.suggestion || {};
    const frame = S.frameById(s.frameId);
    if (!frame) {
      U.toast('That frame no longer exists in your storyboard.', { type: 'error' });
      return;
    }
    if (!S.project.fields.some((f) => f.id === s.fieldId)) {
      U.toast('That field no longer exists. Add it back under Fields to accept this edit.', { type: 'error' });
      return;
    }
    const current = frame.text[s.fieldId] || '';
    if (current.trim() !== (s.original || '').trim() && current.trim() !== (s.proposed || '').trim()) {
      const ok = await U.confirm(
        'The text has changed since this suggestion',
        `Frame ${S.frameIndex(frame.id) + 1}’s ${fieldLabel(s.fieldId)} was edited after the client made this suggestion. Replace it with the suggested text anyway?`,
        'Replace text'
      );
      if (!ok) return;
    }
    S.update(() => {
      if ((s.proposed || '').trim()) frame.text[s.fieldId] = s.proposed;
      else delete frame.text[s.fieldId];
    }, null);
    await run(async () => C.setStatus(await ownerConn(), S.project.review.id, root.id, 'resolved', 'Accepted by ' + (SB.share.settings().teamName || 'Team')), 'Couldn’t mark it accepted');
    U.toast(`Applied to frame ${S.frameIndex(frame.id) + 1}. Update the link so the client sees it.`, {
      action: 'Update link',
      duration: 8000,
      onAction: () => SB.share.publish(),
    });
  }

  /* ---------- Rendering ---------- */

  function groupsFor(threads) {
    const groups = new Map();
    const add = (key, t) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    };
    for (const t of threads) add(C.targetKey(t.root), t);
    const ordered = [];
    if (groups.has('page')) ordered.push({ key: 'page', title: 'General', threads: groups.get('page') });
    if (groups.has('cover')) ordered.push({ key: 'cover', title: 'Cover page', threads: groups.get('cover') });
    S.project.frames.forEach((f, i) => {
      if (groups.has(f.id)) ordered.push({ key: f.id, title: `Frame ${i + 1}`, frame: f, threads: groups.get(f.id) });
    });
    const removed = [];
    for (const [k, list] of groups) if (k !== 'page' && k !== 'cover' && !S.frameById(k)) removed.push(...list);
    if (removed.length) ordered.push({ key: 'removed', title: 'Frames you’ve removed since', threads: removed });
    return ordered;
  }

  function miniThumb(frame, threads) {
    const box = U.h('div', { class: 'fb-thumb' });
    const c = SB.board.thumbnailFor(frame.id, 112);
    if (c) box.append(c);
    for (const t of threads) {
      const tg = t.root.target || {};
      if (tg.area !== 'image' || tg.x == null) continue;
      box.append(U.h('span', { class: 'mini-pin', style: `left:${tg.x * 100}%;top:${tg.y * 100}%`, text: String(t.pin) }));
    }
    return box;
  }

  function render() {
    if (panel.hidden) return;
    drafts.capture();
    const scroll = panel.querySelector('.fb-list')?.scrollTop || 0;
    panel.replaceChildren();
    const review = S.project.review;
    const head = U.h(
      'div',
      { class: 'fb-head' },
      U.h('div', { class: 'fb-title' }, U.h('h2', { text: 'Client feedback' }), U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Close feedback', title: 'Close', html: U.icon('x', 16), onclick: FB.close }))
    );
    panel.append(head);
    if (!review) {
      panel.append(
        U.h(
          'div',
          { class: 'fb-empty' },
          U.iconEl('message', 32),
          U.h('p', { text: 'Share a client link to collect comments and suggested edits here.' }),
          U.h('button', { type: 'button', class: 'btn btn-primary', html: U.icon('link', 15) + '<span>Create client link</span>', onclick: () => SB.share.open() })
        )
      );
      return;
    }
    if (status === 'connecting') {
      panel.append(U.h('div', { class: 'fb-empty', text: 'Loading feedback…' }));
      return;
    }
    if (status === 'error') {
      panel.append(U.h('div', { class: 'fb-setup' }, U.h('p', { class: 'notice notice-warn', text: errorText }), U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Try again', onclick: () => ((watchingId = null), FB.connect()) })));
      return;
    }
    const threads = C.threads(comments);
    const open = threads.filter((t) => t.root.status !== 'resolved');
    const resolved = threads.filter((t) => t.root.status === 'resolved');
    const shown = filter === 'open' ? open : filter === 'resolved' ? resolved : threads;
    const seg = U.h(
      'div',
      { class: 'seg' },
      [
        ['open', `Open ${open.length}`],
        ['resolved', `Resolved ${resolved.length}`],
        ['all', 'All'],
      ].map(([k, label]) =>
        U.h('button', {
          type: 'button',
          class: 'seg-btn',
          'aria-pressed': String(filter === k),
          text: label,
          onclick: () => {
            filter = k;
            render();
          },
        })
      )
    );
    head.append(
      U.h(
        'div',
        { class: 'fb-tools' },
        seg,
        U.h('span', { class: 'spacer' }),
        U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm', title: 'Copy feedback summary as text', 'aria-label': 'Copy summary', html: U.icon('copy', 16), onclick: copySummary }),
        U.h('a', { class: 'icon-btn icon-btn-sm', href: SB.share.link(), target: '_blank', rel: 'noopener', title: 'Open the client link', 'aria-label': 'Open client link', html: U.icon('eye', 16) })
      )
    );
    if (SB.share.isOutdated()) {
      head.append(
        U.h(
          'div',
          { class: 'notice small' },
          'Your latest changes aren’t on the client link yet. ',
          U.h('button', { type: 'button', class: 'link-btn', text: 'Update link', onclick: () => SB.share.publish() })
        )
      );
    }
    const list = U.h('div', { class: 'fb-list' });
    if (!shown.length) {
      list.append(
        U.h(
          'div',
          { class: 'fb-empty' },
          U.iconEl('message', 32),
          U.h('p', { text: filter === 'open' ? (threads.length ? 'All feedback is resolved. Nice work!' : 'No feedback yet. Comments appear here as soon as your client posts them.') : 'Nothing here.' })
        )
      );
    }
    const uid = conn ? conn.uid : null;
    for (const g of groupsFor(shown)) {
      const group = U.h('section', { class: 'fb-group', dataset: { group: g.key } });
      const gh = U.h('div', { class: 'fb-group-head' }, g.frame ? miniThumb(g.frame, g.threads) : null, U.h('div', {}, U.h('h3', { text: g.title }), U.h('span', { class: 'muted small', text: `${g.threads.length} thread${g.threads.length === 1 ? '' : 's'}` })));
      if (g.frame) gh.addEventListener('click', () => SB.editor.open(g.frame.id));
      group.append(gh);
      for (const t of g.threads) {
        group.append(SB.threads.render(t, Object.assign({}, ctxBase, { uid, pin: t.pin, context: contextLabel(t.root), active: focusTarget === g.key, replyAs: replyAsText(), onAccept: S.readOnly ? null : acceptSuggestion })));
      }
      list.append(group);
    }
    panel.append(list);
    list.scrollTop = scroll;
    drafts.restore(panel);
  }

  function replyAsText() {
    const n = SB.share.settings().teamName;
    return n ? `Replying as ${n}` : '';
  }

  async function copySummary() {
    const threads = C.threads(comments).filter((t) => filter === 'all' || (filter === 'resolved') === (t.root.status === 'resolved'));
    const lines = [`Client feedback: ${S.project.title || 'Untitled storyboard'}`, `${threads.length} ${filter === 'all' ? '' : filter + ' '}thread${threads.length === 1 ? '' : 's'}`, ''];
    const fmt = (c) => `${c.authorName}${c.isTeam ? ' (team)' : ''}, ${U.fullTime(c.createdAt)}`;
    for (const g of groupsFor(threads)) {
      lines.push(g.title.toUpperCase());
      for (const t of g.threads) {
        const r = t.root;
        if (r.kind === 'suggestion' && r.suggestion) {
          lines.push(`#${t.pin} ${fmt(r)} suggested a change to ${fieldLabel(r.suggestion.fieldId)}:`);
          if (r.suggestion.original) lines.push(`    Was: ${r.suggestion.original}`);
          lines.push(`    Suggested: ${r.suggestion.proposed}`);
          if ((r.body || '').trim()) lines.push(`    Note: ${r.body}`);
        } else {
          lines.push(`#${t.pin} ${fmt(r)}${r.target && r.target.area === 'image' ? ' (on the image)' : ''}:`);
          lines.push(`    ${r.body}`);
        }
        if (r.status === 'resolved') lines.push(`    [${r.resolvedBy || 'Resolved'}]`);
        for (const rep of t.replies) lines.push(`    ↳ ${fmt(rep)}: ${rep.body}`);
      }
      lines.push('');
    }
    U.toast((await U.copyText(lines.join('\n'))) ? 'Feedback summary copied' : 'Couldn’t copy to the clipboard');
  }
})(window.SB);
