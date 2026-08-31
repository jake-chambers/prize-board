/* ============================================================
   Prize Board
   Static page. Pulls a two-column CSV (prize, ticket) from
   whatever URL config.js points at, and re-pulls on a timer.
   No build step, no server, no dependencies.
   ============================================================ */
(() => {
  'use strict';

  const CFG = Object.assign({
    kicker:        '★  Prize Draw  ★',
    title:         'Prize\nWinners',
    subtitle:      'Check your ticket number below',
    sourceUrl:     'data/winners.csv',
    refreshSeconds: 20,
    prizeHeaders:  ['prize', 'prize #', 'prize no', 'prize number', 'board', '#'],
    ticketHeaders: ['ticket', 'ticket #', 'ticket no', 'ticket number', 'winner', 'number'],
  }, window.PRIZE_BOARD_CONFIG || {});

  const $ = (id) => document.getElementById(id);
  const el = { ticket:$('ticket'), clear:$('clear'), verdict:$('verdict'), rows:$('rows'),
               state:$('state'), count:$('count'), stamp:$('stamp'), refresh:$('refresh') };

  /** Last successfully-parsed rows: [{prize, ticket}] */
  let winners = [];
  /** Keys ("prize|ticket") seen in the previous load, to flag arrivals. */
  let seen = new Set();
  let firstLoad = true;
  let lastOkAt = null;
  let inFlight = false;

  /* ── Masthead text from config ───────────────────────────── */
  $('kicker').textContent = CFG.kicker;
  $('title').innerHTML = String(CFG.title).split('\n')
    .map(s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])))
    .join('<br>');
  $('subtitle').textContent = CFG.subtitle;
  document.title = String(CFG.title).replace(/\n/g, ' ');

  /* ── CSV ─────────────────────────────────────────────────── */

  /** RFC 4180 parser: handles quoted fields, escaped quotes, CRLF. */
  function parseCSV(text) {
    const out = [];
    let row = [], field = '', quoted = false;
    // Strip a UTF-8 BOM if the sheet exported one.
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

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

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9#]/g, '');

  /** Work out which column is the prize and which is the ticket. */
  function pickColumns(table) {
    const head = table[0] || [];
    const wanted = (list) => head.findIndex(h => list.some(w => norm(h) === norm(w)));
    let p = wanted(CFG.prizeHeaders);
    let t = wanted(CFG.ticketHeaders);

    if (p !== -1 && t !== -1) return { prize:p, ticket:t, body:table.slice(1) };

    // No usable header row — treat every row as data, first two columns.
    const looksLikeHeader = head.some(h => /[a-z]/i.test(h));
    return { prize:0, ticket:1, body: looksLikeHeader ? table.slice(1) : table };
  }

  function toWinners(text) {
    const table = parseCSV(text).filter(r => r.some(c => c !== ''));
    if (!table.length) return [];
    const { prize, ticket, body } = pickColumns(table);

    return body
      .map(r => ({ prize:(r[prize] || '').trim(), ticket:(r[ticket] || '').trim() }))
      .filter(w => w.prize !== '' && w.ticket !== '')
      .sort((a, b) => {
        const na = Number(a.prize), nb = Number(b.prize);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return String(a.prize).localeCompare(String(b.prize), undefined, { numeric:true });
      });
  }

  /* ── Fetch ───────────────────────────────────────────────── */

  async function load({ manual = false } = {}) {
    if (inFlight) return;
    inFlight = true;
    if (manual) { el.refresh.disabled = true; el.refresh.textContent = 'Refreshing…'; }

    try {
      const url = new URL(CFG.sourceUrl, location.href);
      url.searchParams.set('_', Date.now());          // defeat any intermediate cache
      const res = await fetch(url, { cache:'no-store', redirect:'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const next = toWinners(await res.text());
      winners = next;
      lastOkAt = Date.now();
      render();
      el.state.textContent = winners.length ? '' : 'No winners posted yet. Sit tight.';
      el.state.classList.remove('state--error');
      firstLoad = false;
    } catch (err) {
      console.warn('[prize-board] load failed:', err);
      if (firstLoad) {
        el.state.textContent = 'Can’t reach the board. Retrying…';
        el.state.classList.add('state--error');
      }
      // Otherwise: keep the last good board on screen and try again next tick.
    } finally {
      inFlight = false;
      el.refresh.disabled = false;
      el.refresh.textContent = 'Refresh now';
      stamp();
    }
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
      if (!firstLoad && !seen.has(key)) li.classList.add('row--new');
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
    el.count.textContent = winners.length
      ? `${winners.length} drawn` : '';
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
    const q = el.ticket.value.trim();
    el.clear.hidden = q === '';
    el.rows.classList.toggle('rows--filtering', q !== '');

    for (const li of el.rows.children) li.classList.remove('row--hit');

    if (q === '') { el.verdict.replaceChildren(); return; }

    const hits = winners.filter(w => same(w.ticket, q));

    for (const li of el.rows.children) {
      if (same(li.dataset.ticket, q)) li.classList.add('row--hit');
    }

    const card = document.createElement('div');
    card.className = 'verdict__card ' + (hits.length ? 'verdict__card--win' : 'verdict__card--miss');

    const line = (cls, txt) => {
      const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s;
    };

    if (hits.length) {
      const prizes = hits.map(h => h.prize).join(', ');
      card.append(
        line('verdict__eyebrow', '★  Winner  ★'),
        line('verdict__big', hits.length > 1 ? `Prizes ${prizes}` : `Prize ${prizes}`),
        line('verdict__small', `Ticket ${hits[0].ticket} — come see us to collect`)
      );
      const hit = [...el.rows.children].find(li => li.classList.contains('row--hit'));
      if (hit) hit.scrollIntoView({ block:'center', behavior:'smooth' });
    } else {
      card.append(
        line('verdict__eyebrow', 'Not on the board'),
        line('verdict__big', 'Not yet'),
        line('verdict__small', 'More prizes still to be drawn — check back')
      );
    }

    el.verdict.replaceChildren(card);
  }

  /* ── "Updated N ago" ─────────────────────────────────────── */

  function stamp() {
    if (!lastOkAt) { el.stamp.textContent = 'Connecting…'; return; }
    const s = Math.max(0, Math.round((Date.now() - lastOkAt) / 1000));
    el.stamp.textContent =
      s < 5   ? 'Updated just now' :
      s < 60  ? `Updated ${s}s ago` :
      s < 3600? `Updated ${Math.round(s / 60)}m ago` :
                `Updated ${new Date(lastOkAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`;
  }

  /* ── Wiring ──────────────────────────────────────────────── */

  el.ticket.addEventListener('input', check);
  el.ticket.addEventListener('search', check);
  el.clear.addEventListener('click', () => { el.ticket.value = ''; check(); el.ticket.focus(); });
  el.refresh.addEventListener('click', () => load({ manual:true }));
  el.ticket.form?.addEventListener('submit', (e) => e.preventDefault());

  // Pull again whenever the phone comes back to the page — guests pocket
  // and re-open this constantly, and that should always show fresh data.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
  window.addEventListener('online', () => load());

  setInterval(() => { if (document.visibilityState === 'visible') load(); },
              Math.max(5, CFG.refreshSeconds) * 1000);
  setInterval(stamp, 1000);

  load();
})();
