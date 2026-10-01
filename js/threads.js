/* Storyboard Maker — comment thread rendering shared by the app's feedback panel and the client review page. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const T = (SB.threads = {});

  /**
   * Keeps unsent text (replies, edits) and focus across live re-renders.
   * Call capture() before replacing the DOM and restore(root) after.
   */
  T.Drafts = function () {
    const drafts = new Map();
    let focus = null;
    return {
      get: (k) => drafts.get(k),
      set: (k, v) => drafts.set(k, v),
      delete: (k) => drafts.delete(k),
      has: (k) => drafts.has(k),
      capture() {
        const el = document.activeElement;
        focus = el && el.dataset && el.dataset.draft ? { key: el.dataset.draft, field: el.dataset.draftField || '', s: el.selectionStart, e: el.selectionEnd } : null;
      },
      restore(root) {
        if (!focus) return;
        const el = root.querySelector(`[data-draft="${CSS.escape(focus.key)}"][data-draft-field="${CSS.escape(focus.field)}"]`);
        if (el) {
          el.focus({ preventScroll: true });
          try {
            el.setSelectionRange(focus.s, focus.e);
          } catch (e) {
            /* ignore */
          }
        }
        focus = null;
      },
    };
  };

  function draftArea(drafts, key, field, value, placeholder, rows) {
    const ta = U.h('textarea', { class: 'input', rows: String(rows || 2), placeholder, dataset: { draft: key, draftField: field || '' } });
    ta.value = value;
    ta.addEventListener('input', () => {
      const d = drafts.get(key) || {};
      d[field || 'body'] = ta.value;
      drafts.set(key, d);
      U.autoGrow(ta);
    });
    requestAnimationFrame(() => U.autoGrow(ta));
    return ta;
  }

  function avatar(name, isTeam) {
    return U.h('div', { class: 'avatar', style: `background:${isTeam ? 'var(--accent)' : U.avatarColor(name)}`, text: U.initials(name) });
  }

  /**
   * Render one thread.
   * ctx: {
   *   uid, canModerate, drafts, pin, context (string), active (bool),
   *   fieldLabel(fieldId), onReply(root, text), onEdit(comment, patch), onDelete(comment, replies),
   *   onResolve(root, resolved), onAccept(root)?, onSelect(root)?, replyLabel
   * }
   */
  T.render = function (thread, ctx) {
    const { root, replies } = thread;
    const resolved = root.status === 'resolved';
    const el = U.h('div', { class: 'thread' + (resolved ? ' is-resolved' : '') + (ctx.active ? ' is-active' : ''), dataset: { thread: root.id } });
    el.append(
      U.h(
        'div',
        { class: 'thread-context' },
        U.h('span', { class: 'pin-num', text: String(thread.pin) }),
        U.h('span', { text: ctx.context || '' }),
        resolved ? U.h('span', { class: 'status-badge', title: root.resolvedBy ? `Resolved by ${root.resolvedBy}` : 'Resolved', text: root.resolvedBy && /accepted/i.test(root.resolvedBy) ? 'Accepted' : 'Resolved' }) : null
      )
    );
    el.append(message(root, ctx, true, replies));
    if (replies.length) el.append(U.h('div', { class: 'replies' }, replies.map((r) => message(r, ctx, false))));

    const actions = U.h('div', { class: 'thread-actions' });
    if (ctx.canModerate) {
      if (root.kind === 'suggestion' && !resolved && ctx.onAccept) {
        actions.append(U.h('button', { type: 'button', class: 'btn btn-success btn-sm', html: U.icon('check', 15) + '<span>Accept edit</span>', onclick: () => ctx.onAccept(root) }));
      }
      actions.append(
        U.h('button', {
          type: 'button',
          class: 'btn btn-ghost btn-sm',
          text: resolved ? 'Reopen' : root.kind === 'suggestion' ? 'Dismiss' : 'Resolve',
          onclick: () => ctx.onResolve(root, !resolved),
        })
      );
    }
    // Reply composer (collapsed until asked for, unless a draft exists).
    const replyKey = 'reply:' + root.id;
    const replyHost = U.h('div');
    const openComposer = (focus) => {
      const d = ctx.drafts.get(replyKey) || { body: '' };
      ctx.drafts.set(replyKey, d);
      const ta = draftArea(ctx.drafts, replyKey, 'body', d.body || '', ctx.replyPlaceholder || 'Write a reply…', 2);
      const send = U.h('button', { type: 'button', class: 'btn btn-primary btn-sm', html: U.icon('send', 14) + '<span>Reply</span>' });
      const cancel = U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cancel' });
      const submit = async () => {
        const text = ta.value.trim();
        if (!text) return;
        // Clear right away (the reply appears instantly); bring the text back if sending fails.
        ctx.drafts.delete(replyKey);
        replyHost.replaceChildren();
        replyBtn.hidden = false;
        if ((await ctx.onReply(root, text)) === false) {
          ctx.drafts.set(replyKey, { body: text });
          if (el.isConnected) openComposer(true);
        }
      };
      send.addEventListener('click', submit);
      cancel.addEventListener('click', () => {
        ctx.drafts.delete(replyKey);
        replyHost.replaceChildren();
        replyBtn.hidden = false;
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      });
      replyHost.replaceChildren(U.h('div', { class: 'composer' }, ta, U.h('div', { class: 'composer-row' }, ctx.replyAs ? U.h('span', { class: 'muted small', text: ctx.replyAs }) : null, cancel, send)));
      replyBtn.hidden = true;
      if (focus) ta.focus();
    };
    const replyBtn = U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: U.icon('reply', 15) + '<span>Reply</span>', onclick: () => openComposer(true) });
    actions.prepend(replyBtn);
    el.append(actions, replyHost);
    if (ctx.drafts.has(replyKey)) openComposer(false);
    if (ctx.onSelect) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button, textarea, input, a')) return;
        ctx.onSelect(root);
      });
    }
    return el;
  };

  function message(c, ctx, isRoot, replies) {
    const mine = ctx.uid && c.authorUid === ctx.uid;
    const editKey = 'edit:' + c.id;
    const wrap = U.h('div', { class: 'msg', dataset: { cid: c.id } });
    const body = U.h('div');
    const head = U.h(
      'div',
      { class: 'msg-head' },
      U.h('span', { class: 'msg-name', text: c.authorName || 'Someone' }),
      c.isTeam ? U.h('span', { class: 'team-badge', text: 'Team' }) : null,
      U.h('span', { class: 'msg-time', title: U.fullTime(c.createdAt), text: U.timeAgo(c.createdAt) + (c.edited ? ' · edited' : '') })
    );
    body.append(head);

    const render = () => {
      body.replaceChildren(head);
      if (ctx.drafts.has(editKey)) {
        const d = ctx.drafts.get(editKey);
        const form = U.h('div', { class: 'composer' });
        let proposed = null;
        if (c.kind === 'suggestion' && c.suggestion) {
          form.append(U.h('div', { class: 'suggestion-label', text: `Suggested ${ctx.fieldLabel(c.suggestion.fieldId)}` }));
          proposed = draftArea(ctx.drafts, editKey, 'proposed', d.proposed != null ? d.proposed : c.suggestion.proposed, 'Suggested text', 3);
          form.append(proposed, U.h('div', { class: 'suggestion-label', text: 'Note (optional)' }));
        }
        const ta = draftArea(ctx.drafts, editKey, 'body', d.body != null ? d.body : c.body || '', c.kind === 'suggestion' ? 'Why this change? (optional)' : 'Comment', 2);
        const save = U.h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Save' });
        const cancel = U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Cancel' });
        save.addEventListener('click', async () => {
          const patch = { body: ta.value.trim() };
          if (proposed) {
            if (!proposed.value.trim() && !c.suggestion.original) return;
            patch.suggestion = Object.assign({}, c.suggestion, { proposed: proposed.value });
          } else if (!patch.body) return;
          const draft = ctx.drafts.get(editKey);
          ctx.drafts.delete(editKey);
          Object.assign(c, patch);
          render();
          if ((await ctx.onEdit(c, patch)) === false) {
            ctx.drafts.set(editKey, draft || {});
            if (wrap.isConnected) render();
          }
        });
        cancel.addEventListener('click', () => {
          ctx.drafts.delete(editKey);
          render();
        });
        form.append(ta, U.h('div', { class: 'composer-row' }, cancel, save));
        body.append(form);
        return;
      }
      if (c.kind === 'suggestion' && c.suggestion) {
        const s = c.suggestion;
        const label = ctx.fieldLabel(s.fieldId);
        body.append(
          U.h(
            'div',
            { class: 'suggestion' },
            U.h('div', { class: 'suggestion-label', text: s.original ? `Suggested edit · ${label}` : `Suggested ${label}` }),
            U.renderDiff(s.original || '', s.proposed || '')
          )
        );
      }
      if ((c.body || '').trim()) body.append(U.h('div', { class: 'msg-body', text: c.body }));
      const acts = U.h('div', { class: 'msg-actions' });
      if (mine) {
        acts.append(
          U.h('button', {
            type: 'button',
            text: 'Edit',
            onclick: () => {
              ctx.drafts.set(editKey, {});
              render();
              const first = body.querySelector('textarea');
              if (first) first.focus();
            },
          })
        );
      }
      if (mine || ctx.canModerate) {
        acts.append(
          U.h('button', {
            type: 'button',
            class: 'danger',
            text: 'Delete',
            onclick: async () => {
              const n = isRoot ? (replies || []).length : 0;
              const ok = await U.confirm(
                isRoot ? 'Delete this comment?' : 'Delete this reply?',
                n ? `Its ${n} repl${n === 1 ? 'y' : 'ies'} will be deleted too.` : 'This can’t be undone.',
                'Delete',
                true
              );
              if (ok) ctx.onDelete(c, isRoot ? replies : []);
            },
          })
        );
      }
      if (acts.childNodes.length) body.append(acts);
    };
    render();
    wrap.append(avatar(c.authorName, c.isTeam), body);
    return wrap;
  }
})(window.SB);
