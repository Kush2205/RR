// node generate.js
// Mints every category's passes into tickets.db and writes one PDF, 3 tickets per A4 page.
// Each category starts on a fresh page with its own serial run from #0001.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';

const CATEGORIES = [
  { name: 'individual', count: 1500, bg: '#7d0112' },
  { name: 'couple',     count: 1000, bg: '#770110' },
  { name: 'family',     count: 1000, bg: '#820210' },
];

// Measured on the cropped artwork (art/*.png, 1678 x 698 px). Same layout on all three.
const AW = 1678, AH = 698;
const QR = { x: 1189.5, y: 218, side: 216 };               // inside the white card, clear of its rounded corners
const SERIAL = { x: 1496, y: 288, w: 146, h: 56, size: 46 }; // covers the printed "#0001" in the art

const db = new DatabaseSync(process.env.DB_FILE || 'tickets.db');
db.exec('CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, batch TEXT, seq INTEGER, used_at TEXT)');
const insert = db.prepare('INSERT INTO tickets (id, batch, seq) VALUES (?, ?, ?)');

const pdfPath = process.env.PDF_FILE || 'out/tickets.pdf';
const doc = new PDFDocument({ size: 'A4', margin: 24, autoFirstPage: false });
doc.pipe(createWriteStream(pdfPath));

const M = 24, W = 595.28 - M * 2, H = (W * AH) / AW, GAP = 12, k = W / AW;
const counts = process.env.COUNTS?.split(',').map(Number); // test hook: shrink the batch

for (const [ci, cat] of CATEGORIES.entries()) {
  const n = counts ? counts[ci] : cat.count;
  const art = doc.openImage(`art/${cat.name}.png`); // embedded once, reused on every page

  db.exec('BEGIN');
  for (let i = 0; i < n; i++) {
    const id = randomUUID(), seq = i + 1;
    insert.run(id, cat.name, seq);

    if (i % 3 === 0) doc.addPage();
    const x = M, y = M + (i % 3) * (H + GAP);
    doc.image(art, x, y, { width: W, height: H });

    const png = await QRCode.toBuffer(id, { width: 320, margin: 4 });
    doc.image(png, x + QR.x * k, y + QR.y * k, { width: QR.side * k, height: QR.side * k });

    doc.rect(x + SERIAL.x * k, y + SERIAL.y * k, SERIAL.w * k, SERIAL.h * k).fill(cat.bg);
    doc.font('Times-Bold').fontSize(SERIAL.size * k).fillColor('#fdf0e6')
       .text(`#${String(seq).padStart(4, '0')}`, x + SERIAL.x * k, y + (SERIAL.y + 6) * k,
             { width: SERIAL.w * k, align: 'center', lineBreak: false });
  }
  db.exec('COMMIT');
  console.log(`${cat.name}: ${n}`);
}
doc.end();

const total = db.prepare('SELECT COUNT(*) c FROM tickets').get().c;
console.log(`-> ${pdfPath}\ndb holds ${total} passes — copy tickets.db to the EC2 box`);
