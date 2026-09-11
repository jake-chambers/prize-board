#!/usr/bin/env bash
# Publish the winners to the live site.
#
#   ./publish.sh          read the sheet, show what it found, ask before pushing
#   ./publish.sh -y       skip the confirmation
#   ./publish.sh file.csv publish from a local CSV instead of the sheet
#
# Everything guests need ends up baked into the page. Their phones never
# talk to Google.

set -euo pipefail
cd "$(dirname "$0")"

SHEET_URL='https://docs.google.com/spreadsheets/d/1lKp75tCmH31xOaIF__ZC1pKL8kdHi7cPs3QXWGBA5HA/gviz/tq?tqx=out:csv&gid=0'

ASSUME_YES=0
SOURCE=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *.csv)    SOURCE="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

TMP="$(mktemp -t winners).csv"
trap 'rm -f "$TMP"' EXIT

if [ -n "$SOURCE" ]; then
  echo "Reading $SOURCE"
  cp "$SOURCE" "$TMP"
else
  echo "Reading the sheet…"
  if ! curl -fsSL --max-time 20 "${SHEET_URL}&_=$(date +%s)" -o "$TMP"; then
    echo >&2
    echo "Could not read the sheet. Check you're online, and that it's still shared" >&2
    echo "as \"Anyone with the link → Viewer\". Nothing was published." >&2
    exit 1
  fi
fi

echo
node tools/build-winners.mjs "$TMP"
echo
echo "── what guests will see ──────────────────────────────"
node -e '
  const { winners } = require("./data/winners.json");
  if (!winners.length) { console.log("  (nothing — the board will say results are coming)"); process.exit(0); }
  const w = 3;
  for (let i = 0; i < winners.length; i += w) {
    console.log("  " + winners.slice(i, i + w)
      .map(x => `${String(x.prize).padStart(3)} · ${String(x.ticket).padEnd(8)}`).join("   "));
  }
'
echo "──────────────────────────────────────────────────────"
echo

if git diff --quiet -- winners.js data/winners.json; then
  echo "No change since the last publish. Nothing to do."
  exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'Publish this to the live site? [y/N] '
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled. Nothing was published."; git checkout -- winners.js data/winners.json index.html; exit 0 ;;
  esac
fi

COUNT=$(node -e 'console.log(require("./data/winners.json").winners.length)')
git add winners.js data/winners.json index.html
git commit -q -m "Publish results — ${COUNT} winners"
git push -q origin main

echo
echo "Published. Live in about a minute at:"
echo "  https://jake-chambers.github.io/prize-board/"
