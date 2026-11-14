import { modalCardStyle } from '../shared/ModalFrame.js';

export function moveView(dialog, orders, owner) {
  if (!dialog) return null;
  const t = (key, values) => owner.t(key, values), from = dialog.target.tableId;
  const bigBtn = (on, bg, fg) => 'height:72px; border-radius:18px; border:none; font-size:21px; font-weight:800; ' + (on ? 'background:' + bg + '; color:' + fg + '; box-shadow:0 10px 22px rgba(15,23,42,0.18)' : 'background:#E2E8F0; color:#475569');
  return {
    t, isMoveTable: true, modalTitle: t('Move the whole table'),
    modalSub: dialog.error || t('Everything on Table {id} moves to the table you pick. Table {id} becomes free. Only free tables can be picked, so no order gets overwritten.', { id: from }),
    modalCardStyle: modalCardStyle(), closeModal: () => owner.dismiss(),
    mtTables: orders.sections.flatMap(section => section.ids).filter(id => id !== from).map(id => {
      const taken = !!orders.orders[id] && !orders.orders[id].untouched, selected = dialog.dest === id;
      return {
        num: String(id), sub: taken ? t('Taken') : t('Free'), disabled: taken,
        aria: t(taken ? 'Table {id}, taken, not available' : 'Table {id}, free', { id }),
        style: 'min-height:84px; border-radius:16px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; ' + (taken ? 'background:#F1F5F9; color:#64748B; border:2px dashed #CBD5E1' : (selected ? 'background:#7C3AED; color:#FFFFFF; border:2px solid #7C3AED' : 'background:#FFFFFF; color:#0F172A; border:2px solid #CBD5E1')),
        pick: () => owner.chooseDestination(id),
      };
    }),
    mtDisabled: dialog.dest == null || !!dialog.saving,
    mtLabel: dialog.dest != null ? t('Move everything to Table {id}', { id: dialog.dest }) : t('Pick a free table'),
    mtStyle: bigBtn(dialog.dest != null, '#7C3AED', '#FFFFFF'), mtConfirm: () => owner.confirm(),
  };
}
