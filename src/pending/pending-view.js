import { waiterTranslate } from '../shared/waiter-ui.js';
import { modalCardStyle } from '../shared/ModalFrame.js';

const money = value => Math.round(value).toLocaleString('en-US') + ' den';

export function pendingRowsView(state, owner) {
  const t = (key, values) => owner.t(key, values);
  const pending = state.items.filter(item => item.tableId === state.tableId && item.status === 'pending');
  const count = pending.reduce((sum, item) => sum + item.qty, 0);
  return { hasPending: pending.length > 0, pendingCount: t(count === 1 ? '{count} item' : '{count} items', {count}), pending: pending.map(item => ({
    name: item.name, mods: item.mods, hasMods: !!item.mods, note: item.note, hasNote: !!item.note, qty: String(item.qty), amount: money(item.qty * item.unit),
    inc: () => owner.incItem(item.id), dec: () => owner.decItem(item.id), remove: () => owner.removeItem(item.id), editNote: () => owner.openNote(item.id),
    noteLabel: item.note ? t('Edit note') : t('Note'), decAria: t('One less {name}', {name:item.name}), incAria: t('One more {name}', {name:item.name}), removeAria: t('Remove {name}', {name:item.name})
  })) };
}

export function pendingDialogView(md, M, d, owner) {
  const ty = md?.type, t = (key, values) => owner.t(key, values);
  const v = { t, isMods: ty === 'mods', isNote: ty === 'note', modGroups: [], noteChips: [], closeModal: () => owner.dismiss(), modalTitle: '', modalSub: '', modalCardStyle: modalCardStyle() };
    const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
    const chip = on => 'min-height:60px; border-radius:16px; padding:10px 14px; font-size:17px; font-weight:800; text-align:center; ' + (on ? 'background:#0F172A; color:#FFFFFF; border:2px solid #0F172A' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1');


    if (ty === 'mods') {
      const p = M.byId[md.pid]; let d = 0, ok = true;
      v.modalTitle = p.name; v.modalSub = t('Pick the options from the paper order. Base price {price}.', {price: money(p.price)});
      v.modGroups = p.groups.map(gid => {
        const g = M.G[gid]; const sel = md.sel[gid];
        if (g.req && sel == null) ok = false;
        if (sel != null) d += g.opts[sel][1];
        return {
          label: g.label, reqLabel: g.req ? t("Required") : t("Optional"),
          reqStyle: 'height:26px; padding:0 10px; border-radius:999px; display:inline-flex; align-items:center; font-size:13px; font-weight:800; ' + (g.req ? (sel == null ? 'background:#FEE2E2; color:#991B1B' : 'background:#DCFCE7; color:#14532D') : 'background:#F1F5F9; color:#475569'),
          options: g.opts.map(([l, dd], k) => {
            const on = sel === k;
            return {
              label: l, price: dd ? (dd > 0 ? '+' : '') + money(dd) : t("Included"), pressed: String(on), disabled: !!md.saving,
              style: 'min-height:84px; border-radius:16px; padding:12px; display:flex; flex-direction:column; align-items:flex-start; justify-content:space-between; gap:6px; text-align:left; ' + (on ? 'background:#2563EB; color:#FFFFFF; border:2px solid #2563EB' : 'background:#F8FAFC; color:#0F172A; border:2px solid #CBD5E1'),
              pick: () => owner.chooseModifier(gid, k)
            };
          })
        };
      });
      v.modAddDisabled = !ok || !!md.saving;
      v.modAddLabel = md.saving ? t("Saving…") : ok ? t('Add to order · {price}', {price: money(p.price + d)}) : t("Pick the required options first");
      v.modAddStyle = bigBtn(ok && !md.saving, '#16A34A', '#FFFFFF');
      v.modAdd = () => owner.modAdd();
    }

    if (ty === 'note') {
      const it = d.items.find(i => i.id === md.itemId);
      v.modalTitle = t('Note for {name}', {name: it ? it.name : ''});
      v.modalSub = md.error || (owner.bridge ? t('Save a note for this item. Leave blank to remove it.') : t('This prints on the kitchen or bar ticket.'));
      v.noteText = md.text; v.noteSaving = !!md.saving;
      const parts = md.text.split(',').map(x => x.trim()).filter(Boolean);
      v.noteChips = ['No onions', 'Less salt', 'Extra spicy', 'Sauce on the side', 'No ice', 'Bring first', 'For sharing', 'Kids portion'].map(l => {
        const note = t(l);
        const variants = [waiterTranslate('en', 'waiter.' + l), waiterTranslate('sq', 'waiter.' + l)];
        const on = parts.some(part => variants.includes(part));
        return {
          label: note, pressed: String(on), style: chip(on),
          toggle: () => owner.toggleNoteChip(l)
        };
      });
      v.onNoteText = e => owner.setNoteText(e.target.value);
      v.saveNote = () => owner.saveNote();
    }

  return v;
}
