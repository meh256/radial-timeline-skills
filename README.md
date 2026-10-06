# Radial timeline skills

Two transferable agent skills that turn a social profile into a radial, "life in data" style
chart — a standalone HTML page, a 2400×2400 PNG and a 15-second MP4 — in the style of Ben
Willers' *Life in Data*. Each skill is a folder with a `SKILL.md` an agent follows step by step,
a `reference.md` with the design and data contract, and small Node scripts. They were built for
Claude Code and ported to Meta Muse; any agent with a browser tool that can run JavaScript in a
page, plus Node and ffmpeg, can run them.

| Skill | Input | What the circle shows |
|---|---|---|
| [`x-radial-timeline`](x-radial-timeline/) | an X handle | the last 52 weeks: one bar per week stacked by posts, replies, reposts and quotes; an inner ring shaded by likes received; the account in the core |
| [`linkedin-radial-timeline`](linkedin-radial-timeline/) | a LinkedIn profile URL | the last 15 years (or 10, or all): schools on the inner ring, roles in lanes with company logos, places lived on the outer ring |

## How the data is collected

Both skills read from **your own logged-in browser session**, through a small script the agent
runs inside the page. Nothing is stored except the aggregated JSON the chart needs, and no
credentials, cookies or API keys are written anywhere. The collectors only read; they never
post, like, follow or connect. Rate limits are honoured by sleeping. Use them on profiles you
have a legitimate reason to chart, and keep the output for personal use unless the person agrees.

- X: the collector pages through the profile's own timelines (about 3,200 recent items at most),
  with an opt-in search backfill for heavier accounts.
- LinkedIn: the collector parses the experience and education pages structurally (LinkedIn's
  class names are obfuscated), accumulating across the three profile pages.

Agents whose browser cannot execute page scripts (Meta Muse, for example) can still render from a
`data/<id>.json` produced elsewhere — the render steps need only Node.

## Quick start

```bash
cd x-radial-timeline            # or linkedin-radial-timeline
npm install
npx playwright install chromium # or: export XR_CHROMIUM=/path/to/chrome
node scripts/render-html.mjs sample            # synthetic fixture → out/sample.html
node scripts/render-video.mjs sample --still   # → out/sample.png
node scripts/render-video.mjs sample           # → out/sample.mp4 (needs ffmpeg)
```

Then follow the skill's `SKILL.md` for a real handle or profile. Renders are deterministic: the
same data gives byte-identical PNGs on the same machine.

## Design

Atlas tokens (paper `#FBFAF7`, ink `#0E1525`, blue `#1F46FF`), Geist and Geist Mono, categorical
palettes validated for colour-vision deficiency, hover tooltips plus a data-table twin in the
HTML, and a seekable reveal animation driven by `window.__chart.setProgress(p)` that the video
script captures frame by frame with Playwright and encodes with ffmpeg.

## License

MIT. Geist fonts are included under the SIL Open Font License.
