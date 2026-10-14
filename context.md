# Ticketer — Raas Rangilo Dandiya Night

Offline-event ticketing that stops forged and reused passes. Printed tickets carry a QR code holding a random UUID. At the gate a phone scans it, the server checks the UUID against `tickets.db`, and a pass works exactly once.

## How it works

1. **Generate** (`node generate.js`, on a laptop): mints every pass into `tickets.db` and writes one print-ready PDF, `out/tickets.pdf`.
2. **Print** the PDF. 3 tickets per A4 page; each category starts on a fresh page.
3. **Deploy** `server.js` + `scanner.html` + `tickets.db` to EC2 behind HTTPS.
4. **Scan** at the gate: open the site on any phone, point at a ticket. Green `LET IN — <category> #<serial>` or red `REFUSE — <reason>`.

## Current batch

| Category   | Count | Serials       | Artwork              |
|------------|-------|---------------|----------------------|
| Individual | 1500  | #0001 – #1500 | `art/individual.png` |
| Couple     | 1000  | #0001 – #1000 | `art/couple.png`     |
| Family (4) | 1000  | #0001 – #1000 | `art/family.png`     |

3500 passes total, all in `tickets.db` and `out/tickets.pdf`. A family pass admits 4 people on one scan, so gate staff count heads when the screen says "family".

## Files

| File | Purpose |
|------|---------|
| `generate.js`  | Mints UUIDs into `tickets.db` and renders `out/tickets.pdf`. Category counts, QR position and serial position live at the top of the file. |
| `server.js`    | Zero-dependency Node HTTP server. `GET /` serves the scanner, `POST /scan` checks a pass, `GET /stats` returns `{ total, inside }`. |
| `scanner.html` | Mobile scanner page. Uses the camera through `html5-qrcode` (CDN), with a manual ID box as fallback. |
| `test.js`      | End-to-end check: mints a tiny batch, then asserts valid entry, reuse refused, forged ID refused, and that two simultaneous scans of one pass admit exactly once. |
| `art/*.png`    | Ticket artwork, cropped to the ticket edge. Only `generate.js` uses these. |
| `tickets.db`   | **The single source of truth.** Table `tickets(id, batch, seq, used_at)`. |
| `out/tickets.pdf` | The print file. Not needed on the server. |

## Rules that matter

- **One entry per pass.** Check-in is a single atomic statement, `UPDATE tickets SET used_at = ? WHERE id = ? AND used_at IS NULL`. Only the first scan changes a row, so two gates scanning the same ticket at the same moment can never both admit it.
- **Forgery.** IDs are v4 UUIDs, which can't be guessed, and a pass is only valid if its ID is in the DB. Category is stored but plays no part in validity.
- **No network means no entry.** If a scan can't reach the server, the page says `NO NETWORK — do not admit, rescan`. It never guesses, because a guess lets one pass in twice.
- **Don't re-run `generate.js`** unless you want a new batch. Each run appends fresh IDs that won't match an already-printed PDF. For a clean batch, delete `tickets.db` first.
- **Never overwrite the EC2 copy of `tickets.db` during the event.** Once scanning starts, that copy holds the check-ins.

## Running it

```bash
npm install
npm test            # end-to-end check
npm run generate    # mint the batch + PDF (clean batch: delete tickets.db first)
npm start           # scanner on :8080 (PORT and DB_FILE env vars override)
```

Needs Node 22+ for the built-in `node:sqlite`.

## EC2 deployment

Copy `server.js`, `scanner.html`, `package.json` and `tickets.db` to the instance, then run `npm start` under systemd or pm2 so it survives reboots. `art/`, `out/` and `generate.js` stay on the laptop.

The camera only works over HTTPS. Point a domain at the instance and put Caddy in front; it provisions the certificate itself:

```bash
sudo caddy reverse-proxy --from gate.yourdomain.com --to localhost:8080
```

## Known limits

- The scanner loads `html5-qrcode` from unpkg, so each phone needs internet the first time it opens the page.
- There is no staff login: anyone with the URL can open the scanner. Keep the URL private.
- No undo for an accidental check-in. To fix one by hand: `UPDATE tickets SET used_at = NULL WHERE id = '<uuid>'`.
