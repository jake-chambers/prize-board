# Prize Board

A static board of winning ticket numbers. Guests scan a QR code, type their
ticket number, and see whether it was drawn. No login, no app, no account.

**Live:** https://jake-chambers.github.io/prize-board/
**QR poster:** https://jake-chambers.github.io/prize-board/qr.html

---

## How it works

You fill in a Google Sheet during the draw. Nothing is public while you do.
When the draw is finished you run one command, which reads the sheet **once**
and bakes the winners into the page itself.

```
DURING            you  →  Google Sheet          (nothing public yet)
                  guests → "results go up when the draw is finished"

WHEN DONE         ./publish.sh
                    reads the sheet once
                    writes the winners into the page
                    commits and pushes

AFTER             guests → a static page, ~80 KB, from a CDN
                           no Google call, no API, no database
```

The important part: **a guest's phone never talks to Google.** Everything it
needs arrives in the page. That is what makes the big rush at the end a
non-event — a thousand people opening a static file is exactly what a CDN is
built for.

---

## Publishing

```sh
cd ~/Desktop/prize-board
./publish.sh
```

It prints every prize and ticket it found and asks before pushing anything.
Read that list before saying yes — it is the last check between the sheet and
a room full of people.

```
./publish.sh            read the sheet, show the list, confirm
./publish.sh -y         skip the confirmation
./publish.sh list.csv   publish from a local CSV instead of the sheet
```

Live about a minute after it pushes.

**Made a mistake?** Fix the sheet and run it again. Phones that already have
the page open pick the correction up on their own within five minutes, or
immediately when someone switches back to the tab.

### The sheet

Two columns, headers in row 1, on the first tab:

| prize | ticket |
|-------|--------|
| 1     | 10428  |
| 2     | 10093  |

Shared **Anyone with the link → Viewer** so `publish.sh` can read it. Only the
publish step ever reads it, so this matters for about two seconds a night.

Rows can go in any order. Entering the same prize twice keeps the lower row,
so re-entering a prize is how you fix a typo. Rows with a blank ticket are
ignored, which means you can pre-fill the prize column 1–80 before doors and
fill tickets in as you draw.

---

## What can go wrong

Much less than there used to be. The page has no third-party dependency at
runtime at all — not Google, not a font CDN, not a QR service. Once it loads
it works with the network off.

| State | Meaning |
|---|---|
| `Draw in progress` | Nothing published yet. Guests see the "results coming" message. |
| `Final results · posted 9:42 PM` | Normal. This is what guests should see. |
| `Something went wrong — reload this page.` | The script itself errored. Reloading fixes it. |

If `publish.sh` can't read the sheet it says so and **publishes nothing** —
it can't push a half-read or empty list by accident.

The remaining single point of failure is GitHub Pages serving the page at
all. That is a CDN, it is the only dependency left, and there is nothing
smaller to reduce it to.

---

## Files

| File | What it's for |
|------|---------------|
| `publish.sh` | **The one command you run.** Reads the sheet, bakes the results, pushes. |
| `winners.js` | Generated. The results, baked into the page. Don't edit by hand. |
| `data/winners.json` | Generated. Same data; lets an open page pick up a correction. |
| `config.js` | Wording on the page. |
| `index.html` | Page structure. |
| `assets/styles.css` | The letterpress theme — two colours, set as variables at the top. |
| `assets/app.js` | Render, ticket lookup. |
| `assets/fonts/` | Anton and Oswald, self-hosted. |
| `assets/qr.js` | Self-contained QR encoder for the poster. |
| `qr.html` | Printable QR poster. |
| `tools/build-winners.mjs` | CSV → baked data. Called by `publish.sh`. |

## If you ever edit the code

`index.html` loads its assets with a `?v=N` stamp. **Bump that number in
`index.html` and `qr.html` whenever you change a JS or CSS file**, or a phone
can run cached old JavaScript against new HTML. `publish.sh` handles the
stamp for `winners.js` automatically; this only applies to the code.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
