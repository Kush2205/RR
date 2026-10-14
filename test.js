// node test.js — mints a batch, then exercises the gate rules against a live server
import { execFileSync, spawn } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';

const DB = '/tmp/ticketer-test.db', PORT = 8099;
rmSync(DB, { force: true });
const PDF = '/tmp/ticketer-test.pdf';
execFileSync('node', ['generate.js'], { env: { ...process.env, DB_FILE: DB, PDF_FILE: PDF, COUNTS: '1,1,1' } });
assert.ok(statSync(PDF).size > 10000, 'pdf has content');

const rows = new DatabaseSync(DB).prepare('SELECT id, batch, seq FROM tickets').all();
const ids = rows.map((r) => r.id);
assert.equal(ids.length, 3);
assert.ok(rows.every((r) => r.seq === 1), 'each category serial starts at #0001');
assert.match(ids[0], /^[0-9a-f-]{36}$/); // unguessable v4 uuid

const srv = spawn('node', ['server.js'], { env: { ...process.env, DB_FILE: DB, PORT }, stdio: 'ignore' });
const scan = (id) => fetch(`http://localhost:${PORT}/scan`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
}).then((r) => r.json());

try {
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await scan(ids[0])).status, 'ok');
  assert.equal((await scan(ids[0])).status, 'bad');            // no second entry on one pass
  assert.equal((await scan('made-up-id')).status, 'bad');      // forged pass refused

  // two gates hitting the same fresh pass at once: exactly one gets in
  const both = await Promise.all([scan(ids[1]), scan(ids[1])]);
  assert.equal(both.filter((r) => r.status === 'ok').length, 1, 'race let in twice');

  const s = await fetch(`http://localhost:${PORT}/stats`).then((r) => r.json());
  assert.deepEqual(s, { total: 3, inside: 2 });
} finally {
  srv.kill();
}
rmSync(PDF, { force: true });
rmSync(DB, { force: true });
console.log('ok');
