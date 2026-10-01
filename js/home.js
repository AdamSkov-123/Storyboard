/* Storyboard Maker — home page: every storyboard saved in this browser, plus starting a new one. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const H = (SB.home = {});

  let root;
  let query = '';
  let sort = U.storage.get('sb-home-sort', 'updated');
  let menu = null; // {el, id}

  H.init = function () {
    root = document.getElementById('home-view');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', (e) => {
      const card = e.target.closest && e.target.closest('.home-card');
      if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        SB.app.go(card.dataset.id);
      }
    });
    document.addEventListener('click', (e) => {
      if (menu && !e.target.closest('.home-menu, [data-act="menu"]')) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu) closeMenu();
    });
    window.addEventListener('resize', () => menu && closeMenu());
  };

  const titleOf = (r) => r.title || 'Untitled storyboard';

  function sorted(list) {
    const by = {
      updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      name: (a, b) => (!a.title - !b.title) || U.naturalCompare(titleOf(a), titleOf(b)),
    };
    return list.slice().sort(by[sort] || by.updated);
  }

  function matches(r) {
    if (!query) return true;
    const q = query.toLowerCase();
    return titleOf(r).toLowerCase().includes(q) || (r.client || '').toLowerCase().includes(q);
  }

  H.render = function () {
    closeMenu();
    const all = S.listProjects();
    document.title = 'Storyboards – Storyboard Maker';
    const header = U.h(
      'header',
      { class: 'home-top' },
      U.h('div', { class: 'brand', html: U.icon('logo', 22) + '<span class="brand-name">Storyboard Maker</span>' }),
      U.h('span', { class: 'spacer' }),
      U.h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: 'import' }, html: U.icon('file', 16) + '<span class="hide-sm">Open project file</span>' }),
      U.h('button', { type: 'button', class: 'btn btn-primary', dataset: { act: 'new' }, html: U.icon('plus', 16) + '<span>New storyboard</span>' })
    );
    const body = U.h('section', { class: 'home-body' });
    const head = U.h(
      'div',
      { class: 'home-head' },
      U.h('div', {}, U.h('h1', { text: 'Your storyboards' }), U.h('p', { class: 'muted small', text: all.length ? `${all.length} storyboard${all.length === 1 ? '' : 's'} saved in this browser` : 'Saved in this browser' }))
    );
    if (all.length > 1) {
      const search = U.h('input', { type: 'search', class: 'input home-search', placeholder: 'Search by title or client', 'aria-label': 'Search storyboards', value: query });
      search.addEventListener('input', () => {
        query = search.value.trim();
        renderGrid(grid);
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
        renderGrid(grid);
      });
      head.append(U.h('div', { class: 'home-filters' }, search, sortSel));
    }
    body.append(head);
    if (!S.persistent) {
      body.append(U.h('p', { class: 'notice notice-warn', text: 'This browser can’t store storyboards, so they disappear when you close the page. Use File → Save project inside a storyboard to keep your work.' }));
    }
    const grid = U.h('div', { class: 'home-grid' });
    body.append(grid);
    body.append(U.h('p', { class: 'home-note muted small', text: 'Storyboards are saved in this browser on this computer. To back one up or move it to another computer, use its ⋯ menu → Save project file, then open that file there.' }));
    root.replaceChildren(header, body);
    renderGrid(grid);
  };

  function renderGrid(grid) {
    const all = S.listProjects();
    const list = sorted(all.filter(matches));
    grid.replaceChildren();
    if (!all.length) {
      grid.append(
        U.h(
          'div',
          { class: 'empty-state home-empty' },
          U.h('div', { class: 'empty-icon', html: U.icon('logo', 36) }),
          U.h('h2', { text: 'No storyboards yet' }),
          U.h('p', { text: 'Start a new storyboard, or open a .storyboard project file. You can also drop images anywhere on this page to start one with those images.' }),
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
    if (!query) {
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
    if (!list.length) grid.append(U.h('p', { class: 'muted home-none', text: `No storyboards match “${query}”.` }));
    loadThumbs(list.map((r) => r.id));
  }

  function card(r) {
    const meta = [r.client, `${r.frames || 0} frame${r.frames === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    return U.h(
      'article',
      { class: 'home-card', tabindex: '0', role: 'link', dataset: { id: r.id }, 'aria-label': `Open ${titleOf(r)}` },
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
          U.h('span', { class: 'muted small', title: U.fullTime(r.updatedAt), text: `Edited ${U.timeAgo(r.updatedAt)}` }),
          r.shared ? U.h('span', { class: 'home-badge', html: U.icon('link', 12) + '<span>Client link</span>' }) : null
        )
      )
    );
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

  /* ---------- Card menu ---------- */

  function openMenu(btn, id) {
    closeMenu();
    const el = U.h(
      'div',
      { class: 'menu-pop home-menu', role: 'menu' },
      U.h('button', { type: 'button', role: 'menuitem', dataset: { menu: 'open' }, text: 'Open' }),
      U.h('button', { type: 'button', role: 'menuitem', dataset: { menu: 'duplicate' }, text: 'Duplicate' }),
      U.h('button', { type: 'button', role: 'menuitem', dataset: { menu: 'save' }, text: 'Save project file…' }),
      U.h('div', { class: 'menu-sep' }),
      U.h('button', { type: 'button', role: 'menuitem', class: 'danger', dataset: { menu: 'delete' }, text: 'Delete…' })
    );
    document.body.append(el);
    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.position = 'fixed';
    el.style.top = Math.min(window.innerHeight - el.offsetHeight - 8, r.bottom + 6) + 'px';
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    el.style.right = 'auto';
    el.addEventListener('click', (e) => {
      const item = e.target.closest('[data-menu]');
      if (!item) return;
      closeMenu();
      runAction(item.dataset.menu, id);
    });
    menu = { el, id };
    btn.setAttribute('aria-expanded', 'true');
    el.querySelector('button').focus();
  }

  function closeMenu() {
    if (!menu) return;
    menu.el.remove();
    U.$$('[data-act="menu"][aria-expanded="true"]', root).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    menu = null;
  }

  async function runAction(act, id) {
    if (act === 'open') SB.app.go(id);
    else if (act === 'save') SB.app.saveProjectFile(id);
    else if (act === 'duplicate') {
      const copy = await S.duplicateProject(id);
      if (copy) {
        H.render();
        U.toast('Storyboard duplicated');
        const el = root.querySelector(`.home-card[data-id="${CSS.escape(copy)}"]`);
        if (el) el.focus();
      }
    } else if (act === 'delete') deleteProject(id);
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

  function onClick(e) {
    const actEl = e.target.closest('[data-act]');
    const act = actEl && actEl.dataset.act;
    if (act === 'new') return SB.app.newProject();
    if (act === 'import') return SB.app.openProject();
    if (act === 'menu') {
      e.stopPropagation();
      const id = actEl.closest('.home-card').dataset.id;
      if (menu && menu.id === id) closeMenu();
      else openMenu(actEl, id);
      return;
    }
    const cardEl = e.target.closest('.home-card[data-id]');
    if (cardEl) SB.app.go(cardEl.dataset.id);
  }
})(window.SB);
