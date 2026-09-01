/* ============================================================
   Prize Board
   Static page. Pulls two-column CSV (prize, ticket) from the
   first source in config.js that answers, and re-pulls on a
   timer. No server, no build step, no dependencies.

   Reliability, in layers:
     1. try each source in order, so one outage isn't fatal
     2. keep the last good board on screen if a refresh fails
     3. cache it in localStorage, so a phone on bad wifi still
        renders instantly instead of showing a blank page
   ============================================================ */
(() => {
  'use strict';

  const CFG = Object.assign({
    kicker:        '★  Prize Draw  ★',
    title:         'Prize\nWinners',
    subtitle:      'Check your ticket number below',
    sources:       ['data/winners.csv'],
    refreshSeconds: 30,
    newestWinsPerPrize: true,
    prizeHeaders:  ['prize', 'prize #', 'prize no', 'prize number', 'board', '#'],
    ticketHeaders: ['ticket', 'ticket #', 'ticket no', 'ticket number', 'winner', 'number'],
  }, window.PRIZE_BOARD_CONFIG || {});

  // Accept the older single-URL form too.
  const SOURCES = (CFG.sources && CFG.sources.length ? CFG.sources
                 : [CFG.sourceUrl || 'data/winners.csv']).filter(Boolean);

  const CACHE_KEY = 'prize-board:v1';
  const CACHE_MAX_AGE = 12 * 60 * 60 * 1000;   // a stale board is worse than none

  const $ = (id) => document.getElementById(id);
  const el = { ticket:$('ticket'), ticketTo:$('ticketTo'), clear:$('clear'), verdict:$('verdict'), rows:$('rows'),
               state:$('state'), count:$('count'), stamp:$('stamp'), refresh:$('refresh') };

  let winners = [];              // [{prize, ticket}]
  let seen = new Set();          // keys from the previous render, to flag arrivals
  let hasRendered = false;
  let lastOkAt = null;
  let activeSource = -1;         // index into SOURCES; -1 = nothing reached yet
  let fromCache = false;
  let inFlight = false;
  let failures = 0;      // consecutive fully-failed loads, drives backoff
  let timer = null;

  /* ── Masthead ────────────────────────────────────────────── */
  const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  $('kicker').textContent = CFG.kicker;
  $('title').innerHTML = String(CFG.title).split('\n').map(esc).join('<br>');
  $('subtitle').textContent = CFG.subtitle;
  document.title = String(CFG.title).replace(/\n/g, ' ');

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
  /** Key a prize by its value, so "07" and "7" are the same prize. */
  const prizeKey = (p) => Number.isFinite(Number(p)) && p !== '' ? String(Number(p)) : String(p).toUpperCase();

  function pickColumns(table) {
    const head = table[0] || [];
    const wanted = (list) => head.findIndex(h => list.some(w => norm(h) === norm(w)));
    const p = wanted(CFG.prizeHeaders);
    const t = wanted(CFG.ticketHeaders);
    if (p !== -1 && t !== -1) return { prize:p, ticket:t, body:table.slice(1) };

    // No usable header row — first two columns, and only skip row 1 if it
    // looks like a label rather than data.
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

  async function pull(src) {
    const url = new URL(src, location.href);
    url.searchParams.set('_', Date.now());          // defeat any intermediate cache
    const res = await fetch(url, { cache:'no-store', redirect:'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return toWinners(await res.text());
  }

  async function load({ manual = false } = {}) {
    if (inFlight) return;
    inFlight = true;
    if (manual) { el.refresh.disabled = true; el.refresh.textContent = 'Refreshing…'; }

    let done = false;
    for (let i = 0; i < SOURCES.length; i++) {
      try {
        const rows = await pull(SOURCES[i]);
        // A backup that comes back empty must never replace a board we already
        // have. If the sheet gets rate-limited, this is the difference between
        // guests seeing a stale board and guests seeing "no winners yet".
        if (i > 0 && rows.length === 0 && winners.length > 0) {
          throw new Error('backup is empty; keeping the board already loaded');
        }
        winners = rows;
        activeSource = i;
        fromCache = false;
        lastOkAt = Date.now();
        saveCache();
        render();
        el.state.textContent = winners.length ? '' : 'No winners posted yet. Sit tight.';
        el.state.classList.remove('state--error');
        done = true;
        break;
      } catch (err) {
        console.warn(`[prize-board] source ${i} (${SOURCES[i]}) failed:`, err.message);
      }
    }

    if (done) {
      failures = 0;
    } else {
      failures++;
      // Nothing answered. Whatever is on screen stays, relabelled honestly as
      // a saved copy; only a phone that has never loaded sees an error.
      if (hasRendered && winners.length) fromCache = true;
      else if (!hasRendered) {
        el.state.textContent = 'Can’t reach the board. Retrying…';
        el.state.classList.add('state--error');
      }
    }

    inFlight = false;
    el.refresh.disabled = false;
    el.refresh.textContent = 'Refresh now';
    stamp();
    schedule();
  }

  /** Queue the next poll: jittered so a crowd doesn't synchronise, and backed
      off so a struggling source doesn't get hammered by every phone at once. */
  function schedule() {
    clearTimeout(timer);
    const base    = Math.max(5, CFG.refreshSeconds) * 1000;
    const backoff = Math.min(2 ** failures, 8);       // up to 8x on repeated failure
    const jitter  = 0.85 + Math.random() * 0.3;       // ±15%
    timer = setTimeout(() => {
      if (document.visibilityState === 'visible') load();
      else schedule();                                // stay idle, keep the chain alive
    }, base * backoff * jitter);
  }

  /* ── Render ──────────────────────────────────────────────── */

  function render() {
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
    el.count.textContent = winners.length ? `${winners.length} drawn` : '';
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

  const num = (v) => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  };

  /** People write their strip as "1020-1100" and paste or type the whole
      thing into the first box. Split it for them instead of making them
      retype — the second box is a convenience, not a requirement. */
  function absorbRange() {
    const m = el.ticket.value.match(
      /^\s*([A-Za-z0-9]+)\s*(?:-{1,2}|–|—|\.\.+|\/|to|through|thru)\s*([A-Za-z0-9]+)\s*$/i);
    if (!m) return;
    el.ticket.value   = m[1];
    el.ticketTo.value = m[2];
    // Hand the caret to the second box so the rest of what they're typing
    // lands there. Without this, typing "1020-1100" straight through splits
    // at "1020-1" and then keeps appending into the first box.
    el.ticketTo.focus();
    const end = el.ticketTo.value.length;
    try { el.ticketTo.setSelectionRange(end, end); } catch { /* older iOS */ }
  }

  /** Whatever is in the two boxes, as a predicate over ticket numbers. */
  function buildQuery() {
    // Mid-typing the first box reads "1020-"; treat that as just "1020"
    // rather than flashing "not yet" at someone halfway through a range.
    const a = el.ticket.value.trim().replace(/[-–—/.\s]+$/, '');
    const b = el.ticketTo.value.trim();
    if (!a && !b) return null;

    const na = num(a), nb = num(b);
    if (a && b && na !== null && nb !== null) {
      const lo = Math.min(na, nb), hi = Math.max(na, nb);   // tolerate reversed entry
      return {
        range: true, count: hi - lo + 1,
        test: (t) => { const n = num(t); return n !== null && n >= lo && n <= hi; },
      };
    }
    // One box filled, or non-numeric tickets: fall back to an exact match.
    const one = a || b;
    return { range: false, test: (t) => same(t, one) };
  }

  function check() {
    const q = buildQuery();
    el.clear.hidden = !q;
    el.rows.classList.toggle('rows--filtering', !!q);

    for (const li of el.rows.children) li.classList.remove('row--hit');
    if (!q) { el.verdict.replaceChildren(); return; }

    // Note we test the ~80 winners against the range, never the range against
    // the winners — a strip of 500 tickets costs exactly as much as one.
    const hits = winners.filter(w => q.test(w.ticket));
    for (const li of el.rows.children) {
      if (q.test(li.dataset.ticket)) li.classList.add('row--hit');
    }

    const card = document.createElement('div');
    card.className = 'verdict__card ' + (hits.length ? 'verdict__card--win' : 'verdict__card--miss');
    const line = (cls, txt) => {
      const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s;
    };

    if (hits.length === 1) {
      card.append(
        line('verdict__eyebrow', '★  Winner  ★'),
        line('verdict__big', `Prize ${hits[0].prize}`),
        line('verdict__small', `Ticket ${hits[0].ticket} — come see us to collect`)
      );
    } else if (hits.length > 1) {
      card.append(
        line('verdict__eyebrow', '★  Winner  ★'),
        line('verdict__big', `${hits.length} Prizes`)
      );
      // Which ticket won which prize — they need both to collect.
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
        line('verdict__eyebrow', q.range ? `Checked ${q.count} tickets` : 'Not on the board'),
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
    if (!lastOkAt) { el.stamp.textContent = 'Connecting…'; return; }

    if (fromCache) {
      el.stamp.textContent = `Saved board from ${clock(lastOkAt)} · reconnecting`;
      return;
    }

    const s = Math.max(0, Math.round((Date.now() - lastOkAt) / 1000));
    const ago = s < 5    ? 'Updated just now'
              : s < 60   ? `Updated ${s}s ago`
              : s < 3600 ? `Updated ${Math.round(s / 60)}m ago`
              :            `Updated ${clock(lastOkAt)}`;

    // Say so plainly when we've dropped off the primary source, so anyone
    // running the event can spot it without opening a console.
    el.stamp.textContent = activeSource > 0 ? `${ago} · backup list` : ago;
  }

  /* ── Wiring ──────────────────────────────────────────────── */

  el.ticket.addEventListener('input', () => { absorbRange(); check(); });
  el.ticketTo.addEventListener('input', check);
  el.clear.addEventListener('click', () => {
    el.ticket.value = ''; el.ticketTo.value = '';
    check(); el.ticket.focus();
  });
  el.refresh.addEventListener('click', () => load({ manual:true }));

  // Guests pocket and re-open this constantly; each return should be fresh.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
  window.addEventListener('online', () => load());

  setInterval(stamp, 1000);

  // Paint the cached board first so there's never a blank screen, then
  // go and get the real one.
  const cached = loadCache();
  if (cached) {
    winners = cached.rows;
    lastOkAt = cached.at;
    fromCache = true;
    render();
    el.state.textContent = '';
    stamp();
  }

  load();
})();
