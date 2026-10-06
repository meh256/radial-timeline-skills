---
name: linkedin-radial-timeline
description: Use when asked for a radial / circular career timeline, "life in data" chart, poster or video of a person's LinkedIn profile from a profile URL or public id (their education, jobs, companies, logos and places lived around a circle), as HTML, PNG or MP4.
---

# LinkedIn radial timeline

One LinkedIn profile in → a radial career timeline out: time runs clockwise over the **last 15
years** by default (`--years 10` or `--years all` to change it) to today; schools sit on the inner ring, roles stack outward in lanes (concurrent roles on
separate lanes, company logo at the start of each arc), and the outer ring shows where the person
has lived, derived from role locations. The person's photo and name sit in the core. Atlas look,
**no product branding** (it is meant for personal posts). Outputs: `out/<id>.html` (hover tooltips

- data table), `out/<id>.png` (2400×2400), `out/<id>.mp4` (12 s clockwise reveal + 3 s hold).

Data comes from the **user's own logged-in LinkedIn session in a browser**. Nothing here needs
credentials in a file. **Read `reference.md` before changing anything.**

## Requirements

- A browser tool that can navigate, **execute JavaScript inside the page** and read the page's
  visible text, with the user already logged in to linkedin.com. (Hosted agents whose browser
  cannot run page scripts cannot collect; they can still render a `data/<id>.json` produced
  elsewhere.)
- Node 20+, `ffmpeg` on PATH for MP4 (`brew install ffmpeg` on mac, `apt-get install ffmpeg` on Linux).
- Once per machine, in this folder: `npm install` then `npx playwright install chromium` (or set
  `XR_CHROMIUM=/path/to/chrome` to reuse an existing browser instead).

## Procedure

Work in this folder. `<id>` is the public id from the URL: `linkedin.com/in/<id>/`.

### 1. Collect (browser, three pages)

1. Navigate to `https://www.linkedin.com/in/<id>/`. If it shows a login wall or "This page doesn't
   exist", stop and tell the user. Run the **entire contents** of `scripts/collect.browser.js` with
   your page-JavaScript tool. It returns `profile saved: <name> — <headline> — <location>`.
2. Navigate to `https://www.linkedin.com/in/<id>/details/experience/`, wait for the list to show,
   run the whole file again. It scrolls to load every position and returns
   `experience saved: N companies, M roles, K date ranges seen`. If `K` is 0, the page had not
   finished loading: wait 5 s and run it again.
3. Navigate to `https://www.linkedin.com/in/<id>/details/education/`, wait, run the whole file
   again. It returns `education saved: N schools (D with dates)`.
4. Run `__lr.export()`. The tab turns into a plain text page with a base64 block. Read it with the
   page-text tool and save **everything between `LR_B64_BEGIN` and `LR_B64_END`** to
   `data/<id>.b64` (line breaks and spaces are fine; nothing else may change). Base64 is used
   because the page-text channel strips quotes and ampersands from raw JSON.
5. Decode and validate:
   ```bash
   node scripts/decode.mjs <id>     # → data/<id>.json; prints name, companies, roles, schools
   ```
   If it reports missing parts, go back to that page and run the collector there again.

### 2. Render

```bash
node scripts/render-html.mjs <id>            # → out/<id>.html (last 15 years; add --years 10 or --years all)
node scripts/render-video.mjs <id> --still   # → out/<id>.png
node scripts/render-video.mjs <id>           # → out/<id>.mp4 (a 15 s video; rendering takes about 90 s)
```

`--theme ink` on both commands gives the dark version (`out/<id>.ink.*`). The HTML builder fetches
the photo and logos from LinkedIn's image CDN; those URLs expire after some hours, so render soon
after collecting. A failed image falls back to initials; a warning is printed only when both the original URL and the
retry fail, so no warning means every image rendered.

### 3. Check before delivering (mandatory)

Open `out/<id>.png` with the image reader and verify every line:

- Name and headline match the profile; the photo is the person (not initials) unless the fetch failed.
- Year labels run clockwise from the window's first year to the current year with no gap or overlap.
- Arcs that touch the top edge started before the window; the "Before <year>:" line under the title
  lists schools and jobs that ended before it (so nothing is silently dropped).
- Every role arc that is long enough carries its company label and logo; short arcs show a logo only.
- Concurrent roles sit on different lanes and never overlap.
- The "Lived in" ring shows one place at a time and the legend matches its colours.
- The "Longest roles" block and legend do not collide with the rings; no text is cut off.
  Then run `node scripts/render-video.mjs <id> --still --frame 0.5` and view the mid-reveal PNG.

### 4. Deliver

Send the PNG and MP4 paths (or attach them) with one sentence of reading taken from the chart (the
longest role, the number of companies, the span of years). Mention schools without dates (the
source line says how many were not drawn) and that places come from role locations, so a board
seat in another city can count as a place.

## Quick reference

| Need                                          | Where                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Data file shape                               | `reference.md` → "Data contract"                                             |
| Colours, radii, lane height, animation timing | top of the script in `render/template.html` (`R`, `LANE_H`, `T`, CSS tokens) |
| What counts as a side role (lighter blue)     | `SIDE` / `SIDE_TITLE` regexes in the template                                |
| Test render without LinkedIn                  | `node scripts/render-html.mjs sample` (uses `data/sample.json`)              |
| Only a still at a given progress              | `--still --frame 0.35`                                                       |
| Reuse an installed Chromium                   | `XR_CHROMIUM=/path/to/chrome` before the render commands                     |

## Common mistakes

- Running the collector before the details page finished loading: it waits up to 25 s, but on a
  slow connection `K date ranges seen` can be 0. Run it again.
- Saving the base64 block with characters altered (smart quotes, missing lines). Copy it exactly;
  `decode.mjs` tells you when it cannot decode.
- Rendering hours after collecting: logo URLs expire and you get initials. Collect again.
- Reading "places lived" as a residence history. It is where the person's roles were located.
- Expecting LinkedIn's class names to help: they are obfuscated and change. The parser works from
  date-range text and logo images only; see reference.md before "fixing" selectors.
