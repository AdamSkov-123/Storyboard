/* Storyboard Maker — home page: team storyboards (when signed in) and storyboards on this computer. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const H = (SB.home = {});
  const T = () => SB.team;

  let root;
  let query = '';
  let sort = U.storage.get('sb-home-sort', 'updated');
  let menu = null; // {el, id, kind}
  let pendingRender = false;

  const GOOGLE_G =
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';

  H.init = function () {
    root = document.getElementById('home-view');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', (e) => {
      const card = e.target.closest && e.target.closest('.home-card[data-id]');
      if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        SB.app.go(card.dataset.id);
      }
    });
    document.addEventListener('click', (e) => {
      if (menu && !e.target.closest('.home-menu, [data-act="menu"], [data-act="account"]')) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu) closeMenu();
    });
    window.addEventListener('resize', () => menu && closeMenu());
    setInterval(() => !root.hidden && T().isMember() && !menu && document.activeElement?.tagName !== 'INPUT' && H.render(), 60000);
  };

  const titleOf = (r) => r.title || 'Untitled storyboard';
  const millis = (t) => {
    const d = U.toDate(t);
    return d ? d.getTime() : 0;
  };

  function sorted(list) {
    const by = {
      updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      name: (a, b) => !a.title - !b.title || U.naturalCompare(titleOf(a), titleOf(b)),
    };
    return list.slice().sort(by[sort] || by.updated);
  }

  function matches(r) {
    if (!query) return true;
    const q = query.toLowerCase();
    return titleOf(r).toLowerCase().includes(q) || (r.client || '').toLowerCase().includes(q);
  }

  function teamRows() {
    return T().boards.map((b) => ({
      id: b.id,
      team: true,
      title: b.title || '',
      client: b.client || '',
      frames: b.frames || 0,
      shared: !!b.shared,
      thumb: b.thumb || null,
      updatedAt: millis(b.updatedAt),
      createdAt: millis(b.createdAt),
      updatedBy: b.updatedBy || '',
      lock: T().lockState(b),
      lockName: b.lock ? b.lock.name || b.lock.email : '',
    }));
  }

  const fmtBytes = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  /* ---------- Page ---------- */

  H.render = function () {
    if (!root) return;
    if (menu) {
      // Don't yank a menu away while someone is using it; redraw when it closes.
      pendingRender = true;
      return;
    }
    const focusedSearch = document.activeElement && document.activeElement.classList.contains('home-search');
    document.title = 'Storyboards – Storyboard Maker';
    const team = T();
    const local = S.listProjects().filter((r) => !r.team);
    const member = team.isMember();
    const rows = member ? teamRows() : [];

    const header = U.h(
      'header',
      { class: 'home-top' },
      U.h('div', { class: 'brand', html: U.icon('logo', 22) + '<span class="brand-name">Storyboard Maker</span>' }),
      U.h('span', { class: 'spacer' }),
      accountArea(),
      U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'import' }, title: 'Open project file', html: U.icon('file', 16) + '<span class="hide-sm">Open project file</span>' }),
      U.h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'new' }, html: U.icon('plus', 16) + '<span>New storyboard</span>' })
    );
    const body = U.h('section', { class: 'home-body' });
    const total = rows.length + local.length;
    const head = U.h(
      'div',
      { class: 'home-head' },
      U.h(
        'div',
        {},
        U.h('h1', { text: member && team.teamName ? team.teamName : 'Your storyboards' }),
        U.h('p', { class: 'muted small', text: member ? `${rows.length} team storyboard${rows.length === 1 ? '' : 's'}` + (local.length ? ` · ${local.length} only on this computer` : '') : total ? `${total} storyboard${total === 1 ? '' : 's'} saved in this browser` : 'Saved in this browser' })
      )
    );
    if (total > 1) {
      const search = U.h('input', { type: 'search', class: 'input home-search', placeholder: 'Search by title or client', 'aria-label': 'Search storyboards', value: query });
      search.addEventListener('input', () => {
        query = search.value.trim();
        renderGrids();
      });
      const sortSel = U.h(
        'select',
        { class: 'input home-sort', 'aria-label': 'Sort storyboards' },
        [
          ['updated', 'Last edited'],
          ['created', 'Newest first'],
          ['name', 'Name'],
        ].map(([v, label]) => U.h('option', { value: v, text: label, selected: sort === v }))
      );
      sortSel.addEventListener('change', () => {
        sort = sortSel.value;
        U.storage.set('sb-home-sort', sort);
        renderGrids();
      });
      head.append(U.h('div', { class: 'home-filters' }, search, sortSel));
    }
    body.append(head);
    if (!S.persistent) {
      body.append(U.h('p', { class: 'notice notice-warn', text: 'This browser can’t store storyboards, so they disappear when you close the page. Use File → Save project inside a storyboard to keep your work.' }));
    }
    const status = teamStatusCard();
    if (status) body.append(status);

    let teamGrid = null;
    if (member) {
      teamGrid = U.h('div', { class: 'home-grid' });
      body.append(
        U.h(
          'section',
          { class: 'home-section' },
          U.h(
            'div',
            { class: 'home-section-head' },
            U.h('div', {}, U.h('h2', { text: 'Team storyboards' }), U.h('p', { class: 'muted small', text: 'Everyone on the team can see these, on any computer. One person edits at a time.' })),
            storageMeter()
          ),
          teamGrid
        )
      );
    }
    const localGrid = U.h('div', { class: 'home-grid' });
    if (!member || local.length) {
      const sectionHead = member
        ? U.h(
            'div',
            { class: 'home-section-head' },
            U.h('div', {}, U.h('h2', { text: 'On this computer only' }), U.h('p', { class: 'muted small', text: 'Your teammates can’t see these. Use ⋯ → Move to team to share one.' })),
            local.length > 1 ? U.h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { act: 'move-all' }, text: `Move all ${local.length} to team` }) : null
          )
        : null;
      body.append(U.h('section', { class: 'home-section' }, sectionHead, localGrid));
    }
    body.append(
      U.h('p', {
        class: 'home-note muted small',
        text: member
          ? 'Team storyboards are saved online and on each computer that opens them. Storyboards “on this computer only” stay in this browser.'
          : 'Storyboards are saved in this browser on this computer. To back one up or move it to another computer, use its ⋯ menu → Save project file, then open that file there.',
      })
    );
    root.replaceChildren(header, body);

    function renderGrids() {
      if (teamGrid) renderGrid(teamGrid, rows, 'team');
      renderGrid(localGrid, local, member ? 'local-only' : 'local');
    }
    renderGrids();
    if (focusedSearch) {
      const s = root.querySelector('.home-search');
      if (s) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }
  };

  function accountArea() {
    const team = T();
    if (!team.available()) return null;
    if (team.user && team.status !== 'signed-out') {
      const u = team.user;
      return U.h(
        'div',
        { class: 'account' },
        U.h(
          'button',
          { type: 'button', class: 'account-btn', dataset: { act: 'account' }, 'aria-haspopup': 'true', title: u.email },
          u.photo ? U.h('img', { src: u.photo, alt: '', referrerpolicy: 'no-referrer' }) : U.h('span', { class: 'avatar', style: `background:${U.avatarColor(u.email)}`, text: U.initials(u.name || u.email) }),
          U.h('span', { class: 'hide-sm', text: (u.name || u.email).split(' ')[0] })
        )
      );
    }
    if (team.status === 'signed-out') {
      return U.h('button', { type: 'button', class: 'btn btn-ghost google-btn', dataset: { act: 'signin' }, html: GOOGLE_G + '<span>Sign in</span>' });
    }
    return null;
  }

  function teamStatusCard() {
    const team = T();
    const card = (title, text, ...actions) => U.h('div', { class: 'team-card' }, U.h('div', {}, U.h('h3', { text: title }), U.h('p', { text })), ...actions);
    switch (team.status) {
      case 'off':
        return card(
          'Work on storyboards as a team',
          'To see and edit storyboards with your team on any computer, connect a free Firebase project (the same one client links use). If a teammate already did, ask them for the team link and open it here instead.',
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'connect' }, text: 'Connect Firebase…' })
        );
      case 'loading':
        return card('Team storyboards', 'Checking your team…');
      case 'signed-out':
        return card(
          'Work on storyboards as a team',
          'Sign in with your Google account to see and edit your team’s storyboards on any computer.',
          U.h('button', { type: 'button', class: 'btn btn-primary google-btn', dataset: { act: 'signin' }, html: GOOGLE_G + '<span>Sign in with Google</span>' })
        );
      case 'no-team':
        return card(
          'Set up your team',
          `You’re signed in as ${team.user.email}. Nobody has set up a team in this Firebase project yet. If you set it up, you’ll be the team admin and can approve teammates.`,
          U.h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'setup-team' }, text: 'Set up team' }),
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'signout' }, text: 'Sign out' })
        );
      case 'not-approved':
        return card(
          'Waiting for approval',
          team.domain
            ? `You’re signed in as ${team.user.email}, which isn’t part of the team. People with @${team.domain} Google accounts join automatically. If that’s you, sign out and sign in with that account. Otherwise, ask a team admin to approve this email under Team members.`
            : `You’re signed in as ${team.user.email}, but this email hasn’t been approved yet. Ask a team admin to add it under Team members, then click Check again.`,
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'recheck' }, text: 'Check again' }),
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'signout' }, text: 'Sign out' })
        );
      case 'removed':
        return card(
          'No access to the team',
          `${team.user.email} was removed from ${team.teamName || 'the team'}. If that’s a mistake, ask a team admin to restore you under Team members.`,
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'recheck' }, text: 'Check again' }),
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'signout' }, text: 'Sign out' })
        );
      case 'error':
        return U.h(
          'div',
          { class: 'team-card' },
          U.h('div', {}, U.h('h3', { text: 'Couldn’t load team storyboards' }), U.h('p', { class: 'notice notice-warn', text: team.error })),
          /security rules/.test(team.error) ? U.h('button', { type: 'button', class: 'btn btn-ghost', text: 'Copy security rules', onclick: () => team.copyRules() }) : null,
          U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'recheck' }, text: 'Try again' })
        );
      default:
        return null;
    }
  }

  function storageMeter() {
    const u = T().usage();
    const pct = Math.min(100, (u.used / u.limit) * 100);
    const cls = pct >= 95 ? ' is-full' : pct >= 80 ? ' is-warn' : '';
    const right = pct >= 95 ? 'Almost full: delete old storyboards or client links to free space' : `about ${u.framesLeft.toLocaleString()} more frames`;
    return U.h(
      'div',
      { class: 'storage' + cls, title: `Free Firebase plan: 1 GB in total, shared by all team storyboards and client links. ${u.frames.toLocaleString()} frames stored now.` },
      U.h('div', { class: 'storage-bar', role: 'meter', 'aria-label': 'Team storage used', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, U.h('div', { class: 'storage-fill', style: `width:${Math.max(pct, 1)}%` })),
      U.h('div', { class: 'storage-text' }, U.h('span', { text: `${fmtBytes(u.used)} of 1 GB used` }), U.h('span', { text: right }))
    );
  }

  function renderGrid(grid, all, kind) {
    const list = sorted(all.filter(matches));
    grid.replaceChildren();
    if (!all.length && kind !== 'local-only') {
      grid.append(
        U.h(
          'div',
          { class: 'empty-state home-empty' },
          U.h('div', { class: 'empty-icon', html: U.icon('logo', 36) }),
          U.h('h2', { text: kind === 'team' ? 'No team storyboards yet' : 'No storyboards yet' }),
          U.h('p', { text: kind === 'team' ? 'Start one with New storyboard, or drop images anywhere on this page. Storyboards you start now are shared with the team.' : 'Start a new storyboard, or open a .storyboard project file. You can also drop images anywhere on this page to start one with those images.' }),
          U.h(
            'div',
            { class: 'row-gap' },
            U.h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'new' }, html: U.icon('plus', 16) + '<span>New storyboard</span>' }),
            U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'import' }, html: U.icon('file', 16) + '<span>Open project file</span>' })
          )
        )
      );
      return;
    }
    if (!query && kind !== 'local-only') {
      grid.append(
        U.h(
          'button',
          { type: 'button', class: 'home-card home-new', dataset: { act: 'new' } },
          U.h('span', { class: 'add-tile-icon', html: U.icon('plus', 24) }),
          U.h('span', { class: 'add-tile-label', text: 'New storyboard' }),
          U.h('span', { class: 'muted small', text: 'or drop images anywhere' })
        )
      );
    }
    for (const r of list) grid.append(card(r));
    if (!list.length && query) grid.append(U.h('p', { class: 'muted home-none', text: `No storyboards match “${query}”.` }));
    if (kind !== 'team') loadThumbs(list.map((r) => r.id));
  }

  function card(r) {
    const meta = [r.client, `${r.frames || 0} frame${r.frames === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const edited = `Edited ${U.timeAgo(r.updatedAt)}` + (r.team && r.updatedBy ? ` by ${r.updatedBy}` : '');
    let lockBadge = null;
    if (r.lock === 'other') lockBadge = U.h('span', { class: 'home-badge is-locked', title: `${r.lockName} is editing this storyboard`, html: U.icon('edit', 12) + `<span>${escapeHTML(r.lockName.split(' ')[0])} is editing</span>` });
    else if (r.lock === 'me-elsewhere') lockBadge = U.h('span', { class: 'home-badge is-locked', title: 'Open for editing in another tab or on another computer', html: U.icon('edit', 12) + '<span>Open elsewhere</span>' });
    return U.h(
      'article',
      { class: 'home-card', tabindex: '0', role: 'link', dataset: { id: r.id, kind: r.team ? 'team' : 'local' }, 'aria-label': `Open ${titleOf(r)}` },
      U.h('div', { class: 'home-thumb' }, r.thumb ? U.h('img', { src: r.thumb, alt: '' }) : U.h('span', { class: 'home-thumb-empty', html: U.icon('image', 28) })),
      U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm home-card-menu', dataset: { act: 'menu' }, title: 'More actions', 'aria-label': `More actions for ${titleOf(r)}`, 'aria-haspopup': 'true', html: U.icon('more', 18) }),
      U.h(
        'div',
        { class: 'home-card-body' },
        U.h('h3', { class: 'home-card-title' + (r.title ? '' : ' is-untitled'), text: titleOf(r) }),
        U.h('p', { class: 'muted small', text: meta }),
        U.h(
          'div',
          { class: 'home-card-foot' },
          U.h('span', { class: 'muted small', title: U.fullTime(r.updatedAt), text: edited }),
          lockBadge || (r.shared ? U.h('span', { class: 'home-badge', html: U.icon('link', 12) + '<span>Client link</span>' }) : null)
        )
      )
    );
  }

  function escapeHTML(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  let thumbRun = 0;
  async function loadThumbs(ids) {
    const run = ++thumbRun;
    for (const id of ids) {
      if (run !== thumbRun) return;
      const thumb = await S.ensureThumb(id).catch(() => null);
      const box = root.querySelector(`.home-card[data-id="${CSS.escape(id)}"] .home-thumb`);
      if (!box) continue;
      const img = box.querySelector('img');
      if (thumb && (!img || img.getAttribute('src') !== thumb)) box.replaceChildren(U.h('img', { src: thumb, alt: '' }));
    }
  }

  /* ---------- Menus ---------- */

  function placeMenu(el, btn) {
    document.body.append(el);
    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.position = 'fixed';
    el.style.top = Math.min(window.innerHeight - el.offsetHeight - 8, r.bottom + 6) + 'px';
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    el.style.right = 'auto';
    btn.setAttribute('aria-expanded', 'true');
    const first = el.querySelector('button');
    if (first) first.focus();
  }

  function openMenu(btn, id, kind) {
    closeMenu();
    const item = (act, text, cls) => U.h('button', { type: 'button', role: 'menuitem', class: cls || null, dataset: { menu: act }, text });
    const items = [item('open', 'Open')];
    if (kind === 'local' && T().isMember()) items.push(item('move', 'Move to team'));
    items.push(item('duplicate', 'Duplicate'), item('save', 'Save project file…'), U.h('div', { class: 'menu-sep' }), item('delete', kind === 'team' ? 'Delete for everyone…' : 'Delete…', 'danger'));
    const el = U.h('div', { class: 'menu-pop home-menu', role: 'menu' }, items);
    el.addEventListener('click', (e) => {
      const it = e.target.closest('[data-menu]');
      if (!it) return;
      closeMenu();
      runAction(it.dataset.menu, id, kind);
    });
    placeMenu(el, btn);
    menu = { el, id, kind };
  }

  function openAccountMenu(btn) {
    closeMenu();
    const team = T();
    const el = U.h(
      'div',
      { class: 'menu-pop home-menu', role: 'menu' },
      U.h('div', { class: 'account-email', text: `Signed in as ${team.user.email}` + (team.isAdmin() ? ' (admin)' : '') }),
      team.isMember() ? U.h('button', { type: 'button', role: 'menuitem', dataset: { menu: 'members' }, text: team.isAdmin() ? 'Team members & approvals…' : 'Team members…' }) : null,
      U.h('button', { type: 'button', role: 'menuitem', dataset: { menu: 'link' }, text: 'Copy link for teammates' }),
      U.h('div', { class: 'menu-sep' }),
      U.h('button', { type: 'button', role: 'menuitem', dataset: { menu: 'signout' }, text: 'Sign out' })
    );
    el.addEventListener('click', (e) => {
      const it = e.target.closest('[data-menu]');
      if (!it) return;
      closeMenu();
      if (it.dataset.menu === 'members') T().openMembers();
      else if (it.dataset.menu === 'link') T().copyLink();
      else if (it.dataset.menu === 'signout') signOut();
    });
    placeMenu(el, btn);
    menu = { el, id: 'account', kind: 'account' };
  }

  function closeMenu() {
    if (!menu) return;
    menu.el.remove();
    U.$$('[aria-expanded="true"]', root).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    menu = null;
    if (pendingRender) {
      pendingRender = false;
      setTimeout(H.render, 0);
    }
  }

  async function signOut() {
    const n = S.listProjects().filter((r) => r.team).length;
    const ok = await U.confirm('Sign out?', 'Team storyboards will be removed from this computer (they stay safe online). Storyboards that are only on this computer aren’t affected.' + (n ? '' : ''), 'Sign out');
    if (ok) await T().signOut();
  }

  async function runAction(act, id, kind) {
    const team = T();
    if (act === 'open') return SB.app.go(id);
    if (act === 'save') {
      if (kind === 'team') {
        const progress = U.toast('Downloading…', { duration: 0 });
        try {
          await team.download(id);
        } catch (e) {
          progress.close();
          U.toast('Couldn’t download it: ' + team.explain(e), { type: 'error' });
          return;
        }
        progress.close();
      }
      return SB.app.saveProjectFile(id);
    }
    if (act === 'move') {
      const newId = await team.moveToTeam(id);
      if (newId) {
        U.toast('Moved to the team');
        H.render();
      }
      return;
    }
    if (act === 'duplicate') {
      const copy = kind === 'team' ? await team.duplicateBoard(id) : await S.duplicateProject(id);
      if (copy) {
        H.render();
        U.toast('Storyboard duplicated');
        const el = root.querySelector(`.home-card[data-id="${CSS.escape(copy)}"]`);
        if (el) el.focus();
      }
      return;
    }
    if (act === 'delete') {
      if (kind === 'team') {
        if (await team.deleteBoard(id)) H.render();
      } else deleteProject(id);
    }
  }

  async function deleteProject(id) {
    const r = S.listProjects().find((x) => x.id === id);
    if (!r) return;
    const data = S.projectData(id);
    const review = data && data.review;
    const ok = await U.confirm(
      `Delete “${titleOf(r)}”?`,
      'This permanently removes the storyboard from this browser.' +
        (review ? ' Its client link will also be turned off and the comments on it deleted.' : '') +
        ' If you might need it later, save a project file first (⋯ → Save project file).',
      'Delete storyboard',
      true
    );
    if (!ok) return;
    if (review) {
      const progress = U.toast('Turning off the client link…', { duration: 0 });
      try {
        await SB.share.deleteOnline(review);
        progress.close();
      } catch (e) {
        progress.close();
        console.error(e);
        const anyway = await U.confirm(
          'Couldn’t turn off the client link',
          SB.cloud.explainError(e) + '\n\nDelete the storyboard anyway? Its client link will keep working, and you won’t be able to manage it any more.',
          'Delete anyway',
          true
        );
        if (!anyway) return;
      }
    }
    await S.deleteProject(id);
    H.render();
    U.toast(`Deleted “${titleOf(r)}”`);
  }

  async function setupTeam() {
    const domain = T().myDomain();
    const r = await U.choose({
      title: 'Set up your team',
      message: domain
        ? `Give your team a name. You’ll be its admin. Anyone with an @${domain} Google account will be able to join just by signing in, and you can approve other people by email. You can change this under Team members.`
        : 'Give your team a name. You’ll be its admin, and you can approve teammates by email afterwards.',
      input: { placeholder: 'e.g. Northlight Films', maxlength: 60 },
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: 'Create team', kind: 'primary' },
      ],
    });
    if (!r || r.id !== 'ok') return;
    try {
      await T().setupTeam(r.value.trim(), domain);
      U.toast(domain ? `Team created. Teammates with @${domain} accounts can sign in now.` : 'Team created. Add teammates from your account menu → Team members.', { duration: 8000 });
    } catch (e) {
      console.error(e);
      U.toast('Couldn’t set up the team: ' + T().explain(e), { type: 'error', duration: 9000 });
    }
  }

  async function moveAll() {
    const local = S.listProjects().filter((r) => !r.team);
    if (!(await U.confirm(`Move ${local.length} storyboards to the team?`, 'Your teammates will be able to see and edit them, on any computer.', 'Move to team'))) return;
    let moved = 0;
    for (const r of local) if (await T().moveToTeam(r.id)) moved++;
    H.render();
    U.toast(`Moved ${moved} storyboard${moved === 1 ? '' : 's'} to the team`);
  }

  function onClick(e) {
    const actEl = e.target.closest('[data-act]');
    const act = actEl && actEl.dataset.act;
    if (act === 'new') return SB.app.newProject();
    if (act === 'import') return SB.app.openProject();
    if (act === 'signin') return T().signIn();
    if (act === 'signout') return signOut();
    if (act === 'setup-team') return setupTeam();
    if (act === 'recheck') return T().init();
    if (act === 'connect') return SB.share.open({ setup: true, home: true });
    if (act === 'move-all') return moveAll();
    if (act === 'account') {
      e.stopPropagation();
      if (menu && menu.id === 'account') closeMenu();
      else openAccountMenu(actEl);
      return;
    }
    if (act === 'menu') {
      e.stopPropagation();
      const cardEl = actEl.closest('.home-card');
      const id = cardEl.dataset.id;
      if (menu && menu.id === id) closeMenu();
      else openMenu(actEl, id, cardEl.dataset.kind);
      return;
    }
    const cardEl = e.target.closest('.home-card[data-id]');
    if (cardEl) SB.app.go(cardEl.dataset.id);
  }
})(window.SB);
