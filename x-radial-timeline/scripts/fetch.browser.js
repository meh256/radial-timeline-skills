// x-radial-timeline — in-page collector + aggregator for one X handle.
//
// HOW TO RUN (a browser tool that executes JavaScript in the page, on a tab that is on https://x.com, logged in):
//   1. Run:  window.__XR_HANDLE = '<handle>'; window.__XR_WEEKS = 52;   (optionally window.__XR_BACKFILL = true)   then run this WHOLE file.
//      It returns immediately; collection continues in the background (2–5 min for most accounts,
//      up to an hour+ for very heavy posters because of X's rate limits — keep the tab open).
//   2. Poll every 20–30 s (every few minutes once `phase` says backfill):  __xr.status()
//      until  done === true  (check `error` is null).
//   3. Run:  __xr.export()   — replaces the tab's document with a plain text page holding the JSON.
//   4. Read the page with the page-text tool and save everything between XR_JSON_BEGIN and
//      XR_JSON_END to  data/<handle>.json  (15–30 KB; copy it exactly, do not retype it).
//
// Sources, in order:
//   • UserTweets + UserRepliesTimeline (profile streams): everything, but X stops paginating around
//     3,200 recent items per profile.
//   • Backfill (only when window.__XR_BACKFILL = true): for weeks older than what the streams reached, SearchTimeline with
//     `from:<handle> since:<day> until:<day>` per week (20 items a page). Search returns posts,
//     replies and quotes but NOT reposts, so backfilled weeks have repost = 0; the export records
//     `backfill.repostsUnavailableBefore` and the chart prints that caveat.
//   • Hard ceiling: window.__XR_MAX_ITEMS (default 16000) items in total.
// A 429 pauses 65 s and retries (20 attempts).
(() => {
  const HANDLE = (window.__XR_HANDLE || '').replace(/^@/, '');
  const WEEKS = window.__XR_WEEKS || 52;
  const MAX_ITEMS = window.__XR_MAX_ITEMS || 16000;
  const BACKFILL = window.__XR_BACKFILL === true; // opt-in: search backfill is request-heavy (hundreds of pages, hours of 429 sleeps)
  if (!HANDLE) return 'Set window.__XR_HANDLE first';
  const DAY = 86400e3;
  const UNTIL = Date.now();
  const SINCE = UNTIL - WEEKS * 7 * DAY;
  const MAX_PAGES_PER_STREAM = 400;
  const MAX_PAGES_PER_SLICE = 60;
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const state = { phase: 'init', pages: 0, oldest: null, done: false, error: null, user: null, byId: new Map(), stops: {}, streamOldest: {}, backfill: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const MARGIN_WEEKS = 8; // streams tail off with a few scattered old items before they stop, so backfill re-searches this far past the boundary
  function coverageBoundary() { // later of the two streams' oldest items — both must cover a week for it to be complete
    const s = Object.values(state.streamOldest);
    return s.length ? s.reduce((a, b) => (a > b ? a : b)) : null;
  }
  function aggregate() {
    const mk = (start) => ({ start: day(start), end: day(start + 7 * DAY - 1), post: 0, reply: 0, repost: 0, quote: 0, likes: 0, reposts: 0, replies: 0, quotes: 0, photo: 0, video: 0, gif: 0, link: 0, top: null });
    const weekly = Array.from({ length: WEEKS }, (_, i) => mk(SINCE + i * 7 * DAY));
    const daily = Array.from({ length: WEEKS * 7 }, () => [0, 0, 0, 0]); // [post, reply, repost, quote]
    const totals = { post: 0, reply: 0, repost: 0, quote: 0, likes: 0, reposts: 0, replies: 0, quotes: 0, photo: 0, video: 0, gif: 0, link: 0 };
    const TYPES = ['post', 'reply', 'repost', 'quote'];
    let dropped = 0;
    for (const p of state.byId.values()) {
      const t = +new Date(p.t);
      if (t < SINCE || t >= UNTIL) { dropped++; continue; }
      const wi = Math.min(WEEKS - 1, Math.floor((t - SINCE) / (7 * DAY)));
      const di = Math.min(WEEKS * 7 - 1, Math.floor((t - SINCE) / DAY));
      const w = weekly[wi];
      w[p.type]++; totals[p.type]++; daily[di][TYPES.indexOf(p.type)]++;
      if (p.type !== 'repost') { // a repost's counts belong to the original author
        for (const k of ['likes', 'reposts', 'replies', 'quotes']) { w[k] += p[k]; totals[k] += p[k]; }
        if (!w.top || p.likes > w.top.likes) w.top = { t: p.t.slice(0, 16), type: p.type, likes: p.likes, reposts: p.reposts, replies: p.replies };
      }
      if (p.media) { w[p.media]++; totals[p.media]++; }
      if (p.link) { w.link++; totals.link++; }
    }
    const boundary = coverageBoundary();
    const bf = state.backfill;
    // oldest = coverage boundary: the start of the earliest week that is fully covered by streams or backfill
    const oldest = bf && bf.completedTo ? bf.completedTo : boundary || state.oldest;
    // reposts only come from the profile stream; before the first week that has any, repost counts are unreliable
    const firstRepostWeek = bf ? weekly.find((w) => w.repost > 0) : null;
    return { handle: HANDLE, weeks: WEEKS, since: new Date(SINCE).toISOString(), until: new Date(UNTIL).toISOString(), collectedAt: new Date().toISOString(), oldest, oldestAny: state.oldest, streamOldest: state.streamOldest, stops: state.stops, backfill: bf && { ...bf, repostsUnavailableBefore: firstRepostWeek ? firstRepostWeek.start : bf.to }, maxItems: MAX_ITEMS, pages: state.pages, collected: state.byId.size, dropped, user: state.user, totals, weekly, daily };
  }

  window.__xr = {
    status: () => ({ phase: state.phase, pages: state.pages, posts: state.byId.size, oldest: state.oldest, streamOldest: state.streamOldest, stops: state.stops, backfill: state.backfill, done: state.done, error: state.error }),
    data: aggregate,
    export: () => {
      const json = JSON.stringify(aggregate()).replace(/</g, '\\u003c');
      document.open();
      document.write('<!doctype html><html><head><meta charset="utf-8"><title>xr export ' + HANDLE + '</title></head><body><article><h1>xr export</h1><p>XR_JSON_BEGIN</p><p>' + json + '</p><p>XR_JSON_END</p></article></body></html>');
      document.close();
      return 'exported ' + json.length + ' chars; read the page text now';
    },
  };

  async function main() {
    state.phase = 'bundle';
    const mainSrc = [...document.scripts].map((s) => s.src).find((s) => /client-web\/main\./.test(s));
    if (!mainSrc) throw new Error('Not on x.com (no client-web bundle found); open https://x.com/<handle> first');
    const src = await fetch(mainSrc).then((r) => r.text());
    const ops = {};
    for (const m of src.matchAll(/queryId:"([^"]+)",operationName:"([A-Za-z]+)"/g)) ops[m[2]] = m[1];
    const bearer = (src.match(/AAAAAAAAAAAAAAAAAAAAA[A-Za-z0-9%]+/) || [])[0];
    const ct0 = (document.cookie.match(/ct0=([^;]+)/) || [])[1];
    if (!ct0) throw new Error('Not logged in to X (no ct0 cookie)');
    const headers = { authorization: 'Bearer ' + decodeURIComponent(bearer), 'x-csrf-token': ct0, 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-active-user': 'yes', 'content-type': 'application/json' };
    const features = {};
    async function gql(op, variables, post = false) { // SearchTimeline only answers POST; the profile streams answer GET
      if (!ops[op]) throw new Error('GraphQL operation missing from bundle: ' + op + ' (X renamed it; see reference.md "Endpoints")');
      for (let attempt = 0; attempt < 20; attempt++) {   // 20 × 65 s outlasts a 15-min rate-limit window
        let r;
        if (post) r = await fetch(`https://x.com/i/api/graphql/${ops[op]}/${op}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify({ variables, features, queryId: ops[op] }) });
        else { const u = new URL(`https://x.com/i/api/graphql/${ops[op]}/${op}`); u.searchParams.set('variables', JSON.stringify(variables)); u.searchParams.set('features', JSON.stringify(features)); r = await fetch(u, { headers, credentials: 'include' }); }
        if (r.status === 429) { state.phase = `rate-limited on ${op}, sleeping 65s (${state.byId.size} items so far)`; await sleep(65000); continue; }
        const j = await r.json().catch(() => ({}));
        const msg = (j.errors || []).map((e) => e.message).join(' ');
        const m = msg.match(/features cannot be null: (.*)/);
        if (m) { for (const f of m[1].split(/,\s*/)) features[f.trim()] = true; continue; }
        if (!r.ok) throw new Error(`${op} HTTP ${r.status}: ${msg}`.trim());
        return j;
      }
      throw new Error('Too many retries on ' + op);
    }
    state.phase = 'user';
    const u = await gql('UserByScreenName', { screen_name: HANDLE, withGrokTranslatedBio: false });
    const ur = u?.data?.user?.result;
    if (!ur?.rest_id) throw new Error('User not found: @' + HANDLE);
    const userId = ur.rest_id;
    state.user = {
      id: userId,
      handle: ur.core?.screen_name || HANDLE,
      name: ur.core?.name || ur.legacy?.name || HANDLE,
      avatar: (ur.avatar?.image_url || ur.legacy?.profile_image_url_https || '').replace('_normal', '_400x400'),
      followers: ur.relationship_counts?.followers ?? ur.legacy?.followers_count ?? null,
      following: ur.relationship_counts?.following ?? ur.legacy?.friends_count ?? null,
      postsTotal: ur.tweet_counts?.tweets ?? ur.legacy?.statuses_count ?? null,
      joined: ur.core?.created_at || ur.legacy?.created_at || null,
      bio: ur.profile_bio?.description || ur.legacy?.description || '',
    };
    let currentOp = '';
    function record(t) {
      t = t.tweet || t;
      const l = t.legacy; if (!l || l.user_id_str !== userId || !t.rest_id) return false;
      const iso = new Date(l.created_at).toISOString();
      const type = l.retweeted_status_result ? 'repost' : l.is_quote_status ? 'quote' : l.in_reply_to_status_id_str ? 'reply' : 'post';
      const media = (l.extended_entities?.media || []).map((m) => m.type);
      const link = (l.entities?.urls || []).some((x) => x.expanded_url && !/^https?:\/\/(x|twitter)\.com\//.test(x.expanded_url));
      state.byId.set(t.rest_id, { t: iso, type, likes: l.favorite_count | 0, reposts: l.retweet_count | 0, replies: l.reply_count | 0, quotes: l.quote_count | 0, media: media.includes('video') ? 'video' : media.includes('animated_gif') ? 'gif' : media.includes('photo') ? 'photo' : null, link });
      if (!state.oldest || iso < state.oldest) state.oldest = iso;
      if (!state.streamOldest[currentOp] || iso < state.streamOldest[currentOp]) state.streamOldest[currentOp] = iso;
      return true;
    }
    const tweetsOf = (inst) => {
      const pinned = new Set(inst.filter((i) => i.type === 'TimelinePinEntry').map((i) => i.entry?.entryId));
      const entries = inst.flatMap((i) => (i.type === 'TimelinePinEntry' ? [] : i.entries || (i.entry ? [i.entry] : [])));
      const tweets = entries.flatMap((e) => { const c = e.content; if (pinned.has(e.entryId)) return []; if (c?.itemContent?.tweet_results?.result) return [c.itemContent.tweet_results.result]; if (c?.items) return c.items.map((it) => it.item?.itemContent?.tweet_results?.result).filter(Boolean); return []; });
      const bottom = entries.find((e) => e.content?.cursorType === 'Bottom')?.content?.value;
      return { tweets, bottom };
    };
    async function stream(op) {
      currentOp = op; let cursor; let pages = 0; let empty = 0;
      while (pages < MAX_PAGES_PER_STREAM && state.byId.size < MAX_ITEMS) {
        state.phase = `${op} page ${pages + 1}`;
        const vars = { userId, count: 40, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: false, withVoice: true };
        if (cursor) vars.cursor = cursor;
        const j = await gql(op, vars);
        const tl = j?.data?.user?.result?.timeline?.timeline || j?.data?.user?.result?.timeline_v2?.timeline;
        const { tweets, bottom } = tweetsOf(tl?.instructions || []);
        let pageOldest = Infinity; let own = 0;
        for (const t of tweets) { if (record(t)) { own++; pageOldest = Math.min(pageOldest, +new Date((t.tweet || t).legacy.created_at)); } }
        pages++; state.pages++;
        if (!bottom) { state.stops[op] = 'no-cursor'; break; }                  // X's ~3,200-item cap looks like this
        if (tweets.length === 0) { if (++empty >= 3) { state.stops[op] = 'empty'; break; } cursor = bottom; continue; }
        empty = 0;
        if (own > 0 && pageOldest < SINCE) { state.stops[op] = 'reached-since'; break; }
        cursor = bottom;
        await sleep(400);
      }
      if (!state.stops[op]) state.stops[op] = state.byId.size >= MAX_ITEMS ? 'max-items' : 'max-pages';
    }
    async function searchSlice(sinceDay, untilDay, label) { // returns true if the slice was exhausted, false if it hit the page cap
      let cursor; let pages = 0; let empty = 0;
      while (pages < MAX_PAGES_PER_SLICE && state.byId.size < MAX_ITEMS) {
        state.phase = `backfill ${label} page ${pages + 1} (${state.byId.size} items)`;
        const variables = { rawQuery: `from:${HANDLE} since:${sinceDay} until:${untilDay}`, count: 20, querySource: 'typed_query', product: 'Latest' };
        if (cursor) variables.cursor = cursor;
        const j = await gql('SearchTimeline', variables, true);
        const { tweets, bottom } = tweetsOf(j?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || []);
        for (const t of tweets) record(t);
        pages++; state.pages++; state.backfill.pages++;
        if (!bottom) return true;
        if (tweets.length === 0) { if (++empty >= 2) return true; cursor = bottom; continue; }
        empty = 0; cursor = bottom;
        await sleep(400);
      }
      return state.byId.size >= MAX_ITEMS;
    }
    async function backfill() {
      const boundary = coverageBoundary();
      if (!boundary || +new Date(boundary) <= SINCE + DAY) return;         // streams covered the whole window
      const lastWeek = Math.min(WEEKS - 1, Math.floor((+new Date(boundary) - SINCE) / (7 * DAY)) + MARGIN_WEEKS);
      state.backfill = { from: day(SINCE), to: day(SINCE + (lastWeek + 1) * 7 * DAY - 1), weeks: lastWeek + 1, weeksDone: 0, pages: 0, completedTo: null };
      currentOp = 'SearchTimeline';
      for (let i = lastWeek; i >= 0 && state.byId.size < MAX_ITEMS; i--) {   // newest gap first, so a cap leaves the nearest weeks complete
        const ws = SINCE + i * 7 * DAY, we = ws + 7 * DAY;
        const done = await searchSlice(day(ws), day(we), `week ${i + 1}/${WEEKS} ${day(ws)}`);
        if (!done) for (let d = 0; d < 7 && state.byId.size < MAX_ITEMS; d++) await searchSlice(day(ws + d * DAY), day(ws + (d + 1) * DAY), `day ${day(ws + d * DAY)}`); // a week with > 1,200 items: split into days
        state.backfill.weeksDone++; state.backfill.completedTo = day(ws);
      }
      state.stops.SearchTimeline = state.byId.size >= MAX_ITEMS ? 'max-items' : 'complete';
    }
    await stream('UserTweets');          // posts, reposts, quotes (and the odd reply)
    await stream('UserRepliesTimeline'); // replies, mixed with other people's tweets (filtered by user id)
    if (BACKFILL) await backfill();      // opt-in: search, week by week, for whatever the streams did not reach
    state.phase = 'done'; state.done = true;
  }
  main().catch((e) => { state.error = String((e && e.stack) || e); state.phase = 'error'; state.done = true; });
  return 'collector started for @' + HANDLE + ' (' + WEEKS + ' weeks, ceiling ' + MAX_ITEMS + ' items)';
})();
