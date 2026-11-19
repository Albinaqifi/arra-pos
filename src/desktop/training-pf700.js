// Separate, persistent device memory for the training printer. Daily reports
// can read and close these registers; only a completed simulated checkout adds a sale.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { encodeRequest } = require('./pf700-frame');
const { registerSimulatedPf700Sale, simulatedResponse } = require('./pf700-checkout-protocol');
const { createPf700DailyReportWithTransport } = require('./pf700-daily-report');

const serial = 'SYNTHETIC01';
const digits = (number, width) => String(number).padStart(width, '0');
const money = denars => '+' + digits(denars * 100, 11);
const taxFields = totals => [totals.taxA, 0, totals.taxV, 0].map(money);

function openMemory(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS documents (
      doc INTEGER PRIMARY KEY CHECK (doc BETWEEN 1 AND 9999999),
      bill INTEGER UNIQUE, z INTEGER UNIQUE, stamp TEXT,
      cash INTEGER NOT NULL, card INTEGER NOT NULL, taxA INTEGER NOT NULL, taxV INTEGER NOT NULL,
      CHECK ((bill IS NULL) != (z IS NULL))
    ) STRICT;
    INSERT OR IGNORE INTO documents VALUES (1,NULL,1,'010120',0,0,0,0);`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function recordSale(file, snapshot) {
  const cash = snapshot.method === 'cash' ? snapshot.total : 0;
  const card = snapshot.total - cash;
  const taxA = snapshot.lines.reduce((sum, line) =>
    sum + (line.taxGroup === 'А' ? line.unitPrice * line.quantity : 0), 0);
  const taxV = snapshot.total - taxA;
  const db = openMemory(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    const prior = db.prepare('SELECT * FROM documents WHERE bill=?').get(snapshot.billId);
    if (!prior) {
      db.prepare('INSERT INTO documents (bill,cash,card,taxA,taxV) VALUES (?,?,?,?,?)')
        .run(snapshot.billId, cash, card, taxA, taxV);
    } else if (prior.cash !== cash || prior.card !== card || prior.taxA !== taxA || prior.taxV !== taxV) {
      throw Error('Conflicting simulated receipt');
    }
    db.exec('COMMIT');
  } finally { db.close(); }
}

function openTrainingPipe(file, operation, now) {
  const db = openMemory(file);
  let issued = false;
  // A real serial handle is exclusive throughout the preflight and close.
  try { db.exec('BEGIN IMMEDIATE'); } catch (error) { db.close(); throw error; }
  return {
    exchange(request) {
      const cmd = request[3], seq = request[2];
      const input = { 90: '0', 74: 'X', 76: 'T', 62: '', 64: '', 65: '', 67: '', 110: '', 113: '', 69: '0' }[cmd];
      if (input === undefined || !encodeRequest({ sequence: seq, command: cmd, data: Buffer.from(input) }).equals(request)) {
        throw Error('Unknown training report request');
      }
      const prior = db.prepare('SELECT * FROM documents WHERE z IS NOT NULL ORDER BY doc DESC LIMIT 1').get();
      const totals = db.prepare(`SELECT count(*) AS receipts, coalesce(sum(cash),0) AS cash,
        coalesce(sum(card),0) AS card, coalesce(sum(taxA),0) AS taxA, coalesce(sum(taxV),0) AS taxV
        FROM documents WHERE doc>? AND bill IS NOT NULL`).get(prior.doc);
      const clock = now();
      const date = [digits(clock.getDate(), 2), digits(clock.getMonth() + 1, 2), digits(clock.getFullYear() % 100, 2)];
      let value;
      switch (cmd) {
        case 90: value = 'QA-700DEMOX,1.00MK 23OCT14 1230,BEEF,01001101,7,' + serial; break;
        case 74: value = ''; break; // simulatedResponse supplies the status bytes.
        case 76: value = '0,0000,+000000000,+000000000'; break;
        case 62: value = date.join('-') + ' ' + [clock.getHours(), clock.getMinutes(), clock.getSeconds()].map(n => digits(n, 2)).join(':'); break;
        case 64: value = [digits(prior.z, 4), ...taxFields(prior), prior.stamp].join(','); break;
        case 65: value = [money(totals.cash + totals.card), ...taxFields(totals)].join(','); break;
        case 67: value = [money(totals.cash + totals.card), money(0), digits(totals.receipts, 4), '0000'].join(','); break;
        case 110: value = [money(totals.cash), money(0), money(totals.card), money(0), digits(prior.z, 4), digits(totals.receipts + 1, 4)].join(','); break;
        case 113: value = digits(db.prepare('SELECT max(doc) AS doc FROM documents').get().doc, 7); break;
        case 69: {
          if (operation !== 'DailyReport' || issued || !totals.receipts || prior.stamp === date.join('')) {
            throw Error('Simulated fiscal period cannot close');
          }
          issued = true;
          const z = prior.z + 1;
          db.prepare('INSERT INTO documents (z,stamp,cash,card,taxA,taxV) VALUES (?,?,?,?,?,?)')
            .run(z, date.join(''), totals.cash, totals.card, totals.taxA, totals.taxV);
          db.exec('COMMIT'); // The device can finish even if Arra subsequently loses the reply.
          value = [digits(z, 4), money(0), ...taxFields(totals)].join(',');
          break;
        }
      }
      return simulatedResponse(seq, cmd, value, false);
    },
    close() { db.close(); }
  };
}

function createTrainingPf700(directory, now = () => new Date()) {
  const file = path.join(directory, 'simulated-pf700.sqlite');
  const reports = createPf700DailyReportWithTransport({ mode: 'simulation', expectedSerial: serial,
    openPipe: operation => openTrainingPipe(file, operation, now) });
  return Object.freeze({
    mode: 'simulation', requireOrigins: true,
    async registerSale(snapshot) {
      const result = await registerSimulatedPf700Sale(snapshot);
      if (result.status === 'accepted') recordSale(file, snapshot);
      return result;
    },
    dailyReport: Object.freeze({
      mode: 'simulation', issueDailyReport: reports.issueDailyReport, reconcileDailyReport: reports.reconcileDailyReport,
      simulatedDocumentNumber(billId) {
        if (!fs.existsSync(file)) return null;
        const db = new DatabaseSync(file, { readOnly: true });
        try {
          const row = db.prepare('SELECT doc FROM documents WHERE bill=?').get(billId);
          return row ? digits(row.doc, 7) : null;
        } finally { db.close(); }
      }
    })
  });
}

module.exports = { createTrainingPf700 };
