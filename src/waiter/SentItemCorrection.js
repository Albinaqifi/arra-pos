const h = React.createElement;
function focusable(dialog) {
  return [...dialog.querySelectorAll('button, input, select, textarea, [tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('fieldset:disabled'));
}
export function installCorrectionFocus(dialog, previous) {
  focusable(dialog)[0]?.focus();
  function onKeyDown(event) {
    if (event.key !== 'Tab') return;
    const available=focusable(dialog);
    if (!available.length) { event.preventDefault(); return; }
    const current=available.indexOf(document.activeElement);
    if (event.shiftKey && current<=0) { event.preventDefault(); available[available.length-1].focus(); }
    else if (!event.shiftKey && (current<0 || current===available.length-1)) { event.preventDefault(); available[0].focus(); }
  }
  function onFocusIn(event) { if (!dialog.contains(event.target)) focusable(dialog)[0]?.focus(); }
  document.addEventListener('keydown',onKeyDown,true); document.addEventListener('focusin',onFocusIn,true);
  return () => { document.removeEventListener('keydown',onKeyDown,true); document.removeEventListener('focusin',onFocusIn,true); if(previous && previous.isConnected) previous.focus(); };
}
export function SentItemCorrection({v,modal}) {
  const t = v.t;
  const [confirming,setConfirming]=React.useState(false), root=React.useRef(null);
  React.useEffect(()=>installCorrectionFocus(root.current.closest('[role="dialog"]'),document.activeElement),[]);
  React.useEffect(()=>{const dialog=root.current.closest('[role="dialog"]'); if(!dialog.contains(document.activeElement) || document.activeElement?.disabled) focusable(dialog)[0]?.focus();},[modal.saving,modal.unresolved]);
  const locked=!!modal.requestId, reason=modal.reason==='Other' ? modal.other.trim() : modal.reason;
  return h('div',{ref:root,className:'correction-flow'},
    h('div',{className:'correction-item'},h('strong',null,v.cxName),v.cxHasMods && h('span',null,v.cxMods),h('small',null,v.cxMeta)),
    h('div',{className:'correction-quantity'},h('strong',null,t("Quantity to correct")),h('div',null,h('button',{onClick:v.cxDec,disabled:locked||modal.qty<=1,'aria-label':t("Correct fewer")},'−'),h('span',null,v.cxQty+' '+v.cxMax),h('button',{onClick:v.cxInc,disabled:locked||!v.cxMulti||modal.qty>=v.cxMaxNumber,'aria-label':t("Correct more")},'+'))),
    h('fieldset',{className:'correction-reasons',disabled:locked},h('legend',null,t("Reason "),h('span',null,t("Required"))),h('div',null,v.cxReasons.map(r=>h('button',{type:'button',key:r.label,onClick:()=>{r.pick();setConfirming(false)},'aria-pressed':r.pressed},r.label))),v.cxIsOther && h('label',null,t("Write the reason"),h('input',{type:'text',value:v.cxOther,onChange:v.onCxOther,maxLength:500}))),
    h('p',{className:'correction-info'},v.cxInfo),modal.error && h('p',{role:'alert',className:'correction-error'},modal.error),confirming && !modal.unresolved && h('p',{className:'correction-confirm'},t('Confirm correction of {qty} × {name}. Reason: {reason}. The original sent item and correction remain in history.', {qty:v.cxQty, name:v.cxName, reason:v.cxReasonLabel})),
    h('div',{className:'correction-actions'},h('button',{onClick:confirming&&!locked ? ()=>setConfirming(false) : v.closeModal,disabled:modal.saving||modal.unresolved},confirming&&!locked ? t("Edit correction") : t("Keep item")),h('button',{className:'correction-primary',disabled:v.cxDisabled||modal.saving,onClick:()=>confirming||modal.unresolved ? v.cxConfirm() : setConfirming(true)},modal.saving ? t("Saving…") : modal.unresolved ? t("Retry correction") : confirming ? t("Confirm correction") : t("Review correction"))));
}
