import { style } from './waiter-ui.js';

export function modalCardStyle(width = '760px') {
  return 'background:#FFFFFF; border-radius:26px; width:100%; max-width:' + width + '; max-height:calc(100vh - 40px); overflow:auto; padding:26px; box-sizing:border-box; display:flex; flex-direction:column; gap:20px; box-shadow:0 30px 80px rgba(15,23,42,0.35)';
}

export function ModalFrame({ title, subtitle, cardStyle, onClose, closeLabel, children }) {
  return React.createElement(React.Fragment, null, '\n',
    React.createElement('div', { style: style('position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; z-index: 50') }, '\n  ',
      React.createElement('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: style(cardStyle || modalCardStyle()) }, '\n\n    ',
        React.createElement('div', { style: style('display: flex; align-items: flex-start; gap: 12px') }, '\n      ',
          React.createElement('div', { style: style('flex: 1; min-width: 0') }, '\n        ',
            React.createElement('div', { style: style('font-size: 28px; font-weight: 800; line-height: 1.15') }, title), '\n        ',
            React.createElement('div', { style: style('font-size: 17px; font-weight: 600; color: #475569; margin-top: 4px; line-height: 1.4') }, subtitle), '\n      '), '\n      ',
          React.createElement('button', { onClick: onClose, 'aria-label': closeLabel, style: style('width: 52px; height: 52px; flex: none; border-radius: 14px; border: none; background: #F1F5F9; color: #0F172A; display: flex; align-items: center; justify-content: center') },
            React.createElement('svg', { width: '24', height: '24', viewbox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.6', strokeLinecap: 'round', 'aria-hidden': 'true' }, React.createElement('path', { d: 'M18 6L6 18M6 6l12 12' }))), '\n    '),
        children, '\n  '), '\n'), '\n');
}
