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
  // Tried in order. The first one that answers wins, so the CSV in
  // this repo is a safety net if the sheet is ever unreachable.
  //
  // To use your sheet, replace SHEET_ID below and set the tab name.
  // Setup steps are in the README.
  sources: [
    // Your sheet. gid=0 is the first tab — it keeps working even if you
    // rename that tab, which a tab name in the URL would not.
    'https://docs.google.com/spreadsheets/d/1lKp75tCmH31xOaIF__ZC1pKL8kdHi7cPs3QXWGBA5HA/gviz/tq?tqx=out:csv&gid=0',
    // Safety net, used automatically only if the sheet can't be reached.
    'data/winners.csv',
  ],

  // ── How often each guest's phone re-checks, in seconds ──────
  refreshSeconds: 20,

  // ── Typo insurance ──────────────────────────────────────────
  // With this on, entering the same prize number twice keeps only the
  // lower row — so fixing a mistake means re-entering that prize, and
  // the board sorts itself out. Turn off only if one prize number can
  // legitimately have two winning tickets.
  newestWinsPerPrize: true,

  // ── Column headers to look for (case/spacing insensitive) ───
  // If none match, the first two columns are used as prize, ticket.
  prizeHeaders:  ['prize', 'prize #', 'prize no', 'prize number', 'board', '#'],
  ticketHeaders: ['ticket', 'ticket #', 'ticket no', 'ticket number', 'winner', 'number'],
};
