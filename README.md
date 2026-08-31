# Prize Board

A static, phone-first board of winning ticket numbers. Guests scan a QR code,
land on the page, type their ticket number, and immediately see whether it was
drawn. No login, no app, no Google account.

**Live:** https://jake-chambers.github.io/prize-board/
**QR poster:** https://jake-chambers.github.io/prize-board/qr.html

---

## How it works

`index.html` is plain HTML/CSS/JS served by GitHub Pages. On load — and every
20 seconds after — it fetches a CSV of `prize, ticket` pairs from whatever URL
`config.js` names, and redraws the board. There is no server and no database.

```
Google Sheet (you edit)  ──CSV over HTTPS──▶  guest's phone
```

---

## Running the draw

You have two options for where the numbers live. Pick one in `config.js`.

### Option A — Google Sheet (recommended)

Numbers appear on guests' phones within seconds of you typing them, and any
number of people can edit the sheet at once.

1. Make a sheet with two columns, headers in row 1:

   | prize | ticket |
   |-------|--------|
   | 1     | 10428  |
   | 2     | 10093  |

2. **Share → General access → Anyone with the link → Viewer.**
   (Do *not* use File → Publish to the web. The `gviz` URL below reads the
   shared sheet directly and is never cached; the publish-to-web CSV lags by
   up to five minutes.)

3. Copy the sheet ID out of its URL:
   `docs.google.com/spreadsheets/d/`**`1AbC...xyz`**`/edit`

4. Put this in `config.js`, with your ID and your tab name:

   ```js
   sourceUrl: 'https://docs.google.com/spreadsheets/d/1AbC...xyz/gviz/tq?tqx=out:csv&sheet=Winners',
   ```

5. Commit and push. From then on you only touch the sheet — never the repo.

Why this endpoint: it responds with `Access-Control-Allow-Origin` matching the
requesting site, so a browser on a static page is allowed to read it, and with
`Cache-Control: no-cache, no-store, must-revalidate`, so every refresh gets the
current contents.

### Option B — the CSV in this repo

Edit [`data/winners.csv`](data/winners.csv) on github.com and commit. Takes
about a minute to go live while Pages rebuilds. Fine as a backup if the venue's
wifi is blocking Google, or if you'd rather not depend on it.

---

## Before the event

- [ ] Empty `data/winners.csv` down to just the header row, or point
      `sourceUrl` at your sheet. **The committed sample rows are fake.**
- [ ] Set `kicker`, `title` and `subtitle` in `config.js` to your event.
- [ ] Open the site on a phone and confirm the board loads.
- [ ] Print `qr.html` (it's laid out for one sheet of paper).
- [ ] Scan the printed QR from across a table to check it reads at that size.

## During the event

Type each prize number and its winning ticket into the sheet as you draw it.
Guests' phones pick it up on their next refresh — new rows flash briefly so
people watching the board notice them arrive. Rows can be added in any order;
the board always sorts by prize number.

If the sheet goes unreachable mid-event, phones keep displaying the last board
they successfully loaded rather than going blank, and quietly retry.

---

## Files

| File | What it's for |
|------|---------------|
| `config.js` | **The only file you need to edit.** Wording, data source, refresh rate. |
| `data/winners.csv` | Fallback data source. |
| `index.html` | Page structure. |
| `assets/styles.css` | The letterpress theme — two colours, set at the top as CSS variables. |
| `assets/app.js` | Fetch, CSV parse, render, ticket lookup. |
| `qr.html` | Printable QR poster pointing at the board. |

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

A plain `file://` open won't work — the CSV fetch needs an HTTP origin.
