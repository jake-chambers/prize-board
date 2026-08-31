/* ============================================================
   EDIT THIS FILE — nothing else.
   Change a value, commit, and the live site picks it up.
   ============================================================ */
window.PRIZE_BOARD_CONFIG = {

  // ── Wording on the page ─────────────────────────────────────
  kicker:   '★  Stag & Doe  ★',
  title:    'Prize\nWinners',        // \n = line break in the big headline
  subtitle: 'Check your ticket number below',

  // ── Where the numbers come from ─────────────────────────────
  // Any URL that returns CSV with two columns: prize, ticket.
  //
  // A) Google Sheet (recommended — updates are live, no cache lag):
  //    1. Share the sheet: "Anyone with the link" → Viewer
  //    2. Use the URL below, swapping in your sheet ID and tab name
  //
  //    'https://docs.google.com/spreadsheets/d/SHEET_ID/gviz/tq?tqx=out:csv&sheet=Winners'
  //
  // B) The CSV committed in this repo (works offline of Google,
  //    but takes ~1 min to go live after each commit):
  sourceUrl: 'data/winners.csv',

  // ── How often each guest's phone re-checks, in seconds ──────
  refreshSeconds: 20,

  // ── Column headers to look for (case/spacing insensitive) ───
  // If none match, the first two columns are used as prize, ticket.
  prizeHeaders:  ['prize', 'prize #', 'prize no', 'prize number', 'board', '#'],
  ticketHeaders: ['ticket', 'ticket #', 'ticket no', 'ticket number', 'winner', 'number'],
};
