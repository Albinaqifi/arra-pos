import { waiterTranslate } from '../shared/waiter-ui.js';

export function tableView(snapshot, { language, desktop, failedTables = [], canAdmin = false, openAdmin, openTable, now = Date.now() }) {
  const t = (key, values) => waiterTranslate(language, 'waiter.' + key, values);
  const money = value => Math.round(value).toLocaleString('en-US') + ' den';
  const bq = item => item.qty - item.cxQty;
  const v = { t, isTables: snapshot.screen === 'tables', canAdmin, openAdmin };
  const tTotal = tid => snapshot.items.filter(i => i.tableId === tid).reduce((a, i) => a + bq(i) * i.unit, 0);
  let free = 0, taken = 0;
  v.tableMessage = snapshot.tableLoad === 'loading' ? t("Loading tables…") :
    snapshot.tableLoad === 'error' ? t("Tables unavailable. Restart the app and try again.") :
    snapshot.sections.length === 0 ? t("No tables available. Set up sample tables to get started.") : '';
  v.sections = snapshot.sections.map(sec => ({
    label: sec.label,
    tables: sec.ids.map(id => {
      const o = snapshot.orders[id]; const tk = !!o && !o.untouched; if (tk) taken++; else free++;
      const figuresKnown = !desktop || !tk || !!o.itemsLoaded;
      const its = snapshot.items.filter(i => i.tableId === id);
      const unsent = its.filter(i => i.status === 'pending').reduce((a, i) => a + i.qty, 0);
      const cnt = its.reduce((a, i) => a + bq(i), 0);
      const issue = failedTables.includes(id);
      const mins = tk ? Math.max(0, Math.round((now - o.openedAt) / 60000)) : 0;
      return {
        num: String(id), taken: tk, free: !tk, total: figuresKnown ? money(tTotal(id)) : '—', waiter: tk ? o.openedBy : '',
        count: figuresKnown ? t(cnt === 1 ? '{count} item' : '{count} items', {count: cnt}) : t("Open to view items"), mins: mins + ' min',
        hasUnsent: figuresKnown && unsent > 0, unsent: t('{count} not sent', {count: unsent}), hasIssue: issue,
        aria: tk ? (figuresKnown ? t('Table {id}, taken, {total}', {id, total:money(tTotal(id))}) : t('Table {id}, taken, open to view items', {id})) : t('Table {id}, free', {id}),
        style: 'min-height:156px; border-radius:22px; padding:16px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:10px; text-align:left; ' + (tk ? 'background:#F97316; color:#1A0B00; border:2px solid #EA580C; box-shadow:0 10px 22px rgba(249,115,22,0.28)' : 'background:#FFFFFF; color:#0F172A; border:2px solid #E2E8F0; box-shadow:0 4px 12px rgba(15,23,42,0.04)'),
        open: () => openTable(id)
      };
    })
  }));
  v.freeCount = t('{count} free', {count: free}); v.takenCount = t('{count} taken', {count: taken});

  return v;
}
