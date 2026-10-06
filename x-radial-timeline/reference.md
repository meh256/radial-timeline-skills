# x-radial-timeline — reference

Everything SKILL.md assumes. Read before editing any file here.

## Files

```
SKILL.md                 the procedure
reference.md             this file
scripts/fetch.browser.js in-page collector + aggregator (pasted into the X tab, never run with node)
scripts/render-html.mjs  data/<h>.json → out/<h>.html  (inlines data, Geist fonts, avatar)
scripts/render-video.mjs out/<h>.html  → out/<h>.png | out/<h>.mp4  (Playwright frames → ffmpeg)
render/template.html     the chart: CSS tokens, geometry, animation, tooltip, table twin
render/fonts/*.woff2     Geist Regular/Medium/SemiBold, Geist Mono Regular/Medium
data/<handle>.json       one file per account (see contract); data/sample.json is synthetic
out/                     rendered artifacts (gitignored)

To hand the skill to another agent, zip the folder so SKILL.md is at the top level of the archive
(`cd x-radial-timeline && zip -r ../x-radial-timeline.zip . -x 'node_modules/*' 'out/*' 'data/*' -i '*' && zip ../x-radial-timeline.zip data/sample.json`).
```

## Data contract — `data/<handle>.json`

```jsonc
{
  "handle": "shanselman", "weeks": 52,
  "since": "2025-10-07T05:22:56.743Z",   // window start = until − weeks·7d
  "until": "2026-10-06T05:29:50.735Z",   // collection time
  "collectedAt": "…",
  "oldest": "…",        // coverage boundary = the LATER of the two streams' oldest items (< since means a full year)
  "oldestAny": "…", "streamOldest": { "UserTweets": "…", "UserRepliesTimeline": "…" }, "stops": { "UserTweets": "no-cursor|empty|reached-since|max-pages", … },
  "pages": 69, "collected": 1383, "dropped": 13,   // dropped = items older than `since`
  "user": { "id", "handle", "name", "avatar", "followers", "following", "postsTotal", "joined", "bio" },
  "totals": { "post", "reply", "repost", "quote",          // items the account made, by type
              "likes", "reposts", "replies", "quotes",     // engagement RECEIVED on its own items (reposts excluded)
              "photo", "video", "gif", "link" },           // items carrying media / an external link
  "weekly": [ /* exactly `weeks` rows, oldest first */
    { "start": "2025-10-07", "end": "2025-10-14", "post", "reply", "repost", "quote",
      "likes", "reposts", "replies", "quotes", "photo", "video", "gif", "link",
      "top": { "t": "2025-10-11T03:09", "type": "post", "likes", "reposts", "replies" } | null } ],
  "daily": [ /* weeks·7 rows */ [post, reply, repost, quote] ]
}
```

Type rules (decided in `record()`): `retweeted_status_result` → repost; else `is_quote_status` →
quote; else `in_reply_to_status_id_str` → reply; else post. A repost's like/repost counts belong to
the original author, so reposts contribute to `repost` only, never to engagement or `top`.

Weeks are **rolling** (anchored to collection time), not ISO weeks: week _i_ covers
`[since + 7i days, since + 7(i+1) days)`. The month ring is drawn from real calendar boundaries
inside the window, so it is accurate even though weeks straddle months.

## Endpoints (X GraphQL, called from the page with the session's own cookies)

| Operation             | Gives                                                                   | Notes                                                                                                 |
| --------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `UserByScreenName`    | rest_id, name, avatar, counts                                           | works with `features={}`                                                                              |
| `UserTweets`          | posts, reposts, quotes (+ a few replies)                                | 20–40 per page, `cursor` from the `Bottom` entry; first page may carry a `TimelinePinEntry` (skipped) |
| `UserRepliesTimeline` | replies, interleaved with other people's tweets in conversation modules | filter by `legacy.user_id_str === userId`                                                             |

| `SearchTimeline` | backfill: `from:<handle> since:<day> until:<day>`, `product: "Latest"`, 20 a page | **POST** with JSON body `{variables, features, queryId}` (GET returns an empty 404). Returns posts, replies, quotes — **never reposts**. Cursors arrive as `TimelineAddEntries` entries on page 1 and `TimelineReplaceEntry` on later pages, so `tweetsOf` reads both `entries` and `entry`. |

`UserTweetsAndReplies` no longer exists (404). Query ids come from the `main.*.js` bundle at run
time (`queryId:"…",operationName:"…"`), so a deploy never breaks the ids — only a **rename** does.
If `gql` throws "operation missing from bundle", list the names with
`Object.keys(ops).filter(k=>/User|Timeline/.test(k))` inside the page and pick the replacement.

The `features` object starts empty; a 400 "features cannot be null: a, b" is parsed and those
flags are set to `true`, then retried (max 20 attempts). A 429 sleeps 65 s. Pagination stops when a
page's oldest own item is older than `since`, when there is no `Bottom` cursor, or at 400 pages.
X caps profile timelines around 3,200 items per stream (for @paulg the posts stream went silent
at ~800: three empty pages with a cursor, recorded as `stops.UserTweets = "empty"`). When the later
of the two streams' oldest items (`coverageBoundary`) is inside the window, the collector (only when `window.__XR_BACKFILL === true`) backfills
every earlier week, plus 8 weeks past the boundary (`MARGIN_WEEKS`: streams tail off with a few
scattered old items before X stops serving, and dedupe by id makes the overlap free), with
`SearchTimeline` slices, newest gap first, so a ceiling leaves the nearest
weeks complete; a week needing more than 60 pages is re-run as seven day slices. Overall ceiling
`window.__XR_MAX_ITEMS` (default 16,000). The export carries `streamOldest`, `stops` (per source:
`no-cursor` | `empty` | `reached-since` | `max-pages` | `max-items` | `complete`) and `backfill
{from, to, weeks, weeksDone, pages, completedTo, repostsUnavailableBefore}` (the last is the start of
the earliest week that has any repost, since reposts only come from the profile stream); `oldest` becomes the
coverage boundary after backfill (`completedTo`), so the NO DATA arc only covers weeks nothing
reached. Rate limits: roughly 50 requests per 15 min per operation; a year of a 5,000-item account
is ~250 search pages, about an hour of wall time, mostly sleeping on 429s.

Why the export goes through the page text: the javascript tool truncates returned strings after
~1 KB and redacts base64-looking runs; X's CSP (`connect-src`) blocks posting to localhost;
clipboard writes need focus. Replacing the document with a `<p>` and reading page text carries
~50 KB cleanly, which is why the collector aggregates in-page instead of exporting raw posts.

## Design (Atlas) — what the chart is and why

Inspired by Ben Willers' _Life in Data_: concentric rings, bars radiating outward, the subject at
the centre. Canvas 1200×1200 (viewBox), corners hold text, the circle holds data.

| Element         | Spec                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surface         | paper `#FBFAF7`; ink theme `#0E1525`                                                                                                                                                                                            |
| Core            | r 112, ink disc; avatar r 40 clipped; `@handle` 19px/600; two mono 10px lines                                                                                                                                                   |
| Month ring      | r 150–176, `bg-alt` band, 2px paper ticks at month starts, mono 10.5px uppercase labels rotated tangentially (flipped upright below the horizon); months spanning < 9° get no label                                             |
| Engagement ring | r 188–214, 52 cells, 2px gaps, sequential blue ramp `--h1…--h6` on √(likes/maxLikes) (6 ordinal steps); zero → `--h0`                                                                                                           |
| Bars            | start r 232, max r 536; 13px constant-width strokes (so they read as thin spokes), butt ends; segments stacked post → reply → repost → quote with 2px surface gaps; linear scale to a "nice" max (step from 1,2,5,10,20,25,50…) |
| Gridlines       | hairline `rule-soft` circles at every step; labels sit in the 18° gap at 12 o'clock                                                                                                                                             |
| Direct labels | exactly two: busiest week (count + range) and most-liked week (likes + range); x clamped inside the frame from an estimated text width, y clamped to 180–1080 (corner blocks), and the second label dodges the first by 16px when they would overlap |
| Coverage | a week is drawn only if it starts on/after `oldest` (whole weeks); earlier weeks get a `rule` arc + "NO DATA" label; hero figure, legend counts and received-engagement line are summed over drawn weeks only |
| Corners         | TL eyebrow + name + meta; TR hero figure (total items, 48px) + received engagement; BL legend (4 swatches with counts) + ramp legend; BR NetworkOS mark + `networkos/` wordmark, `thenetworkos.com`, source line; the reading hint sits under the title                                                             |
| Type            | Geist for text, Geist Mono for eyebrows, figures and labels; text never wears a series colour                                                                                                                                   |

Categorical palette (validated with the dataviz validator on each surface; adjacent CVD ΔE ≥ 8,
normal-vision ≥ 15, chroma floor met):

| Series  | Paper                                                                      | Ink       |
| ------- | -------------------------------------------------------------------------- | --------- |
| Posts   | `#1F46FF` (Atlas blue-500)                                                 | `#4F68F0` |
| Replies | `#D85A2A` (Atlas clay-500)                                                 | `#CF5526` |
| Reposts | `#8B3FA0` (saturated step of Atlas plum)                                   | `#9A52AE` |
| Quotes  | `#C99A3D` (Atlas ochre; < 3:1 on paper → relief via legend labels + table) | `#B98B36` |

Atlas sage/plum/ochre as published fail the chroma floor (they read grey) — don't swap them back in
without re-running `validate_palette.js`. The stacking order is the validated adjacency order; do
not reorder segments without re-validating.

## Animation (progress p ∈ [0,1], 12 s)

| p         | What                                                                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–0.10    | core, rings and corner text fade in; core scales 0.92 → 1                                                                                                                                           |
| 0.10–0.80 | clockwise reveal: week _i_ starts at `0.10 + i/52·0.63`, grows over 0.07 with cubic ease-out; heat cell fades with it; month label appears as the hairline sweep hand passes; hero figure counts up |
| 0.82–0.95 | gridline labels, direct labels, legend fade in                                                                                                                                                      |
| then      | hold (MP4 adds 3 s)                                                                                                                                                                                 |

`window.__chart.setProgress(p)` re-renders the whole SVG (~350 elements; ~5 ms). `?p=0.4` renders
one frame, `?static=1` the final frame, `?theme=ink` the dark theme. The video script drives
`setProgress` frame by frame and screenshots `#stage` (a Playwright-rendered 1200×1200 element at
`deviceScaleFactor = size/1200`), then encodes with libx264 crf 17, yuv420p, faststart.

## Troubleshooting

| Symptom                                               | Cause → fix                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Not on x.com`                                        | collector run in the wrong tab; navigate to the profile first                                     |
| `Not logged in`                                       | no `ct0` cookie; user must log in to X in Chrome                                                  |
| `User not found`                                      | typo, suspended, or renamed handle                                                                |
| `collected: 0`                                        | protected account the session doesn't follow                                                      |
| `phase: rate-limited` for minutes                     | normal on big accounts; keep polling                                                              |
| status stuck, `done:false`, no phase change for 5 min | tab was navigated/reloaded (state lost); rerun from step 1.1                                      |
| `weekly has N rows, expected 52`                      | partial copy of the export; redo step 1.6                                                         |
| PNG shows initial instead of avatar                   | avatar fetch failed at build time; rerun `render-html.mjs` online                                 |
| text in the core invisible                            | a CSS `svg text { fill }` rule beats presentation attributes; core text must use `style="fill:…"` |
| labels overlap legend                                 | lower `R.barOut` or widen the clamp in `tip()`; look again                                        |
| ffmpeg not found                                      | `brew install ffmpeg` (mac) and rerun; frames are kept until encode succeeds                      |
| `npx playwright install` blocked or looping on approvals (Muse, locked-down hosts) | point `XR_CHROMIUM` at any existing Chromium/Chrome binary (e.g. one in `~/.cache/ms-playwright`) and skip the install |
