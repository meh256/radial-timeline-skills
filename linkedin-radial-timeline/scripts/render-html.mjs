#!/usr/bin/env node
// Build a standalone HTML career chart from data/<publicId>.json  →  out/<publicId>.html
// Usage: node scripts/render-html.mjs <publicId> [--theme ink] [--years 15|10|all]   (default: the last 15 years)
// Inlines the Geist fonts, the profile photo and every company/school logo as base64 so the file
// renders identically offline and in the headless capture (LinkedIn image URLs expire after a while).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const id = (args.find((a) => !a.startsWith('--') && !['--theme', '--years'].includes(args[args.indexOf(a) - 1])) || '').replace(/^@/, '');
if (!id) { console.error('Usage: node scripts/render-html.mjs <publicId> [--theme ink]'); process.exit(1); }
const theme = args.includes('--theme') ? args[args.indexOf('--theme') + 1] : null;
const years = args.includes('--years') ? args[args.indexOf('--years') + 1] : '15';   // 15 (default) | 10 | all
if (!/^(all|\d+)$/.test(years)) { console.error('--years must be a number of years or "all"'); process.exit(1); }

const dataPath = join(root, 'data', `${id}.json`);
if (!existsSync(dataPath)) { console.error(`Missing ${dataPath}. Run the collector first (SKILL.md step 1).`); process.exit(1); }
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
for (const k of ['profile', 'experience', 'education']) if (!(k in data)) { console.error(`data/${id}.json is missing "${k}"`); process.exit(1); }
if (!data.profile?.name) { console.error('profile.name is empty: the profile page part was not collected'); process.exit(1); }
if (!data.experience.some((e) => e.roles?.some((r) => r.start))) { console.error('no dated experience: nothing to draw'); process.exit(1); }

const fontDir = join(root, 'render', 'fonts');
const face = (family, file, weight) => existsSync(join(fontDir, file))
  ? `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(fontDir, file)).toString('base64')}) format("woff2")}`
  : '';
const fonts = [face('Geist', 'Geist-Regular.woff2', 400), face('Geist', 'Geist-Medium.woff2', 500), face('Geist', 'Geist-SemiBold.woff2', 600), face('Geist Mono', 'GeistMono-Regular.woff2', 400), face('Geist Mono', 'GeistMono-Medium.woff2', 500)].join('\n');

// images → data URIs (profile photo + logos). Failures fall back to initials in the template.
const cache = new Map();
async function toDataUri(url) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  let out = null;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (r.ok) { const ct = r.headers.get('content-type') || 'image/jpeg'; if (ct.startsWith('image/')) out = `data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`; }
  } catch (e) { /* keep null */ }
  cache.set(url, out); return out;
}
const images = {};
images.avatar = await toDataUri(data.profile.avatar) || await toDataUri((data.profile.avatar || '').replace('shrink_400_400', 'shrink_100_100')); // older collector runs rewrote the size, which breaks the signed URL
if (data.profile.avatar && !images.avatar) console.warn('photo fetch failed (initials will be used)');
for (const e of data.experience) if (e.logo?.src) images[e.logo.src] = await toDataUri(e.logo.src);
for (const e of data.education) if (e.logo?.src) images[e.logo.src] = await toDataUri(e.logo.src);
for (const [u, v] of Object.entries(images)) if (u !== 'avatar' && !v) console.warn('logo fetch failed (initials will be used):', u.slice(0, 80));
const ok = Object.values(images).filter(Boolean).length;
console.log(`images inlined: ${ok}/${Object.keys(images).length}`);

const title = `${data.profile.name} · career timeline`;
let html = readFileSync(join(root, 'render', 'template.html'), 'utf8')
  .replace('__TITLE__', title.replace(/[<&]/g, ''))
  .replace('/*__FONTS__*/', fonts)
  .replace('__DATA__', JSON.stringify(data).replace(/</g, '\\u003c'))
  .replace('__IMAGES__', JSON.stringify(images).replace(/</g, '\\u003c'))
  .replace('__OPTIONS__', JSON.stringify({ years: years === 'all' ? 'all' : +years }));
if (theme) html = html.replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`);

mkdirSync(join(root, 'out'), { recursive: true });
const outPath = join(root, 'out', `${id}${theme ? '.' + theme : ''}.html`);
writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
