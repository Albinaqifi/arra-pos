import { waiterTranslate } from '../shared/waiter-ui.js';

export function orderView(d, { language, now = Date.now(), desktop, onCorrect, selectTab, showTables, showHistory }) {
  const t = (key, values) => waiterTranslate(language, 'waiter.' + key, values);
  const money = value => Math.round(value).toLocaleString('en-US') + ' den';
  const hm = value => { const date = new Date(value); return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0'); };
  const bq = item => item.qty - item.cxQty;
  const v = { t, isOrder: d.screen === 'order', goTables: showTables, goHistory: showHistory };
  const tid = d.tableId; const o = tid ? d.orders[tid] : null;
  v.tableName = tid ? t('Table {id}', {id: tid}) : '';
  v.orderMeta = o ? t(o.openedBy ? 'Opened {time} by {name} · {minutes} min' : 'Opened {time} · {minutes} min', {time:hm(o.openedAt), name:o.openedBy, minutes:Math.max(0, Math.round((now - o.openedAt) / 60000))}) : t("Free. Add products to open it.");
  v.statusLabel = o ? t("Taken") : t("Free");
  v.statusStyle = 'height:36px; padding:0 14px; border-radius:999px; display:inline-flex; align-items:center; font-size:15px; font-weight:800; ' + (o ? 'background:#F97316; color:#1A0B00' : 'background:#DCFCE7; color:#14532D');

  const its = tid ? d.items.filter(i => i.tableId === tid) : [];
  const tb = on => 'flex:1; height:48px; border:none; border-bottom:4px solid ' + (on ? '#F97316' : 'transparent') + '; background:transparent; font-size:16px; font-weight:800; color:' + (on ? '#0F172A' : '#475569');
  v.tabOrder = d.tab === 'order'; v.tabAct = d.tab === 'activity';
  v.tabOrderSel = String(v.tabOrder); v.tabActSel = String(v.tabAct);
  v.tabOrderStyle = tb(v.tabOrder); v.tabActStyle = tb(v.tabAct);
  v.setTabOrder = () => selectTab('order');
  v.setTabAct = () => selectTab('activity');
  v.isEmpty = its.length === 0;
  const sent = its.filter(i => i.status !== 'pending');
  const byRound = {};
  sent.forEach(i => { (byRound[i.round] = byRound[i.round] || []).push(i); });
  v.rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a).map(r => {
    const L = byRound[r]; const first = L.reduce((a, i) => (i.sentAt < a.sentAt ? i : a), L[0]);
    return {
      title: t('Round {round}', {round: r}), meta: t('Sent {time} by {name}', {time: hm(first.sentAt), name: first.sentBy}),
      items: L.map(i => {
        const qq = bq(i); const all = qq === 0; const c = i.cx[i.cx.length - 1];
        return {
          name: i.name, mods: i.mods, hasMods: !!i.mods, note: i.note, hasNote: !!i.note,
          hasMoved: !!i.movedFrom, moved: t('From Table {id}', {id:i.movedFrom}),
          qtyLabel: (all ? i.qty : qq) + '×',
          qtyStyle: 'min-width:40px; height:36px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center; font-size:17px; font-weight:800; ' + (all ? 'background:#F1F5F9; color:#64748B; text-decoration:line-through' : 'background:#0F172A; color:#FFFFFF'),
          nameStyle: 'font-size:17px; font-weight:800; ' + (all ? 'text-decoration:line-through; color:#64748B' : 'color:#0F172A'),
          amount: all ? t('Cancelled') : money(qq * i.unit),
          amountStyle: 'font-size:17px; font-weight:800; white-space:nowrap; color:' + (all ? '#B91C1C' : '#0F172A'),
          routeLabel: i.route === 'bar' ? 'Bar' : t('Kitchen'),
          routeStyle: 'height:24px; padding:0 8px; border-radius:6px; display:inline-flex; align-items:center; font-size:12px; font-weight:800; ' + (i.route === 'bar' ? 'background:#DBEAFE; color:#1E40AF' : 'background:#FFEDD5; color:#9A3412'),
          hasCx: i.cxQty > 0,
          cxText: c ? t('{count} cancelled total · latest: {qty} · {reason} · {who} {time}', {count:i.cxQty, qty:c.qty, reason:['Customer changed mind', 'Entered by mistake', 'Kitchen can’t make it', 'Took too long', 'Other'].includes(c.reason) ? t(c.reason) : c.reason, who:c.who, time:hm(c.t)}) + (desktop ? '' : t(' · waiting for owner review')) : '',
          canCancel: qq > 0, cancel: () => onCorrect(i.id), cancelAria: t('Cancel {name}', {name: i.name})
        };
      })
    };
  });
  const total = its.reduce((a, i) => a + bq(i) * i.unit, 0);
  v.total = money(total);
  v.activity = o ? o.log.slice().reverse().map(e => ({ time: hm(e.t), who: e.who, text: e.text })) : [];
  v.noActivity = v.activity.length === 0;

  return v;
}
