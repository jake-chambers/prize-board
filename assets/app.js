/* ============================================================
   Prize Board
   Static page. Pulls two-column CSV (prize, ticket) from the
   first source in config.js that answers, and re-pulls on a
   timer. No server, no build step, no dependencies.

   This runs unattended in front of a room full of people, so it
   is built to fail visibly and recoverably, never silently:

     · every DOM lookup is optional — a markup/script version
       skew must not be able to kill the script
     · every fetch has a hard timeout — a hung request on venue
       wifi must not wedge auto-refresh forever
     · the poll is always rescheduled, even after a crash
     · anything that does go wrong replaces the loading message
       with something true, rather than leaving a lie on screen
   ============================================================ */
(() => {
  'use strict';

  /* ── Tiny safe-DOM helpers ───────────────────────────────── */
  const $   = (id) => document.getElementById(id);
  const on  = (n, ev, fn) => { if (n) n.addEventListener(ev, fn); };
  const txt = (n, s) => { if (n) n.textContent = s; };

  /* ── State ───────────────────────────────────────────────── */
  let winners = [];              // [{prize, ticket}]
  let seen = new Set();          // keys from the previous render, to flag arrivals
  let hasRendered = false;
  let lastOkAt = null;
  let activeSource = -1;         // index into SOURCES; -1 = nothing reached yet
  let fromCache = false;
  let inFlight = false;
  let inFlightSince = 0;
  let failures = 0;              // consecutive fully-failed loads, drives backoff
  let timer = null;

  /* ── Never leave an untrue message on screen ─────────────── */
  function panic(msg) {
    const s = $('state');
    if (!s || hasRendered) return;      // a real board beats any error text
    s.textContent = msg;
    s.classList.add('state--error');
  }

  // Installed before anything else, so a crash during setup still surfaces
  // instead of stranding the page on "Loading the board…".
  window.addEventListener('error', (e) => {
    console.error('[prize-board] error:', e.message || e.error);
    panic('Something went wrong — reload this page.');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[prize-board] unhandled rejection:', e.reason);
    panic('Something went wrong — reload this page.');
  });
  // Belt and braces: if nothing at all has appeared by now, say so honestly.
  setTimeout(() => { if (!hasRendered) panic('Still trying to reach the board…'); }, 12000);

  /* ── Config ──────────────────────────────────────────────── */
  const CFG = Object.assign({
    kicker:        '★  Prize Draw  ★',
    title:         'Prize\nWinners',
    subtitle:      'Check your ticket number below',
    sources:       ['data/winners.csv'],
    refreshSeconds: 30,
    newestWinsPerPrize: true,
    fetchTimeoutMs: 8000,
    prizeHeaders:  ['prize', 'prize #', 'prize no', 'prize number', 'board', '#'],
    ticketHeaders: ['ticket', 'ticket #', 'ticket no', 'ticket number', 'winner', 'number'],
  }, window.PRIZE_BOARD_CONFIG || {});

  const SOURCES = (Array.isArray(CFG.sources) && CFG.sources.length ? CFG.sources
                 : [CFG.sourceUrl || 'data/winners.csv']).filter(Boolean);

  const CACHE_KEY = 'prize-board:v1';
  const CACHE_MAX_AGE = 12 * 60 * 60 * 1000;   // a stale board is worse than none

  const el = { ticket:$('ticket'), clear:$('clear'), verdict:$('verdict'), rows:$('rows'),
               state:$('state'), count:$('count'), stamp:$('stamp'), refresh:$('refresh') };

  /* ── CSV ─────────────────────────────────────────────────── */

  /** RFC 4180: quoted fields, escaped quotes, CRLF. */
  function parseCSV(text) {
    const out = [];
    let row = [], field = '', quoted = false;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip BOM

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"') { quoted = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); out.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); out.push(row); }
    return out.map(r => r.map(s => s.trim()));
  }

  const norm  = (s) => String(s).toLowerCase().replace(/[^a-z0-9#]/g, '');
  /** Google's CSV export renders whole numbers as "42.0" — undo that. */
  const clean = (v) => String(v ?? '').trim().replace(/^(-?\d+)\.0+$/, '$1');
  /** Key a prize by value, so "07" and "7" are the same prize. */
  const prizeKey = (p) =>
    Number.isFinite(Number(p)) && p !== '' ? String(Number(p)) : String(p).toUpperCase();

  function pickColumns(table) {
    const head = table[0] || [];
    const wanted = (list) => head.findIndex(h => list.some(w => norm(h) === norm(w)));
    const p = wanted(CFG.prizeHeaders);
    const t = wanted(CFG.ticketHeaders);
    if (p !== -1 && t !== -1) return { prize:p, ticket:t, body:table.slice(1) };

    const looksLikeHeader = head.some(h => /[a-z]/i.test(h));
    return { prize:0, ticket:1, body: looksLikeHeader ? table.slice(1) : table };
  }

  function toWinners(text) {
    // A sharing change turns the sheet response into an HTML login page that
    // still arrives as 200. Treat that as a failed source, not an empty board.
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('got HTML, not CSV');

    const table = parseCSV(text).filter(r => r.some(c => c !== ''));
    if (!table.length) return [];
    const { prize, ticket, body } = pickColumns(table);

    let rows = body
      .map(r => ({ prize:clean(r[prize]), ticket:clean(r[ticket]) }))
      .filter(w => w.prize !== '' && w.ticket !== '');

    // Same prize entered twice? The later row is the correction — it wins.
    if (CFG.newestWinsPerPrize) {
      const byPrize = new Map();
      for (const w of rows) byPrize.set(prizeKey(w.prize), w);
      rows = [...byPrize.values()];
    }

    return rows.sort((a, b) => {
      const na = Number(a.prize), nb = Number(b.prize);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return String(a.prize).localeCompare(String(b.prize), undefined, { numeric:true });
    });
  }

  /* ── Cache ───────────────────────────────────────────────── */

  function saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ rows:winners, at:lastOkAt }));
    } catch { /* private mode, quota — the board works without it */ }
  }

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c || !Array.isArray(c.rows) || !c.at) return null;
      if (Date.now() - c.at > CACHE_MAX_AGE) return null;
      return c;
    } catch { return null; }
  }

  /* ── Fetch ───────────────────────────────────────────────── */

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  async function pull(src) {
    const url = new URL(src, location.href);
    url.searchParams.set('_', Date.now());          // defeat any intermediate cache

    // Captive portals and congested wifi can leave a request hanging forever.
    // Without this the await never settles and auto-refresh dies for good.
    const ctl = new AbortController();
    const bail = setTimeout(() => ctl.abort(), Math.max(2000, CFG.fetchTimeoutMs));
    try {
      const res = await fetch(url, { cache:'no-store', redirect:'follow', signal:ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return toWinners(await res.text());
    } finally {
      clearTimeout(bail);
    }
  }

  async function load({ manual = false } = {}) {
    if (inFlight) {
      // A request that somehow outlived its own abort must not wedge polling.
      if (Date.now() - inFlightSince < 30000) return;
      console.warn('[prize-board] releasing a wedged request');
    }
    inFlight = true;
    inFlightSince = Date.now();
    if (manual && el.refresh) { el.refresh.disabled = true; txt(el.refresh, 'Refreshing…'); }

    try {
      let rows = null, used = -1;

      for (let i = 0; i < SOURCES.length; i++) {
        // The sheet rate-limits on bursts of simultaneous connections, and a
        // crowd all opening the page at once is exactly that. One quick retry
        // absorbs it; the delay is randomised so retries don't re-cluster.
        const attempts = i === 0 ? 2 : 1;

        for (let n = 0; n < attempts; n++) {
          try {
            if (n > 0) await wait(600 + Math.random() * 800);
            const got = await pull(SOURCES[i]);

            // An empty answer from a *backup* is never authoritative. The
            // primary failing and the backup being empty does not mean "no
            // winners" — it means we don't know, and saying "no winners yet"
            // to someone whose ticket just won is worse than saying nothing.
            if (i > 0 && got.length === 0) {
              throw new Error('backup is empty; not authoritative');
            }
            rows = got; used = i;
            break;
          } catch (err) {
            console.warn(`[prize-board] source ${i} attempt ${n + 1} (${SOURCES[i]}) failed:`,
                         err.message);
          }
        }
        if (rows) break;
      }

      if (rows) {
        winners = rows;
        activeSource = used;
        fromCache = false;
        lastOkAt = Date.now();
        failures = 0;
        saveCache();
        // Deliberately outside the fetch try: a rendering bug is not a source
        // failure and must not be misreported as one.
        render();
        txt(el.state, winners.length ? '' : 'No winners posted yet. Sit tight.');
        if (el.state) el.state.classList.remove('state--error');
      } else {
        failures++;
        // Nothing answered. Whatever is on screen stays, relabelled honestly
        // as a saved copy; only a phone that never loaded sees an error.
        if (hasRendered && winners.length) fromCache = true;
        else panic('Can’t reach the board. Retrying…');
      }
    } catch (err) {
      console.error('[prize-board] load crashed:', err);
      failures++;
      panic('Something went wrong — reload this page.');
    } finally {
      inFlight = false;
      if (el.refresh) { el.refresh.disabled = false; txt(el.refresh, 'Refresh now'); }
      stamp();
      schedule();                       // the poll chain always continues
    }
  }

  /** Queue the next poll: jittered so a crowd doesn't synchronise, and backed
      off so a struggling source isn't hammered by every phone at once. */
  function schedule() {
    clearTimeout(timer);
    const base    = Math.max(5, CFG.refreshSeconds) * 1000;
    const backoff = Math.min(2 ** failures, 8);       // up to 8x on repeated failure
    // ±30%. Bursts of simultaneous connections are what gets rate-limited,
    // not throughput, so spreading the crowd out matters more than the rate.
    const jitter  = 0.7 + Math.random() * 0.6;
    timer = setTimeout(() => {
      if (document.visibilityState === 'visible') load();
      else schedule();                                // stay idle, keep the chain alive
    }, base * backoff * jitter);
  }

  /* ── Render ──────────────────────────────────────────────── */

  function render() {
    if (!el.rows) return;
    const frag = document.createDocumentFragment();
    const nextSeen = new Set();

    for (const w of winners) {
      const key = w.prize + '|' + w.ticket;
      nextSeen.add(key);

      const li = document.createElement('li');
      li.className = 'row';
      if (hasRendered && !seen.has(key)) li.classList.add('row--new');
      li.dataset.ticket = w.ticket;

      const prize = document.createElement('span');
      prize.className = 'row__prize';
      prize.textContent = w.prize;

      const leader = document.createElement('span');
      leader.className = 'row__leader';
      leader.setAttribute('aria-hidden', 'true');

      const ticket = document.createElement('span');
      ticket.className = 'row__ticket';
      ticket.textContent = w.ticket;

      li.append(prize, leader, ticket);
      li.setAttribute('aria-label', `Prize ${w.prize}, ticket ${w.ticket}`);
      frag.append(li);
    }

    el.rows.replaceChildren(frag);
    seen = nextSeen;
    hasRendered = true;
    txt(el.count, winners.length ? `${winners.length} drawn` : '');
    check();                                    // re-apply any active search
  }

  /* ── Ticket check ────────────────────────────────────────── */

  /** Two tickets match if they're the same text, or the same number. */
  function same(a, b) {
    const A = String(a).trim().toUpperCase().replace(/\s+/g, '');
    const B = String(b).trim().toUpperCase().replace(/\s+/g, '');
    if (A === B) return true;
    const na = Number(A), nb = Number(B);
    return A !== '' && B !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
  }

  function check() {
    if (!el.ticket || !el.rows || !el.verdict) return;

    const q = el.ticket.value.trim();
    if (el.clear) el.clear.hidden = q === '';
    el.rows.classList.toggle('rows--filtering', q !== '');

    for (const li of el.rows.children) li.classList.remove('row--hit');
    if (q === '') { el.verdict.replaceChildren(); return; }

    const hits = winners.filter(w => same(w.ticket, q));
    for (const li of el.rows.children) {
      if (same(li.dataset.ticket, q)) li.classList.add('row--hit');
    }

    const card = document.createElement('div');
    card.className = 'verdict__card ' + (hits.length ? 'verdict__card--win' : 'verdict__card--miss');
    const line = (cls, s) => {
      const n = document.createElement('span'); n.className = cls; n.textContent = s; return n;
    };

    if (hits.length === 1) {
      card.append(
        line('verdict__eyebrow', '★  Winner  ★'),
        line('verdict__big', `Prize ${hits[0].prize}`),
        line('verdict__small', `Ticket ${hits[0].ticket} — come see us to collect`)
      );
    } else if (hits.length > 1) {
      // One ticket number can be against more than one prize.
      card.append(
        line('verdict__eyebrow', '★  Winner  ★'),
        line('verdict__big', `${hits.length} Prizes`)
      );
      const ul = document.createElement('ul');
      ul.className = 'verdict__list';
      for (const h of hits) {
        const li = document.createElement('li');
        const t = document.createElement('span');
        t.textContent = `Ticket ${h.ticket}`;
        const lead = document.createElement('span');
        lead.className = 'lead'; lead.setAttribute('aria-hidden', 'true');
        const pz = document.createElement('b');
        pz.textContent = `Prize ${h.prize}`;
        li.append(t, lead, pz);
        ul.append(li);
      }
      card.append(ul, line('verdict__small', 'Come see us to collect'));
    } else {
      card.append(
        line('verdict__eyebrow', 'Not on the board'),
        line('verdict__big', 'Not yet'),
        line('verdict__small', 'More prizes still to be drawn — check back')
      );
    }

    if (hits.length) {
      const hit = [...el.rows.children].find(li => li.classList.contains('row--hit'));
      if (hit) hit.scrollIntoView({ block:'center', behavior:'smooth' });
    }
    el.verdict.replaceChildren(card);
  }

  /* ── Status line ─────────────────────────────────────────── */

  const clock = (t) => new Date(t).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });

  function stamp() {
    if (!el.stamp) return;
    if (!lastOkAt) { txt(el.stamp, 'Connecting…'); return; }

    if (fromCache) {
      txt(el.stamp, `Saved board from ${clock(lastOkAt)} · reconnecting`);
      return;
    }

    const s = Math.max(0, Math.round((Date.now() - lastOkAt) / 1000));
    const ago = s < 5    ? 'Updated just now'
              : s < 60   ? `Updated ${s}s ago`
              : s < 3600 ? `Updated ${Math.round(s / 60)}m ago`
              :            `Updated ${clock(lastOkAt)}`;

    // Say so plainly when we've dropped off the primary source, so anyone
    // running the event can spot it without opening a console.
    txt(el.stamp, activeSource > 0 ? `${ago} · backup list` : ago);
  }

  /* ── Setup ───────────────────────────────────────────────── */
  try {
    const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    txt($('kicker'), CFG.kicker);
    const title = $('title');
    if (title) title.innerHTML = String(CFG.title).split('\n').map(esc).join('<br>');
    txt($('subtitle'), CFG.subtitle);
    document.title = String(CFG.title).replace(/\n/g, ' ');

    on(el.ticket, 'input', check);
    on(el.ticket, 'search', check);
    on(el.clear, 'click', () => {
      if (el.ticket) { el.ticket.value = ''; check(); el.ticket.focus(); }
    });
    on(el.refresh, 'click', () => load({ manual:true }));

    // Guests pocket and re-open this constantly; each return should be fresh.
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') load();
    });
    on(window, 'online', () => load());

    setInterval(stamp, 1000);

    // Paint the cached board first so there's never a blank screen, then go
    // and get the real one.
    const cached = loadCache();
    if (cached) {
      winners = cached.rows;
      lastOkAt = cached.at;
      fromCache = true;
      render();
      txt(el.state, '');
      stamp();
    }
  } catch (err) {
    console.error('[prize-board] setup failed:', err);
    panic('Something went wrong — reload this page.');
  }

  // Outside the setup try: even if wiring up the page failed, still fetch and
  // render the board. A dead button is survivable; a dead board is not.
  load();
})();
