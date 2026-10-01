// Regenerates js/rules.js from firestore.rules so the app can show/copy the rules
// (the app can't fetch files when opened directly from disk).
// Run after editing firestore.rules:  node tools/sync-rules.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
const out =
  '/* Generated from firestore.rules by tools/sync-rules.mjs — do not edit by hand. */\n' +
  'window.SB = window.SB || {};\n' +
  'window.SB.FIRESTORE_RULES = ' + JSON.stringify(rules) + ';\n';
writeFileSync(join(root, 'js/rules.js'), out);
console.log('Wrote js/rules.js');
