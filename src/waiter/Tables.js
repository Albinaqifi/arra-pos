import { desktopBridge } from '../shared/desktop-bridge.js';

export function renderTables(v, style) {
  const h = React.createElement, tr = v.t;
  if (!v.isTables) return null;
  return h('main', { style:style('flex:1; min-height:0; overflow:auto; padding:24px; box-sizing:border-box') },
    h('div', { style:style('max-width:1360px; margin:0 auto; display:flex; flex-direction:column; gap:26px') },
      h('div', { style:style('display:flex; align-items:center; gap:14px; flex-wrap:wrap') },
        h('h1', { style:style('margin:0; font-size:34px; font-weight:800; flex:1') }, tr('Tables')),
        desktopBridge && v.canAdmin ? h('button', { className:'admin-entry', onClick:v.openAdmin }, tr('Administration →')) : null,
        h('span', { style:style('padding:10px 16px; border-radius:999px; background:#FFFFFF; border:2px solid #E2E8F0; font-weight:800') }, v.freeCount),
        h('span', { style:style('padding:10px 16px; border-radius:999px; background:#FFEDD5; border:2px solid #F97316; font-weight:800') }, v.takenCount)),
      v.handoffNotice ? h('p', { role:'status', style:style('margin:0; padding:16px; border-radius:12px; background:#FEF3C7; color:#78350F; font-weight:700') }, v.handoffNotice) : null,
      v.entryMessage ? h('p', { role:'status', style:style('margin:0; padding:16px; border-radius:12px; background:#FEE2E2; color:#991B1B; font-weight:700') }, v.entryMessage) : null,
      v.tableMessage ? h('p', { role:'status' }, v.tableMessage) : null,
      (v.sections || []).map(sec => h('section', { key:sec.label, style:style('display:flex; flex-direction:column; gap:12px') },
        h('h2', { style:style('margin:0; font-size:16px; font-weight:800; color:#475569; text-transform:uppercase') }, sec.label),
        h('div', { style:style('display:grid; grid-template-columns:repeat(auto-fill,minmax(172px,1fr)); gap:14px') },
          sec.tables.map(t => h('button', { key:t.num, onClick:t.open, 'aria-label':t.aria, style:style(t.style) },
            h('div', { style:style('display:flex; justify-content:space-between; width:100%; gap:8px') },
              h('span', { style:style('font-size:44px; font-weight:800; line-height:1') }, t.num),
              t.taken && !t.entry ? h('span', { style:style('font-size:14px; font-weight:800') }, t.mins) : null),
            t.taken ? t.entry ? h('div', { style:style('font-size:20px; font-weight:800') }, tr('Taken')) : h('div', null,
              h('div', { style:style('font-size:22px; font-weight:800') }, t.total), h('div', { style:style('font-size:15px; font-weight:700') }, t.waiter + ' · ' + t.count)) :
              h('div', { style:style('font-size:20px; font-weight:800; color:#15803D') }, tr('Free')),
            !t.entry && t.hasUnsent ? h('span', { style:style('color:#B91C1C; font-weight:800') }, t.unsent) : null,
            !t.entry && t.hasIssue ? h('span', { style:style('background:#DC2626; color:#FFFFFF; font-weight:800') }, tr('Ticket not printed')) : null)))))));
}
