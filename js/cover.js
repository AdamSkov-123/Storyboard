/* Storyboard Maker — cover page editor. */
(function (SB) {
  'use strict';
  const U = SB.util;
  const S = SB.store;
  const C = (SB.cover = {});

  let dlg;
  const $ = (id) => document.getElementById(id);

  C.init = function () {
    dlg = $('cover-dialog');
    dlg.addEventListener('input', (e) => {
      const key = e.target.dataset.cover;
      if (!key) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      S.update(
        (p) => {
          if (key === 'title') p.title = v;
          else p.cover[key] = v;
        },
        e.target.type === 'checkbox' ? null : 'cover:' + key,
        { source: 'cover' }
      );
      if (e.target.tagName === 'TEXTAREA') U.autoGrow(e.target);
    });
    $('cover-today').addEventListener('click', () => {
      const v = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      S.update((p) => (p.cover.date = v), null);
    });
    $('cover-image-btn').addEventListener('click', chooseImage);
    $('cover-image-remove').addEventListener('click', () => S.update((p) => (p.cover.imageId = null), null));
    $('cover-done').addEventListener('click', () => dlg.close());
    S.subscribe((meta) => {
      if (dlg.open && meta.source !== 'cover') sync();
    });
  };

  C.open = function () {
    sync();
    dlg.showModal();
    const t = dlg.querySelector('[data-cover="title"]');
    if (!S.project.title) t.focus();
  };

  async function chooseImage() {
    const [file] = await U.pickFiles({ accept: 'image/*' });
    if (!file) return;
    try {
      const id = await S.addImageFile(file);
      S.update((p) => (p.cover.imageId = id), null);
    } catch (e) {
      U.toast(e.message + ' Use JPG, PNG or WebP images.', { type: 'error' });
    }
  }

  function sync() {
    const p = S.project;
    U.$$('[data-cover]', dlg).forEach((el) => {
      const key = el.dataset.cover;
      const v = key === 'title' ? p.title : p.cover[key];
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.value !== (v || '')) el.value = v || '';
      if (el.tagName === 'TEXTAREA') requestAnimationFrame(() => U.autoGrow(el));
    });
    const im = p.cover.imageId ? S.images.get(p.cover.imageId) : null;
    const box = $('cover-image-preview');
    box.replaceChildren(im ? U.h('img', { src: im.url, alt: 'Cover image' }) : U.h('span', { class: 'muted small', text: 'No cover image' }));
    $('cover-image-btn').lastElementChild.textContent = im ? 'Replace image' : 'Upload image or logo';
    $('cover-image-remove').hidden = !im;
  }
})(window.SB);
