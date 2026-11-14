import { style } from '../shared/waiter-ui.js';
import { ModalFrame } from '../shared/ModalFrame.js';
import { renderMoveTable } from '../waiter/MoveTable.js';

export function renderMoveDialog(view) {
  return ModalFrame({ title: view.modalTitle, subtitle: view.modalSub, cardStyle: view.modalCardStyle, onClose: view.closeModal, closeLabel: view.t('Close'), children: renderMoveTable(view, style) });
}
