// node server.js   — serves the scanner and records check-ins in tickets.db
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_FILE || 'tickets.db');
try { db.exec('ALTER TABLE tickets ADD COLUMN used_at TEXT'); } catch {}  // batches minted before check-in existed

const page = readFileSync('scanner.html');

// one UPDATE decides it: only the first scan of a pass changes a row, so two
// gates hitting the same ticket at once can never both get an entry
const claim = db.prepare('UPDATE tickets SET used_at = ? WHERE id = ? AND used_at IS NULL');
const find = db.prepare('SELECT seq, batch, used_at FROM tickets WHERE id = ?');

createServer((req, res) => {
  const json = (code, o) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o));

  if (req.method === 'GET' && req.url === '/')
    return res.writeHead(200, { 'content-type': 'text/html' }).end(page);

  if (req.method === 'GET' && req.url === '/stats') {
    const s = db.prepare('SELECT COUNT(*) total, COUNT(used_at) inside FROM tickets').get();
    return json(200, s);
  }

  if (req.method === 'POST' && req.url === '/scan') {
    let body = '';
    req.on('data', (c) => (body += c).length > 1e4 && req.destroy());
    return req.on('end', () => {
      let id;
      try { id = String(JSON.parse(body).id || '').trim(); } catch { return json(400, { status: 'bad', reason: 'Bad request' }); }
      const t = find.get(id);
      if (!t) return json(200, { status: 'bad', reason: 'Not a valid pass' });
      if (claim.run(new Date().toISOString(), id).changes === 0)
        return json(200, { status: 'bad', reason: `Already entered at ${t.used_at.slice(11, 16)} UTC` });
      return json(200, { status: 'ok', label: `${t.batch} #${String(t.seq).padStart(4, '0')}` });
    });
  }

  json(404, { error: 'Not found' });
}).listen(process.env.PORT || 8080, () => console.log(`scanner on :${process.env.PORT || 8080}`));
