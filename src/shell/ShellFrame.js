import { style } from '../shared/waiter-ui.js';

export function renderShellHeader(identity, clock) {
  const v = identity, t = identity.t;
  if (v.entry) return React.createElement('header', { style:style('min-height:72px; flex:none; display:flex; align-items:center; gap:12px; padding:10px 20px; background:#FFFFFF; border-bottom:1px solid #E2E8F0; flex-wrap:wrap') },
    React.createElement('button', { onClick:v.signOut, disabled:v.switching, style:style('height:44px; padding:0 16px; border:2px solid #CBD5E1; border-radius:12px; background:#FFFFFF; font-weight:700') }, t('Sign out restaurant')),
    v.recoveryRequired && React.createElement('button', { onClick:v.retryClear, disabled:v.switching, style:style('height:44px; padding:0 16px; border:0; border-radius:12px; background:#B45309; color:#FFFFFF; font-weight:700') }, t('Retry clearing session')),
    React.createElement('div', { style:style('flex:1') }), React.createElement('span', { style:style('font-weight:700; color:#475569') }, clock),
    React.createElement('div', { style:style('font-size:20px; font-weight:800') }, 'Arra POS'),
    React.createElement('button', { onClick:v.manager, disabled:v.switching || v.recoveryRequired, style:style('height:44px; padding:0 18px; border:0; border-radius:12px; background:#0F172A; color:#FFFFFF; font-weight:800') }, t('Manager')));
  return React.createElement("header", {"style": style("min-height: 72px; flex: none; display: flex; align-items: center; gap: 14px; padding: 10px 20px; box-sizing: border-box; background: #FFFFFF; border-bottom: 1px solid #E2E8F0; flex-wrap: wrap")} , "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px")} , "\n    ", React.createElement("div", {"style": style("width: 42px; height: 42px; border-radius: 13px; background: #F97316; color: #1A0B00; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 22px")} , "A"), "\n    ", React.createElement("div", {"style": style("font-weight: 800; font-size: 20px")} , "Arra"), "\n  "), "\n  ", React.createElement("div", {"style": style("flex: 1")}), "\n  ", React.createElement("div", {"style": style("font-size: 20px; font-weight: 800; color: #334155; padding: 0 6px")} , clock), "\n  ", React.createElement("div", {"style": style("display: flex; align-items: center; gap: 10px; padding: 4px 4px 4px 4px; border-radius: 999px; background: #F1F5F9")} , "\n    ", React.createElement("div", {"style": style(v.waiterAv)} , v.waiterInitial), "\n    ", React.createElement("div", {"style": style("font-size: 17px; font-weight: 800; padding-right: 4px")} , v.waiterName), "\n    ", React.createElement("button", {"onClick": v.switchWaiter, "style": style("height: 44px; padding: 0 16px; border-radius: 999px; border: none; background: #0F172A; color: #FFFFFF; font-size: 15px; font-weight: 800")} , t("Switch waiter")), "\n  "), "\n");
}

export function renderShellFrame({ desktopBill, account, header, printing, content, dialogs, toast }) {
  return React.createElement(React.Fragment, null, desktopBill, '\n',
    React.createElement('div', { style: style("height: 100vh; min-height: 0; display: flex; flex-direction: column; background: #F4F6FB; color: #0F172A; font-family: 'Figtree', system-ui, sans-serif; overflow: hidden") },
      account, header, printing, content, dialogs,
      toast.hasToast ? React.createElement('div', { role: 'status', style: style(toast.toastStyle) }, toast.toastText) : null));
}
