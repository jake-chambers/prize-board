/* ============================================================
   Wording only. The winners themselves live in winners.js,
   which ./publish.sh generates — don't edit that by hand.
   ============================================================ */
window.PRIZE_BOARD_CONFIG = {

  kicker:   '★  Stag & Doe  ★',
  title:    'Prize\nWinners',        // \n = line break in the big headline
  subtitle: 'Check your ticket number below',

  // Shown before anything has been published.
  pendingMessage: 'Results go up here as soon as the draw is finished.',

  // Same-origin file the page re-checks so a correction published after
  // someone opened the page still reaches them. Set to null to switch even
  // that off and make the page completely self-contained.
  liveUrl: 'data/winners.json',
  recheckMinutes: 5,
};
