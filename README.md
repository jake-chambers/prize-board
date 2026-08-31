# Prize Board

A static, phone-first board of winning ticket numbers. Guests scan a QR code,
type their ticket number, and immediately see whether it was drawn. No login,
no app, no account — for them or for you, once it's set up.

**Live:** https://jake-chambers.github.io/prize-board/
**QR poster:** https://jake-chambers.github.io/prize-board/qr.html

---

## How it works

You type winners into a Google Sheet. Guests' phones read that sheet directly
and redraw the board every 30 seconds. There is no server and no database.

```
   You                     Google Sheet              Guest's phone
   ───                     ────────────              ─────────────
   type prize + ticket ──▶  prize │ ticket  ──CSV──▶  the board
                            1     │ 10428             updates itself
                            2     │ 10093             every 20s
```

Guests never see Google. They see the board, and they never have to sign in
to anything.

---

## One-time setup

**1. Make the sheet.** A new Google Sheet, two columns, headers in row 1:

| prize | ticket |
|-------|--------|
| 1     | 10428  |
| 2     | 10093  |

Name the tab `Winners` (bottom-left). Keep the header row even when the sheet
is otherwise empty.

**2. Share it so the board can read it.**
**Share → General access → Anyone with the link → Viewer.**

> Leave it on **Viewer**, not Editor. Viewer is all the board needs. If you
> want other volunteers to enter numbers, add them by email under
> "People with access" instead — that keeps the sheet un-vandalisable by
> anyone who happens to get the link.

Do *not* use File → Publish to the web. It isn't needed, and it lags by up to
five minutes.

**3. Point the board at it.** Copy the sheet ID out of the browser address bar:

```
docs.google.com/spreadsheets/d/1AbC...xyz/edit
                              ^^^^^^^^^^^^ this part
```

Then in [`config.js`](config.js), uncomment the sheet line and paste it in:

```js
sources: [
  'https://docs.google.com/spreadsheets/d/1AbC...xyz/gviz/tq?tqx=out:csv&sheet=Winners',
  'data/winners.csv',
],
```

Commit. **That's the last time you touch this repo.** From here on you only
ever open the sheet.

---

## Running the draw

Open the sheet. Type the prize number and the winning ticket number. Move to
the next row. That's the whole job — guests see each new row within about 30
seconds, and it flashes briefly on their screen as it lands.

Rows can go in in any order; the board always sorts by prize number.

**Made a typo?** Just enter that prize number again on a new row with the
correct ticket. The board keeps the *lower* of any two rows sharing a prize
number, so the correction wins and the mistake disappears. You never have to
hunt for the bad cell mid-event. (Controlled by `newestWinsPerPrize` in
`config.js` — turn it off only if one prize number can legitimately have two
winning tickets.)

You can also just fix the cell directly. Either works.

---

## When something goes wrong

The board is built so that no single failure blanks it. In order:

1. **The sheet is unreachable** — venue wifi blocking Google, sharing setting
   changed, Google having a bad day. The board silently falls back to
   [`data/winners.csv`](data/winners.csv) in this repo.
2. **A refresh fails** — the last good board stays on screen. It does not go
   blank and does not show an error over top of real data.
3. **The guest's connection is bad** — every phone saves the last board it
   successfully loaded, so the page renders instantly from that and catches up
   when the signal returns.

### Read the status line

The bottom of the page always tells you the truth about what's on screen:

| It says | It means |
|---|---|
| `Updated 12s ago` | Live from your sheet. This is the normal state. |
| `Updated 12s ago · backup list` | **The sheet isn't reachable** — showing `data/winners.csv`. Check sharing is still "Anyone with the link → Viewer". |
| `Saved board from 8:42 PM · reconnecting` | That phone can't reach anything; showing its own last copy. Usually the guest's signal, not you. |
| `Connecting…` | First load, hasn't reached a source yet. |

**Check this line on your own phone before doors open.** If it says
`backup list`, the sheet isn't wired up correctly and every guest is looking
at the fallback file.

---

## Before the event

- [ ] Sheet created, shared **Anyone with the link → Viewer**, ID pasted into `config.js`.
- [ ] Empty `data/winners.csv` down to just its header row, or fill it with a
      real snapshot. **The 8 rows committed there now are fake.**
- [ ] Set `kicker`, `title` and `subtitle` in `config.js` to your event.
- [ ] Load the live site on a phone. Confirm the status line says `Updated …`
      with **no** "backup list".
- [ ] Add a test row to the sheet, watch it appear on the phone, delete it again.
- [ ] Print `qr.html` and scan the printout from across a table.

---

## Files

| File | What it's for |
|------|---------------|
| `config.js` | **The only file you need to edit.** Wording, data sources, refresh rate. |
| `data/winners.csv` | Fallback, used automatically if the sheet can't be reached. |
| `index.html` | Page structure. |
| `assets/styles.css` | The letterpress theme — two colours, set as CSS variables at the top. |
| `assets/app.js` | Fetch with fallback, CSV parse, render, ticket lookup, offline cache. |
| `qr.html` | Printable QR poster pointing at the board. |

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

A plain `file://` open won't work — the CSV fetch needs an HTTP origin.

## Will it hold up for a crowd?

Measured, not guessed. Numbers below are from the live site and the real sheet.

**What each guest downloads once:** about 10 KB of HTML, CSS and JS, plus
roughly 33 KB of fonts that their browser then caches for the rest of the
night. Call it 43 KB per person, one time.

**What each guest pulls on a refresh:** 90 bytes for 7 rows; expect around
1 KB with all 80 prizes drawn. That's it — no images, no framework.

**GitHub Pages.** A thousand guests is about 10 MB against a
[soft limit of 100 GB per month](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
— roughly 0.01% of the allowance. Not a consideration.

**The Google endpoint.** This is the only part under real load, so it was
load-tested directly: 150 requests at 25 concurrent, then 200 requests at 50
concurrent, all from a single IP (the venue-wifi case, where hundreds of
guests share one public address). **All 350 returned HTTP 200**, median 240 ms,
p95 300 ms. No throttling, no 429s.

Three things keep the sustained rate far below that anyway:

- Polling **pauses entirely when the page isn't visible**. Guests check the
  board and pocket the phone; a backgrounded tab makes no requests at all.
  Realistically only a fraction of the room is polling at any moment.
- The interval is **jittered ±15%**, so a crowd that all scanned the QR at the
  same moment doesn't stay locked into one synchronised spike every 30s.
- Repeated failures **back off exponentially** up to 8×, so a struggling
  endpoint doesn't get hammered by every phone at once.

**If Google throttles anyway**, the board degrades instead of breaking: phones
keep showing the last board they loaded, labelled `Saved board from … ·
reconnecting`, and recover on their own. An empty backup can never replace a
board that already has rows on it.

The honest caveat: `gviz` is an undocumented endpoint with no published rate
limit, so nobody can promise a ceiling. What can be said is that it was not
reachable at the rates tested, and that every failure path has somewhere
sensible to land.

## Why this endpoint

The board reads the sheet through Google's `gviz` CSV endpoint rather than the
better-known "Publish to the web" CSV. Two measured reasons:

- It answers with `Access-Control-Allow-Origin` set to the requesting site, so
  a browser on a static page is allowed to read it.
- It answers with `Cache-Control: no-cache, no-store, must-revalidate`, so
  every refresh gets the sheet's current contents. The publish-to-web CSV is
  cached and can lag several minutes behind what you typed.
