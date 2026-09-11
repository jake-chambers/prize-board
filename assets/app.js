/* ============================================================
   Prize Board

   The winners are baked into the page by ./publish.sh, so there
   is nothing to fetch before a guest can see results. No third
   party is involved at runtime: no Google call, no CORS, no
   rate limit, no fallback chain, no cache to go stale.

   The page does re-check its own origin for a newer publish, so
   a correction reaches phones that already have it open. That
   request is pure upside — the baked data is already on screen,
   so if it fails there is simply nothing to do about it.
   ============================================================ */
(() => {
  'use strict';

  const $   = (id) => document.getElementById(id);
  const on  = (n, ev, fn) => { if (n) n.addEventListener(ev, fn); };
  const txt = (n, s) => { if (n) n.textContent = s; };

  let winners = [];
  let publishedAt = null;
  let hasRendered = false;

  /** Never leave a message on screen that isn't true. */
  function panic(msg) {
    const s = $('state');
    if (!s || hasRendered) return;
    s.textContent = msg;
    s.classList.add('state--error');
  }
  window.addEventListener('error', (e) => {
    console.error('[prize-board] error:', e.message || e.error);
    panic('Something went wrong — reload this page.');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[prize-board] unhandled rejection:', e.reason);
    panic('Something went wrong — reload this page.');
  });

  const CFG = Object.assign({
    kicker:   '★  Prize Draw  ★',
    title:    'Prize\nWinners',
    subtitle: 'Check your ticket number below',
    pendingMessage: 'Results go up here as soon as the draw is finished.',
    liveUrl:  'data/winners.json',
    recheckMinutes: 5,
  }, window.PRIZE_BOARD_CONFIG || {});

  const el = { checker:document.querySelector('.checker'), ticket:$('ticket'), clear:$('clear'), verdict:$('verdict'), rows:$('rows'),
               state:$('state'), count:$('count'), stamp:$('stamp') };

  /* ── Taking on a set of results ──────────────────────────── */

  function adopt(payload) {
    if (!payload || !Array.isArray(payload.winners)) return false;
    // Ignore anything that isn't newer than what we're already showing.
    if (publishedAt && payload.publishedAt && payload.publishedAt <= publishedAt) return false;

    winners = payload.winners.filter(w => w && w.prize !== '' && w.ticket !== '');
    publishedAt = payload.publishedAt || null;
    render();
    stamp();
    return true;
  }

  /* ── Render ──────────────────────────────────────────────── */

  function render() {
    if (!el.rows) return;
    const frag = document.createDocumentFragment();

    for (const w of winners) {
      const li = document.createElement('li');
      li.className = 'row';
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
    hasRendered = true;
    txt(el.count, winners.length ? `${winners.length} drawn` : '');

    // Nothing published means nothing to look up. Hiding the box is kinder
    // than letting someone type their ticket in and get a non-answer.
    if (el.checker) el.checker.hidden = winners.length === 0;

    if (el.state) {
      el.state.classList.remove('state--error');
      txt(el.state, winners.length ? '' : CFG.pendingMessage);
    }
    check();                                   // re-apply any active search
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
      // Final, not provisional. The results are already complete by the time
      // anyone is typing into this box.
      card.append(
        line('verdict__eyebrow', 'Not on the board'),
        line('verdict__big', 'Not this time'),
        line('verdict__small', 'Thanks for supporting the night')
      );
    }

    if (hits.length) {
      const hit = [...el.rows.children].find(li => li.classList.contains('row--hit'));
      if (hit) hit.scrollIntoView({ block:'center', behavior:'smooth' });
    }
    el.verdict.replaceChildren(card);
  }

  /* ── Footer ──────────────────────────────────────────────── */

  function stamp() {
    if (!el.stamp) return;
    if (!publishedAt) { txt(el.stamp, 'Draw in progress'); return; }
    const when = new Date(publishedAt);
    txt(el.stamp, Number.isNaN(when.getTime())
      ? 'Final results'
      : `Final results · posted ${when.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`);
  }

  /* ── Pick up a correction published after this page loaded ── */

  async function recheck() {
    if (!CFG.liveUrl) return;
    try {
      const res = await fetch(`${CFG.liveUrl}?_=${Date.now()}`, { cache:'no-store' });
      if (!res.ok) return;
      adopt(await res.json());
    } catch {
      // Same-origin and entirely optional. The baked results are already
      // on screen, so there is nothing to fall back to and nothing to say.
    }
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

    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') recheck();
    });
    on(window, 'online', recheck);
    setInterval(recheck, Math.max(1, CFG.recheckMinutes) * 60 * 1000);
  } catch (err) {
    console.error('[prize-board] setup failed:', err);
    panic('Something went wrong — reload this page.');
  }

  // Outside the setup try: even if wiring the page up failed, still show the
  // results. A dead button is survivable; a dead board is not.
  if (!adopt(window.PRIZE_WINNERS)) render();     // render() covers the empty case
  recheck();
})();
