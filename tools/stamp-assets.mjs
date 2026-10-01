// Adds ?v=<fingerprint of the file's contents> to every script and stylesheet the pages load, so
// browsers never mix a freshly loaded page with older copies of its files still in their cache
// (GitHub Pages lets browsers keep files for 10 minutes). Only files that changed get a new address.
// Run before committing:  node tools/stamp-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const fingerprint = (p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex').slice(0, 10);
let changed = 0;
const update = (p, text) => {
  if (read(p) === text) return;
  writeFileSync(join(root, p), text);
  changed++;
  console.log('Updated ' + p);
};

// The Firebase bundle is loaded on demand by js/cloud.js, so stamp that first (it changes cloud.js).
const bundle = 'js/vendor/firebase.js';
update('js/cloud.js', read('js/cloud.js').replace(/'js\/vendor\/firebase\.js(\?v=[0-9a-f]+)?'/, `'${bundle}?v=${fingerprint(bundle)}'`));

for (const page of ['index.html', 'review.html']) {
  update(page, read(page).replace(/(src|href)="((?:js|css)\/[^"?#]+\.(?:js|css))(\?v=[0-9a-f]+)?"/g, (m, attr, path) => `${attr}="${path}?v=${fingerprint(path)}"`));
}
console.log(changed ? 'Done.' : 'Already up to date.');
