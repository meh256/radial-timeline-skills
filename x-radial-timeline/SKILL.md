---
name: x-radial-timeline
description: Use when asked for a radial / circular / "year in posts" chart, poster or video of an X (Twitter) account's posting history from a handle or profile URL (how often someone posted, replied, reposted or quoted over the last 52 weeks), in the Atlas look, as HTML, PNG or MP4.
---

# X radial timeline

One X handle in → a 52-week radial timeline out: 52 bars around a circle (one per week, oldest at
12 o'clock, clockwise to today), each bar stacked by **posts / replies / reposts / quotes**, an
inner ring shaded by **likes received that week**, the person in the middle. Atlas theme (paper,
ink, Geist). Outputs: standalone `out/<handle>.html` (hover tooltips + data table), `out/<handle>.png`,
`out/<handle>.mp4` (12 s clockwise reveal + 3 s hold, 1080×1080).

Data comes from the **user's own logged-in X session in Chrome**, not an API key. The browser
tools do all the fetching; nothing here needs credentials in a file.

**Read `reference.md` before changing anything** (data contract, endpoints, design rules, gotchas).

## Requirements

- A browser tool that can navigate, **execute JavaScript inside the page** and read the page's
  visible text (Claude Code's Chrome tools do; some hosted agents only read text, see step 1's
  fallback), with the user already logged in to x.com.
- Node 20+, `ffmpeg` on PATH (for MP4 only: `brew install ffmpeg` on mac, `apt-get install ffmpeg` on Debian/Ubuntu).
- Once per machine, in this folder: `npm install` then `npx playwright install chromium`. If that
  download is blocked or a Chromium/Chrome already exists on the machine, skip it and set
  `XR_CHROMIUM=/path/to/the/binary` for every render command instead.

## Procedure

Work in this folder (`cd` to it). `<handle>` is the X username without `@`.

### 1. Collect (browser)

1. Open a tab and navigate to `https://x.com/<handle>`. Wait for the profile to show. If it says
   "This account doesn't exist" or "Account suspended", stop and tell the user.
2. Confirm login: run `document.cookie.includes('ct0=')` with your page-JavaScript tool. If `false`,
   stop and ask the user to log in to X in Chrome.
3. Run this with your page-JavaScript tool, then run the **entire contents** of
   `scripts/fetch.browser.js` (read the file, paste it as the code):
   ```js
   window.__XR_HANDLE = "<handle>";
   window.__XR_WEEKS = 52;
   window.__XR_MAX_ITEMS = 16000; // overall ceiling
   // window.__XR_BACKFILL = true; // ONLY if the user asks for more than X's profile pages give (~3,200 items):
   //                               // searches week by week, hundreds of requests, 1–2 h of rate-limit sleeps
   ```
   It returns `collector started for @<handle>` immediately.
4. Poll `__xr.status()` every 20–30 s (use the wait action between polls, do not spam) until
   `done` is `true`. Expect 1–5 minutes for most accounts; `phase` shows progress. If backfill was enabled, `phase` says `backfill …` while it searches week by week; that takes an
   hour or more because of X's rate limits, so poll every few minutes and keep the tab open.
   Rate limiting (phase `rate-limited …`) is X throttling, not a block: the script only reads, and
   it never posts, likes or follows. If the user is uneasy, stop by closing the tab; nothing is lost
   from earlier runs. If `error` is non-null, read reference.md
   "Troubleshooting" before retrying.
5. Run `__xr.export()`. The tab turns into a plain text page.
6. Read that page with your page-text (read page) tool. Save **exactly** the text between `XR_JSON_BEGIN` and
   `XR_JSON_END` (one JSON object, 15–30 KB) to `data/<handle>.json` with the Write tool. Do not
   retype or reformat it; copy it as returned.
7. Sanity check:
   ```bash
   node -e "const d=require('./data/<handle>.json');console.log(d.weeks,d.weekly.length,d.collected,d.totals)"
   ```
   `weekly.length` must equal `weeks`. If `collected` is 0, the account is protected or empty.
8. Close the tab you opened.

**If your browser tool cannot execute JavaScript inside a page** (some hosted agents forbid it), you
cannot collect. Skip to step 2 using a `data/<handle>.json` produced elsewhere by this same skill (an
agent with a logged-in Chrome drops the file into `data/`), and say in the delivery which date the data
carries (`collectedAt`). Never try to log in to X yourself or store X cookies to get around this.

### 2. Render

```bash
node scripts/render-html.mjs <handle>              # → out/<handle>.html
node scripts/render-video.mjs <handle> --still     # → out/<handle>.png   (2400×2400)
node scripts/render-video.mjs <handle>             # → out/<handle>.mp4   (~90 s to render)
```

Add `--theme ink` to both commands for the dark version (`out/<handle>.ink.*`).

### 3. Check before delivering (mandatory)

Open `out/<handle>.png` with the image reader and verify every line:

- Name, handle and follower count in the top-left match the profile you opened.
- The big number top-right equals the sum of the four legend counts (both are computed over the
  weeks actually drawn, so they exclude anything under a "NO DATA" arc).
- Month labels run OCT → SEP (or whatever the window is) clockwise with no gaps or overlaps.
- The two direct labels (busiest week, most-liked week) do not overlap the legend or title.
- No text is cut off at the edges; the longest bar does not touch the legend row.
  If anything is off, fix the data or template, re-render, and look again. For the MP4, also run
`node scripts/render-video.mjs <handle> --still --frame 0.5` and view the mid-reveal PNG it writes.

### 4. Deliver

Send the PNG and MP4 paths (or attach them) and one sentence of reading, e.g. the busiest week and
the most-liked week, taken from the labels on the chart. Mention `oldest` from the JSON if it is
later than `since` (collection stopped early; the chart marks those weeks "NO DATA"). If the JSON
has a `backfill` block, say that reposts are not counted before `backfill.repostsUnavailableBefore`
(X search does not return reposts); the chart prints that caveat under the title.

## Quick reference

| Need                                   | Where                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Data file shape                        | `reference.md` → "Data contract"                                       |
| Change colors, radii, animation timing | `render/template.html` top of the script (`R`, `GAP`, `T`, CSS tokens) |
| Weeks other than 52                    | `window.__XR_WEEKS` before collecting; everything else adapts          |
| Item ceiling (default 16,000) | `window.__XR_MAX_ITEMS` before collecting; the collector stops there and records `stops` |
| More than X's ~3,200 profile items | `window.__XR_BACKFILL = true` before collecting (slow, request-heavy; explain the wait to the user first) |
| Only a still at a given progress       | `--still --frame 0.35`                                                 |
| Video size / fps / hold                | `--size 1080 --fps 30 --hold 3`                                        |
| Test render without X                  | `node scripts/render-html.mjs sample` (uses `data/sample.json`)        |

## Common mistakes

- Running the collector on a non-x.com tab: it throws "Not on x.com". Navigate to the profile first.
- Saving the export with the quotes re-escaped or pretty-printed by hand. Copy it verbatim.
- Polling in a tight loop. The collection is rate-limited by X; poll every 20–30 s.
- Delivering without looking at the PNG. Labels can collide on unusual data; the check is the gate.
- Treating `reposts` in `totals` as the account's own reach: they are reposts _received_ on the
  account's own items. Reposts the account made are counted in `totals.repost` (no s).
- Editing `scripts/fetch.browser.js` operation names because one is missing: X renames GraphQL
  operations; see reference.md "Endpoints" for how to find the current name first.
