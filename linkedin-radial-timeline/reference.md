# linkedin-radial-timeline — reference

Everything SKILL.md assumes. Read before editing any file here.

## Files

```
SKILL.md                   the procedure
reference.md               this file
scripts/collect.browser.js in-page collector (run on each of the 3 profile pages; stores parts in localStorage; exports base64)
scripts/decode.mjs         data/<id>.b64 → data/<id>.json (validates, repairs old-run quirks)
scripts/render-html.mjs    data/<id>.json → out/<id>.html (inlines Geist fonts, photo, logos as base64)
scripts/render-video.mjs   out/<id>.html → out/<id>.png | out/<id>.mp4 (Playwright frames → ffmpeg; XR_CHROMIUM override)
render/template.html       the chart: tokens, geometry, lanes, places, animation, tooltip, table twin
render/fonts/*.woff2       Geist Regular/Medium/SemiBold, Geist Mono Regular/Medium
data/<id>.json             one file per profile; data/sample.json is synthetic
out/                       rendered artifacts (gitignored)
```

## Data contract — `data/<id>.json`

```jsonc
{
  "publicId": "waqasmakhdum", "url": "https://www.linkedin.com/in/waqasmakhdum/", "collectedAt": "…",
  "profile": { "name", "headline", "location", "avatar" /* signed CDN url */, "followers", "collectedAt" },
  "experience": [ { "company", "logo": { "src", "alt" } | null,
                    "roles": [ { "title", "type" /* Full-time | Part-time | … | null */,
                                 "start": "2019-02", "end": "2024-01" | null /* null = present */,
                                 "startMonthKnown", "endMonthKnown", "duration", "present",
                                 "location" | null, "description" | null } ] } ],
  "education": [ { "school", "logo" | null, "degree" | null, "start" | null, "end" | null, "notes" | null } ],
  "missing": []   // parts never collected: "profile" | "experience" | "education"
}
```

Dates are `YYYY-MM`. When LinkedIn shows only a year, the month is `01` and `startMonthKnown` /
`endMonthKnown` is `false`; the renderer then treats a year-only end as December. Grouped positions
(several roles at one company) come out as one company with several roles. Schools without dates are
kept but not drawn (the source line counts them).

## How the collector reads LinkedIn

LinkedIn's DOM uses obfuscated, rotating class names, and the details pages are rendered client-side
(the fetched HTML has no data), so the collector:

1. Runs **in the page** after the content has rendered (it waits up to 25 s for a date range or the
   section heading) and scrolls to the bottom until the number of date ranges stops growing.
2. Finds **date-range leaves**: visible text nodes matching
   `(Mon )?YYYY – (Mon )?(YYYY|Present)( · duration)?`.
3. Finds the **list**: the section is the common ancestor of the "Experience"/"Education" heading and
   the first entry; climbing from a date range toward the section, the highest level with at least two
   _entry-like_ children (a logo image, a date range, or two or more text lines; never the heading) is
   the list, and those children are the entries. This survives schools with no logo and no dates.
4. For an entry with several date ranges, the **nested roles** container is the ancestor whose children
   each hold exactly one date range; the entry's own lines give the company and employment type.
5. Reads each entry's visible text lines in order: title, "Company · Type", dates, location, description.
   Employment type is accepted only from a fixed list (`EMP`), never a duration like "5 yrs".
6. The profile header: name = `document.title` before " | " (the page has no `h1` in `main`); headline
   and location are the next text lines after the name; the photo is the `profile-displayphoto` image.
   The avatar URL is kept **exactly** as served (signed; changing the size segment breaks it).

Parts accumulate in `localStorage['__lr_<id>']`, so the three page runs can happen in any order and
survive navigation. `__lr.export()` replaces the document with a `<pre>` of base64 (100-char lines).
Why base64: the page-text tool strips `"` and `&` from raw JSON on this site; base64 passes intact.
`__lr.reset()` clears a profile's stored parts.

## Chart design

Canvas 1200×1200. Time → angle: `T1` = now; `T0` = January of (now − `years`) with `years` = 15 by
default (`--years 10|all` on `render-html.mjs`, `?years=` on the page), but never earlier than the
first school or role, so short careers fill the circle. Entries that end before `T0` are listed in
the "Before <year>:" line under the title; entries that start before `T0` are clipped at the top
edge (`clipped`). Counts (hero years, roles, schools, lanes, places, longest roles) are computed
inside the window. Angles run clockwise over 360° minus a 22° gap at 12 o'clock.

| Element   | Spec                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Year ring | r 150–174, `bg-alt` band; hairline spokes at every January to the outer edge (major years in `rule`); tangential mono labels every `ceil(years/16)` years                                                                                                                                                                                                                                            |
| Education | r 186–214, `--c-edu` (ochre) arcs; logo (or initials) at the arc start; school name along the arc when it fits                                                                                                                                                                                                                                                                                       |
| Roles     | lanes of 30px from r 228 outward, 6px apart, up to 5; greedy interval packing with full-time roles first so they take the inner lanes; `--c-work` blue for full-time, `--c-side` (blue-200) for part-time / contract / advisory / board roles (`SIDE` matches the LinkedIn type, `SIDE_TITLE` the title); company logo at the arc start, company name along the arc only when it fits after the logo |
| Places    | one outer band (22px) of consecutive non-overlapping spans: for every period the place of the active full-time role, else of the longest active role with a location; country-only locations dropped; profile location fills current roles without one; top 4 places by years get `--c-loc-1..4`, the rest grey "Other"                                                                              |
| Core      | r 112 ink disc; photo r 42; name; "N YEARS · M ROLES"; first year → this year                                                                                                                                                                                                                                                                                                                        |
| Corners   | TL eyebrow + name + headline + reading hint; TR hero = merged full-time years + counts; BL legend (role kinds, then places); BR "Longest roles" block (three longest full-time roles) above the source line. No product branding by design                                                                                                                                                           |

Palette: Atlas blue `#1F46FF` (full-time), blue-200 `#C7D2FF` (side roles: a lighter step of the same
hue, emphasis/de-emphasis, not a second category), ochre `#C99A3D` (education), places
`#D85A2A / #8B3FA0 / #1F8A70 / #C99A3D` — the four-colour set validated with the dataviz validator on
the paper surface. Text always uses ink tokens; labels inside saturated arcs are white.

## Animation (progress p, 12 s + 3 s hold in the MP4)

| p         | What                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–0.10    | rings, core and corner text fade in                                                                                                                                                                                                                      |
| 0.10–0.78 | a hairline sweep hand moves clockwise from `T0` to now; every arc is drawn only up to the sweep angle; a logo and arc label appear when the sweep passes the arc's end; year labels appear as the sweep passes them; the hero and core counters count up |
| 0.78–0.80 | the sweep hand fades out |
| 0.80–0.95 | legend, longest-roles block, reading hint fade in                                                                                                                                                                                                        |
| 0.95–1.0 | hold (the MP4 adds a further 3 s hold after p = 1) |

`window.__chart.setProgress(p)` re-renders the SVG; `?p=0.4`, `?static=1`, `?theme=ink` work as URL
parameters. The video script captures `#stage` frame by frame.

## Troubleshooting

| Symptom                                           | Cause → fix                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Not on a LinkedIn profile URL`                   | run it on `/in/<id>/`, `/in/<id>/details/experience/` or `/details/education/`                                        |
| `Page content did not load`                       | slow render; wait and run again (details pages show a spinner first)                                                  |
| `experience saved: 0 companies`                   | list not found; check `details/experience/` actually lists positions for this profile (private profiles show nothing) |
| decode fails                                      | the base64 block was altered or truncated when copied; export and copy again                                          |
| photo or logos are initials                       | CDN URL expired (hours) or the avatar URL was rewritten; collect again and render promptly                            |
| a board seat shows as a full-time (dark blue) arc | add the title word to `SIDE_TITLE` in the template                                                                    |
| two roles overlap in one lane                     | lanes are capped at 5; raise `NL`'s cap or shrink `LANE_H`                                                            |
| places ring looks wrong                           | it is derived from role locations; a profile with no locations draws no ring                                          |
| `npx playwright install` blocked                  | set `XR_CHROMIUM` to an existing Chromium/Chrome binary                                                               |
