'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { isCommissioned } = require('../../src/desktop/pf700-commissioning');
const { registerSession } = require('../../src/desktop/session');
const { registerLanguage } = require('../../src/desktop/language');
const { registerApplicationInfo } = require('../../src/desktop/application-info');
const { registerTables } = require('../../src/desktop/tables');
const { registerOrders } = require('../../src/desktop/orders');
const { registerMenu } = require('../../src/desktop/menu');
const { registerOrderItems } = require('../../src/desktop/order-items');
const { registerBills } = require('../../src/desktop/bills');
const { registerPayments } = require('../../src/desktop/payments');

// Only kit 1.0.10's existing enrolled database. Neither connection can create
// a missing file. This recovery package never runs setup or the v50 migrator.
function openIncidentProfile(appData) {
  if (!path.isAbsolute(appData)) throw Error('Missing Windows profile');
  const directory = path.join(fs.realpathSync.native(appData), 'Arra POS PF700 Commissioning');
  const file = path.join(directory, 'arra.sqlite');
  if (fs.realpathSync.native(file).toLowerCase() !== file.toLowerCase() ||
      !fs.lstatSync(file).isFile() || fs.existsSync(path.join(directory, 'SAMPLE-DATA-ONLY'))) {
    throw Error('Original commissioning database required');
  }
  const uri = pathToFileURL(file);
  uri.search = 'mode=ro';
  const reader = new DatabaseSync(uri.href, {readOnly:true, allowExtension:false});
  let writer;
  try {
    if (reader.prepare('PRAGMA user_version').get().user_version !== 53 || !isCommissioned(reader)) {
      throw Error('Commissioning database from kit 1.0.10 required');
    }
    const bill = reader.prepare(`SELECT b.order_id AS orderId, o.table_id AS tableId
      FROM bills b JOIN orders o ON o.id=b.order_id WHERE b.id=2 AND b.total=150`).get();
    if (!bill) throw Error('Incident bill unavailable');
    uri.search = 'mode=rw';
    writer = new DatabaseSync(uri.href, {allowExtension:false, enableForeignKeyConstraints:true});
    for (const db of [reader, writer]) db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF');
    return {reader, writer, bill, close() { writer.close(); reader.close(); }};
  } catch (error) {
    writer?.close();
    reader.close();
    throw error;
  }
}

function registerRecoveryServices(ipc, allowedSender, profile, journalRecovery) {
  if (typeof journalRecovery !== 'function') throw Error('Original journal verification is required');
  const { reader, writer, bill } = profile;
  // Navigation and review have a physically read-only connection. Expose only
  // this order in both table grids. Ordinary ownership and PIN checks still run.
  const permitted = new Map([
    ['arra:sign-in', () => true], ['arra:sign-out', () => true],
    ['arra:admin-access', () => true], ['arra:identify-staff', r => r?.kind === 'waiter'],
    ['arra:clear-waiter', () => true], ['arra:entry-tables', () => true],
    ['arra:application-info', () => true], ['arra:language', r => r?.action === 'get'],
    ['arra:tables', () => true], ['arra:menu', () => true],
    ['arra:open-order', r => r?.tableId === bill.tableId],
    ['arra:order-items', r => r?.orderId === bill.orderId && r.action === 'list'],
    ['arra:bill', r => r?.orderId === bill.orderId && r.action === 'review'],
    ['arra:payment', r => r?.billId === 2 && r.method === 'cash' && r.account === 'A' &&
      r.acknowledgedDocument === '0000030' && Object.keys(r).length === 4]
  ]);
  const limited = { handle(channel, handler) {
    const permit = permitted.get(channel);
    if (!permit) return;
    ipc.handle(channel, (event, request) => {
      if (!allowedSender(event) || !permit(request)) return {ok:false, error:'Access denied'};
      const result = handler(event, request);
      if (result?.ok && (channel === 'arra:tables' || channel === 'arra:entry-tables')) {
        return {...result, data:result.data.filter(row => row.id === bill.tableId)};
      }
      return result;
    });
  }};
  const session = registerSession(limited, allowedSender, reader);
  registerLanguage(limited, allowedSender, reader, session);
  registerApplicationInfo(limited, allowedSender);
  registerTables(limited, allowedSender, reader, session);
  registerOrders(limited, allowedSender, reader, session);
  registerMenu(limited, allowedSender, reader, session);
  registerOrderItems(limited, allowedSender, reader, session);
  registerBills(limited, allowedSender, reader, session, null, journalRecovery);
  registerPayments(limited, allowedSender, writer, session, null, null, journalRecovery);
  return session;
}

module.exports = { openIncidentProfile, registerRecoveryServices };
