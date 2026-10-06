#!/usr/bin/env node
// Capture out/<handle>.html with Playwright.
//   node scripts/render-video.mjs <handle> --still            → out/<handle>.png   (final frame, 2400×2400)
//   node scripts/render-video.mjs <handle>                    → out/<handle>.mp4   (12 s reveal + 3 s hold, 1080×1080, 30 fps)
//   options: --theme ink   --fps 30   --size 1080   --hold 3   --scale 2 (still only)   --frame 0.5 (still at progress p)
//   env:     XR_CHROMIUM=/path/to/chrome   use that binary instead of Playwright's downloaded Chromium
import { chromium } from 'playwright';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const FLAGS_WITH_VALUE = new Set(['--theme', '--fps', '--size', '--hold', '--scale', '--frame']);
const handle = (args.find((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUE.has(args[i - 1])) || '').replace(/^@/, '');
const still = args.includes('--still');
const theme = opt('--theme', null);
const fps = +opt('--fps', 30), size = +opt('--size', 1080), hold = +opt('--hold', 3), scale = +opt('--scale', 2);
const frameAt = opt('--frame', null);

const htmlPath = join(root, 'out', `${handle}${theme ? '.' + theme : ''}.html`);
if (!handle || !existsSync(htmlPath)) { console.error(`Missing ${htmlPath}. Run: node scripts/render-html.mjs ${handle}${theme ? ' --theme ' + theme : ''}`); process.exit(1); }

const browser = await chromium.launch({ executablePath: process.env.XR_CHROMIUM || undefined }); // XR_CHROMIUM: reuse an existing Chromium instead of `npx playwright install`
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: still ? scale : size / 1200 });
await page.goto(pathToFileURL(htmlPath).href + '?p=1', { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__chart && document.querySelector('#stage svg'));
const stage = page.locator('#stage');

if (still) {
  const p = frameAt == null ? 1 : +frameAt;
  await page.evaluate((v) => window.__chart.setProgress(v), p);
  const out = join(root, 'out', `${handle}${theme ? '.' + theme : ''}${frameAt == null ? '' : '.p' + frameAt}.png`);
  await stage.screenshot({ path: out, type: 'png' });
  console.log(`wrote ${out}`);
  await browser.close();
  process.exit(0);
}

const duration = await page.evaluate(() => window.__chart.duration);
const total = Math.round((duration + hold) * fps);
const framesDir = join(root, 'out', `.frames-${handle}`);
rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true });
const t0 = Date.now();
for (let f = 0; f < total; f++) {
  const p = Math.min(1, f / fps / duration);
  await page.evaluate((v) => window.__chart.setProgress(v), p);
  await stage.screenshot({ path: join(framesDir, `f${String(f).padStart(5, '0')}.png`), type: 'png' });
  if (f % fps === 0) process.stdout.write(`\r${f}/${total} frames (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
await browser.close();
process.stdout.write('\n');

const mp4 = join(root, 'out', `${handle}${theme ? '.' + theme : ''}.mp4`);
const ff = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', join(framesDir, 'f%05d.png'), '-vf', `scale=${size}:${size}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-movflags', '+faststart', mp4], { stdio: ['ignore', 'ignore', 'pipe'] });
if (ff.status !== 0) { console.error(ff.stderr.toString().split('\n').slice(-8).join('\n')); process.exit(1); }
rmSync(framesDir, { recursive: true, force: true });
console.log(`wrote ${mp4} (${total} frames, ${size}×${size} @ ${fps} fps, ${(duration + hold).toFixed(1)} s)`);
