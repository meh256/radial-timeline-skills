#!/usr/bin/env node
// Build a standalone HTML chart from data/<handle>.json  →  out/<handle>.html
// Usage: node scripts/render-html.mjs <handle> [--theme ink]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const handle = (args.find((a) => !a.startsWith('--')) || '').replace(/^@/, '');
if (!handle) { console.error('Usage: node scripts/render-html.mjs <handle> [--theme ink]'); process.exit(1); }
const theme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : null;

const dataPath = join(root, 'data', `${handle}.json`);
if (!existsSync(dataPath)) { console.error(`Missing ${dataPath}. Run the collector first (see SKILL.md step 1).`); process.exit(1); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
for (const k of ['weeks', 'since', 'until', 'weekly', 'totals']) if (!(k in data)) { console.error(`data/${handle}.json is missing "${k}"`); process.exit(1); }
if (data.weekly.length !== data.weeks) { console.error(`weekly has ${data.weekly.length} rows, expected ${data.weeks}`); process.exit(1); }

// fonts → base64 @font-face so the file renders identically offline and in headless capture
const fontDir = join(root, 'render', 'fonts');
const face = (family, file, weight) => existsSync(join(fontDir, file))
  ? `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(fontDir, file)).toString('base64')}) format("woff2")}`
  : '';
const fonts = [
  face('Geist', 'Geist-Regular.woff2', 400), face('Geist', 'Geist-Medium.woff2', 500), face('Geist', 'Geist-SemiBold.woff2', 600),
  face('Geist Mono', 'GeistMono-Regular.woff2', 400), face('Geist Mono', 'GeistMono-Medium.woff2', 500),
].join('\n');

// avatar → data URI (falls back to an initial if the fetch fails)
let avatar = '';
if (data.user?.avatar) {
  try {
    const r = await fetch(data.user.avatar);
    if (r.ok) avatar = `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
  } catch (e) { console.warn('avatar fetch failed, using initial:', e.message); }
}

const title = `${data.user?.name || '@' + handle} · ${data.weeks} weeks on X`;
let html = readFileSync(join(root, 'render', 'template.html'), 'utf8')
  .replace('__TITLE__', title.replace(/[<&]/g, ''))
  .replace('/*__FONTS__*/', fonts)
  .replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'))
  .replace('__AVATAR__', JSON.stringify(avatar));
if (theme) html = html.replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`);

mkdirSync(join(root, 'out'), { recursive: true });
const outPath = join(root, 'out', `${handle}${theme ? '.' + theme : ''}.html`);
writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
