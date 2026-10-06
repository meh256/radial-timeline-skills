// linkedin-radial-timeline — in-page collector for one LinkedIn profile.
//
// HOW TO RUN (a browser tool that executes JavaScript in the page, logged in to linkedin.com).
// Run this WHOLE file once on EACH of these three pages, in this order, waiting for the page to
// finish loading each time (the script itself waits up to 25 s for content):
//   1. https://www.linkedin.com/in/<publicId>/                      → profile header (name, headline, location, photo)
//   2. https://www.linkedin.com/in/<publicId>/details/experience/   → every position (scrolls to load them all)
//   3. https://www.linkedin.com/in/<publicId>/details/education/    → every school
// Each run returns a one-line summary and stores its part in localStorage, so the parts survive
// navigation. Then run:  __lr.export()   → the tab becomes a plain text page; read it with the
// page-text tool, save the base64 between LR_B64_BEGIN and LR_B64_END to data/<publicId>.b64, then run
//   node scripts/decode.mjs <publicId>   → data/<publicId>.json  (quotes/ampersands do not survive the page-text channel; base64 does)
// To start over for a profile:  __lr.reset()
//
// Parsing is structural (LinkedIn's class names are obfuscated and change): entries are found by
// their date-range text ("Jan 2020 - Present · 5 yrs 9 mos", "2004 – 2009"), grouped positions by the
// container whose children each hold exactly one date range. Education entries without a date are kept.
(async () => {
  const m = location.pathname.match(
    /^\/in\/([^/]+)\/?(details\/(experience|education)\/?)?/,
  );
  if (!m) return "Not on a LinkedIn profile URL (/in/<publicId>/...)";
  const publicId = decodeURIComponent(m[1]);
  const page = m[3] || "profile";
  const KEY = "__lr_" + publicId;
  const store = JSON.parse(localStorage.getItem(KEY) || "{}");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MONTHS = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  const DATE =
    /^(?:([A-Za-z]{3})[a-z]* )?(\d{4})\s*[–-]\s*(?:([A-Za-z]{3})[a-z]* )?(\d{4}|Present)(?:\s*·\s*(.*))?$/;
  const visible = (e) => e.offsetParent !== null;
  const clean = (t) => t.replace(/\s+/g, " ").trim();
  const leafEls = (root) =>
    [...root.querySelectorAll("*")].filter(
      (e) =>
        e.children.length === 0 &&
        e.textContent.trim() &&
        !["SCRIPT", "STYLE", "IMG", "SVG", "PATH", "BUTTON"].includes(
          e.tagName,
        ) &&
        visible(e),
    );
  const leaves = (root) =>
    leafEls(root)
      .map((e) => clean(e.textContent))
      .filter((t, i, a) => t !== a[i - 1]);
  const parseRange = (t) => {
    const r = DATE.exec(clean(t));
    if (!r) return null;
    const ym = (mon, y) =>
      y === "Present"
        ? null
        : `${y}-${String(mon ? MONTHS[mon.toLowerCase()] || 1 : 1).padStart(2, "0")}`;
    return {
      start: ym(r[1], r[2]),
      end: ym(r[3], r[4]),
      endMonthKnown: !!r[3],
      startMonthKnown: !!r[1],
      duration: r[5] || null,
      present: r[4] === "Present",
    };
  };
  const logoOf = (el) => {
    const img = el.querySelector("img");
    return img && img.src && !/profile-displayphoto/.test(img.src)
      ? { src: img.src, alt: img.alt || "" }
      : null;
  };
  const EMP = /^(Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Apprenticeship|Seasonal|Volunteer)$/i;
  const typeIn = (line) => (line || "").split("·").map((x) => x.trim()).find((x) => EMP.test(x)) || null;
  const SKIP =
    /^(Show more|Show less|Show all|·|Connect|Message|More|Follow|Pending|Skills:|…see more|See more)$/i;

  window.__lr = {
    status: () => ({
      publicId,
      parts: Object.keys(store),
      experience: store.experience?.length,
      education: store.education?.length,
    }),
    reset: () => {
      localStorage.removeItem(KEY);
      return "cleared " + KEY;
    },
    export: () => {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      const out = {
        publicId,
        url: `https://www.linkedin.com/in/${publicId}/`,
        collectedAt: new Date().toISOString(),
        profile: s.profile || null,
        experience: s.experience || [],
        education: s.education || [],
        missing: ["profile", "experience", "education"].filter((k) => !s[k]),
      };
      // base64, 100 chars a line: the page-text channel strips quotes and ampersands from raw JSON
      const json = JSON.stringify(out);
      const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/(.{100})/g, "$1\n");
      document.open();
      document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>lr export</title></head><body><article><h1>lr export</h1><p>LR_B64_BEGIN</p><pre>" + b64 + "</pre><p>LR_B64_END</p></article></body></html>");
      document.close();
      return "exported " + json.length + " chars as base64; read the page text now" + (out.missing.length ? " (MISSING parts: " + out.missing.join(", ") + ")" : "");
    },
  };

  const main = () => document.querySelector("main") || document.body;
  // wait for the page's content: a date range, or (education) the section heading with entries under it
  const ready = () =>
    page === "profile"
      ? /\|/.test(document.title) && leaves(main()).length > 5
      : leafEls(main()).some((e) => DATE.test(clean(e.textContent))) ||
        leaves(main()).some(
          (t) => t === (page === "experience" ? "Experience" : "Education"),
        );
  for (let i = 0; i < 50 && !ready(); i++) await sleep(500);
  if (!ready())
    return `Page content did not load (${page}); reload and run again`;

  if (page === "profile") {
    // the name is the page title ("Name | LinkedIn"); the headline and location are the leaves right after it
    const name = clean((document.title || "").split(" | ")[0]) || clean(main().querySelector("h1")?.textContent || "");
    const all = leaves(main());
    const i = all.findIndex((t) => t === name);
    const after = i >= 0 ? all.slice(i + 1, i + 8) : all.slice(0, 8);
    const headline = after.find((t) => !/^·$|Contact info|Connect|Message|More|followers|connections/.test(t) && t.length > 2) || "";
    const loc = after.filter((t) => t !== headline).find((t) => !/^·$|Contact info|Connect|Message|More|followers|connections/.test(t) && t.length < 60) || "";
    const avatar = [...main().querySelectorAll("img")].find((im) => /profile-displayphoto/.test(im.src) && im.width >= 100) || [...main().querySelectorAll("img")].find((im) => /profile-displayphoto/.test(im.src));
    store.profile = { name, headline, location: loc, avatar: avatar ? avatar.src : null, followers: all.find((t) => /followers|connections/.test(t)) || null, collectedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(store));
    return `profile saved: ${name} — ${headline} — ${loc}`;
  }

  // details pages: scroll until the number of date ranges stops growing (lazy-loaded lists)
  let last = -1;
  for (let i = 0; i < 12; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
    const n = leafEls(main()).filter((e) =>
      DATE.test(clean(e.textContent)),
    ).length;
    if (n === last) break;
    last = n;
  }
  window.scrollTo(0, 0);
  const root = main();
  const dateLeaves = leafEls(root).filter((e) =>
    DATE.test(clean(e.textContent)),
  );
  // the entries container: find the section (common ancestor of the heading and the first entry), then the
  // highest level below it whose children include at least two entry-like blocks (a logo, a date range, or
  // several text lines) — that level is the list; its entry-like children are the entries, logo or not
  const headEl = leafEls(root).find((e) => clean(e.textContent) === (page === "experience" ? "Experience" : "Education"));
  const entryLike = (c) => !(headEl && c.contains(headEl)) && (!!c.querySelector("img") || dateLeaves.some((d) => c.contains(d)) || leaves(c).length >= 2);
  let anchor = dateLeaves[0] || (headEl && [...root.querySelectorAll("img")].find((im) => headEl.compareDocumentPosition(im) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
  let container = null;
  if (anchor) {
    let section = headEl ? headEl.parentElement : root;
    while (section && section !== root && !section.contains(anchor)) section = section.parentElement;
    let level = anchor.parentElement;
    const candidates = [];
    while (level && level !== root) { if ([...level.children].filter(entryLike).length >= 2) candidates.push(level); if (level === section) break; level = level.parentElement; }
    container = candidates.length ? candidates[candidates.length - 1] : anchor.parentElement;
  }
  const kids = container ? [...container.children].filter(entryLike) : [];

  if (page === "experience") {
    const entries = kids
      .map((li) => {
        const my = dateLeaves.filter((d) => li.contains(d));
        let nested = null;
        if (my.length > 1) {
          let n = my[0];
          while (n && n !== li) {
            const sibs = [...n.parentElement.children];
            if (
              sibs.length >= 2 &&
              sibs.every(
                (s) => dateLeaves.filter((d) => s.contains(d)).length === 1,
              )
            ) {
              nested = n.parentElement;
              break;
            }
            n = n.parentElement;
          }
        }
        const logo = logoOf(li);
        if (nested) {
          // grouped: company header + one block per role
          const nestedText = new Set(leaves(nested));
          const head = leaves(li).filter(
            (t) => !nestedText.has(t) && !SKIP.test(t),
          );
          const company = head[0] || logo?.alt?.replace(/ logo$/i, "") || "";
          const type = typeIn(head[1]);
          const roles = [...nested.children].map((r) => {
            const t = leaves(r).filter((x) => !SKIP.test(x));
            const di = t.findIndex((x) => DATE.test(x));
            const range = di >= 0 ? parseRange(t[di]) : null;
            return {
              title: t[0] || "",
              type: (di > 1 ? typeIn(t[1]) : null) || type,
              ...range,
              location:
                t[di + 1] &&
                !/^https?:/.test(t[di + 1]) &&
                t[di + 1].length < 60
                  ? t[di + 1]
                  : null,
              description:
                t
                  .slice(di + 2)
                  .join(" ")
                  .slice(0, 300) || null,
            };
          });
          return { company, logo, roles };
        }
        const t = leaves(li).filter((x) => !SKIP.test(x));
        const di = t.findIndex((x) => DATE.test(x));
        const company = (t[1] || "").split("·")[0].trim();
        const range = di >= 0 ? parseRange(t[di]) : null;
        return {
          company: company || logo?.alt?.replace(/ logo$/i, "") || "",
          logo,
          roles: [
            {
              title: t[0] || "",
              type: typeIn(t[1]),
              ...range,
              location:
                t[di + 1] &&
                !/^https?:/.test(t[di + 1]) &&
                t[di + 1].length < 60
                  ? t[di + 1]
                  : null,
              description:
                t
                  .slice(di + 2)
                  .join(" ")
                  .slice(0, 300) || null,
            },
          ],
        };
      })
      .filter((e) => e.roles.some((r) => r.start));
    store.experience = entries;
    store.experienceCollectedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(store));
    return `experience saved: ${entries.length} companies, ${entries.reduce((a, e) => a + e.roles.length, 0)} roles, ${dateLeaves.length} date ranges seen`;
  }

  if (page === "education") {
    const entries = kids
      .map((li) => {
        const t = leaves(li).filter((x) => !SKIP.test(x));
        const di = t.findIndex((x) => DATE.test(x));
        const range = di >= 0 ? parseRange(t[di]) : null;
        return {
          school: t[0] || "",
          logo: logoOf(li),
          degree: (di === -1 ? t[1] : di > 1 ? t[1] : null) || null,
          ...(range || { start: null, end: null }),
          notes:
            t
              .slice(di >= 0 ? di + 1 : 2)
              .join(" ")
              .slice(0, 200) || null,
        };
      })
      .filter((e) => e.school);
    store.education = entries;
    store.educationCollectedAt = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(store));
    return `education saved: ${entries.length} schools (${entries.filter((e) => e.start).length} with dates)`;
  }
})();
