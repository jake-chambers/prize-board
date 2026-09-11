#!/usr/bin/env bash
# Publish the winners to the live site.
#
#   ./publish.sh          read the sheet, show what it found, ask before pushing
#   ./publish.sh -y       skip the confirmation
#   ./publish.sh file.csv publish from a local CSV instead of the sheet
#
# Everything guests need ends up baked into the page. Their phones never
# talk to Google.
#
# Unless a publish completes, this script leaves the repo exactly as it
# found it — including if you cancel, or it fails, or you Ctrl-C it.

set -euo pipefail
cd "$(dirname "$0")"

SHEET_URL='https://docs.google.com/spreadsheets/d/1lKp75tCmH31xOaIF__ZC1pKL8kdHi7cPs3QXWGBA5HA/gviz/tq?tqx=out:csv&gid=0'
GENERATED=(winners.js data/winners.json index.html)

ASSUME_YES=0
SOURCE=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *.csv)    SOURCE="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

WORK="$(mktemp -d)"
PUBLISHED=0
restore() {
  if [ "$PUBLISHED" -ne 1 ]; then
    # Put back byte-for-byte what was here before, so a cancelled or failed
    # run can never leave staged-looking results behind.
    for f in "${GENERATED[@]}"; do
      b="$WORK/orig_${f//\//_}"
      [ -f "$b" ] && cp "$b" "$f"
    done
  fi
  rm -rf "$WORK"
}
trap restore EXIT INT TERM

for f in "${GENERATED[@]}"; do
  [ -f "$f" ] && cp "$f" "$WORK/orig_${f//\//_}"
done

CSV="$WORK/winners.csv"
if [ -n "$SOURCE" ]; then
  echo "Reading $SOURCE"
  cp "$SOURCE" "$CSV"
else
  echo "Reading the sheet…"
  if ! curl -fsSL --max-time 20 "${SHEET_URL}&_=$(date +%s)" -o "$CSV"; then
    echo >&2
    echo "Could not read the sheet. Check you're online, and that it's still shared" >&2
    echo "as \"Anyone with the link → Viewer\". Nothing was published." >&2
    exit 1
  fi
fi

echo
node tools/build-winners.mjs "$CSV"
echo
echo "── what guests will see ──────────────────────────────"
node -e '
  const { winners } = require("./data/winners.json");
  if (!winners.length) { console.log("  (nothing — the board will say results are coming)"); process.exit(0); }
  for (let i = 0; i < winners.length; i += 3) {
    console.log("  " + winners.slice(i, i + 3)
      .map(x => `${String(x.prize).padStart(3)} · ${String(x.ticket).padEnd(8)}`).join("   "));
  }
'
echo "──────────────────────────────────────────────────────"
echo

if [ "$ASSUME_YES" -ne 1 ]; then
  printf 'Publish this to the live site? [y/N] '
  # `|| reply=""` so reaching end-of-input counts as "no" rather than
  # tripping set -e and leaving the job half done.
  read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled. Nothing was published."; exit 0 ;;
  esac
fi

COUNT=$(node -e 'console.log(require("./data/winners.json").winners.length)')
git add -- "${GENERATED[@]}"
git commit -q -m "Publish results — ${COUNT} winners"
git push -q origin main
PUBLISHED=1

echo
echo "Published. Live in about a minute at:"
echo "  https://jake-chambers.github.io/prize-board/"
