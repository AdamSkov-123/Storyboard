/* Storyboard Maker — manage the text fields every frame has (add, rename, reorder, remove). */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const F = (SB.fieldsManager = {});

  let dlg;
  let list;
  const $ = (id) => document.getElementById(id);

  F.init = function () {
    dlg = $('fields-dialog');
    list = $('fields-list');
    $('fields-add').addEventListener('click', addField);
    $('fields-done').addEventListener('click', () => dlg.close());
    $('fields-reset').addEventListener('click', resetDefaults);
    list.addEventListener('input', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row || !e.target.matches('.field-label')) return;
      const id = row.dataset.id;
      S.update(
        (p) => {
          const fd = p.fields.find((x) => x.id === id);
          if (fd) fd.label = e.target.value;
        },
        'field-label:' + id,
        { source: 'fields' }
      );
    });
    list.addEventListener('change', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.matches('.field-label') && !e.target.value.trim()) {
        S.update((p) => (p.fields.find((x) => x.id === id).label = 'Untitled field'), null);
      }
      if (e.target.matches('.field-type')) {
        S.update((p) => (p.fields.find((x) => x.id === id).multiline = e.target.value === 'multi'), null, { source: 'fields' });
      }
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      if (b.dataset.act === 'up') moveField(id, -1);
      else if (b.dataset.act === 'down') moveField(id, 1);
      else if (b.dataset.act === 'remove') removeField(id);
    });
    S.subscribe((meta) => {
      if (dlg.open && meta.source !== 'fields') render();
    });
  };

  F.open = function () {
    render();
    dlg.showModal();
  };

  function render(focusId) {
    const fields = S.project.fields;
    list.replaceChildren(
      ...fields.map((fd, i) =>
        U.h(
          'li',
          { class: 'field-row', dataset: { id: fd.id } },
          U.h(
            'div',
            { class: 'field-order' },
            U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm', title: 'Move up', 'aria-label': 'Move up', dataset: { act: 'up' }, disabled: i === 0, html: U.icon('up', 16) }),
            U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm', title: 'Move down', 'aria-label': 'Move down', dataset: { act: 'down' }, disabled: i === fields.length - 1, html: U.icon('down', 16) })
          ),
          U.h('input', { type: 'text', class: 'input field-label', value: fd.label, 'aria-label': 'Field name', maxlength: '40' }),
          U.h(
            'select',
            { class: 'input field-type', 'aria-label': 'Field size' },
            U.h('option', { value: 'single', text: 'Single line', selected: !fd.multiline }),
            U.h('option', { value: 'multi', text: 'Multiple lines', selected: !!fd.multiline })
          ),
          U.h('button', { type: 'button', class: 'icon-btn icon-btn-sm danger', title: 'Remove field', 'aria-label': 'Remove field', dataset: { act: 'remove' }, html: U.icon('trash', 16) })
        )
      )
    );
    if (!fields.length) list.append(U.h('li', { class: 'muted small', text: 'No fields yet.' }));
    if (focusId) {
      const inp = list.querySelector(`[data-id="${CSS.escape(focusId)}"] .field-label`);
      if (inp) {
        inp.focus();
        inp.select();
      }
    }
  }

  function addField() {
    const id = U.uid('fld');
    S.update((p) => p.fields.push({ id, label: 'New field', multiline: true }), null, { source: 'fields' });
    render(id);
  }

  function moveField(id, delta) {
    S.update(
      (p) => {
        const i = p.fields.findIndex((x) => x.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= p.fields.length) return;
        const [fd] = p.fields.splice(i, 1);
        p.fields.splice(j, 0, fd);
      },
      null,
      { source: 'fields' }
    );
    render();
  }

  async function removeField(id) {
    const fd = S.project.fields.find((x) => x.id === id);
    if (!fd) return;
    const used = S.project.frames.filter((f) => (f.text[id] || '').trim()).length;
    if (used) {
      const ok = await U.confirm(
        `Remove “${fd.label}”?`,
        `${used} frame${used === 1 ? ' has' : 's have'} text in this field. Removing the field also removes that text. You can undo this.`,
        'Remove field',
        true
      );
      if (!ok) return;
    }
    S.update(
      (p) => {
        p.fields = p.fields.filter((x) => x.id !== id);
        for (const f of p.frames) delete f.text[id];
      },
      null,
      { source: 'fields' }
    );
    render();
  }

  async function resetDefaults() {
    const defaults = S.defaultFields();
    const missing = defaults.filter((d) => !S.project.fields.some((f) => f.id === d.id));
    if (!missing.length) {
      U.toast('All the standard fields are already here.');
      return;
    }
    S.update((p) => p.fields.push(...missing), null, { source: 'fields' });
    render();
    U.toast(`Added ${missing.map((m) => m.label).join(', ')}`);
  }
})(window.SB);
