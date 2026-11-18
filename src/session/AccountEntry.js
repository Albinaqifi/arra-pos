import { style } from '../shared/waiter-ui.js';

export function renderAccountEntry(v) {
  const h = React.createElement, t = v.t;
  return h(React.Fragment, null,
    v.isLogin && h('div', { style: style('flex:1; display:flex; flex-wrap:wrap; min-height:0; overflow:auto') },
      h('div', { style: style('flex:1 1 420px; background:#F97316; color:#1A0B00; padding:56px; box-sizing:border-box') },
        h('div', { style: style('font-size:22px; font-weight:800') }, 'Arra POS'),
        h('div', { style: style('font-size:96px; font-weight:800; margin-top:80px') }, 'Arra'),
        h('p', { style: style('font-size:26px; font-weight:700') }, t('Paper order in. Kitchen and bar tickets out. Bill printed. Done.'))),
      h('div', { style: style('flex:1 1 420px; display:flex; align-items:center; justify-content:center; padding:48px 24px; box-sizing:border-box; background:#FFFFFF') },
        h('form', { onSubmit: e => { e.preventDefault(); v.login(); }, style: style('width:100%; max-width:420px; display:flex; flex-direction:column; gap:22px') },
          h('h1', { style: style('margin:0; font-size:34px; font-weight:800') }, t('Restaurant sign in')),
          h('p', { style: style('margin:0; font-size:18px; color:#475569') }, t('Sign in as the restaurant to choose a table, or use your owner account for administration.')),
          h('label', { style: style('display:flex; flex-direction:column; gap:8px; font-size:16px; font-weight:700') }, t('Username'), h('input', { value:v.user, onChange:v.onUser, autoComplete:'username', style:style('height:60px; border-radius:14px; border:2px solid #CBD5E1; padding:0 18px; font-size:20px') })),
          h('label', { style: style('display:flex; flex-direction:column; gap:8px; font-size:16px; font-weight:700') }, t('Password'), h('input', { type:'password', value:v.pass, onChange:v.onPass, autoComplete:'current-password', style:style('height:60px; border-radius:14px; border:2px solid #CBD5E1; padding:0 18px; font-size:20px') })),
          h('button', { type:'submit', style:style('height:68px; border-radius:16px; border:none; background:#2563EB; color:#FFFFFF; font-size:22px; font-weight:800') }, t('Sign in'))))),
    v.isPin && h('div', { role:'presentation', style:style('position:fixed; inset:0; z-index:100; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; padding:16px; overflow:auto') },
      h('form', { role:'dialog', 'aria-modal':'true', 'aria-labelledby':'entry-pin-title', onSubmit:e=>{e.preventDefault();v.submitPin();}, onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();v.pinBack();} else if(e.key==='Tab'){const controls=[...e.currentTarget.querySelectorAll('input:not(:disabled),button:not(:disabled)')]; if(controls.length && ((e.shiftKey && document.activeElement===controls[0]) || (!e.shiftKey && document.activeElement===controls[controls.length-1]))){e.preventDefault();(e.shiftKey ? controls[controls.length-1] : controls[0]).focus();}}}, style:style('width:100%; max-width:420px; max-height:95vh; overflow:auto; background:#FFFFFF; border-radius:24px; padding:24px; box-sizing:border-box; display:flex; flex-direction:column; gap:14px; box-shadow:0 20px 50px rgba(15,23,42,0.25)') },
        h('h2', { id:'entry-pin-title', style:style('margin:0; font-size:26px; text-align:center') }, v.pinTarget),
        h('label', { style:style('display:flex; flex-direction:column; gap:8px; font-weight:700') }, v.pinPrompt,
          h('input', { type:'password', inputMode:'numeric', autoComplete:'off', autoFocus:true, ref:input=>{if(input && v.waiterMessage && !v.switching) input.focus();}, value:v.pin, onChange:v.onPin, disabled:v.switching, 'aria-label':v.pinPrompt, style:style('height:52px; border-radius:12px; border:2px solid #94A3B8; padding:0 14px; font-size:24px') })),
        v.waiterMessage ? h('p', { role:'alert', style:style('margin:0; color:#B91C1C; font-weight:700') }, v.waiterMessage) : null,
        h('div', { style:style('display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px') }, v.keys.map(k=>h('button', { key:k.aria, type:'button', disabled:v.switching, onClick:k.press, 'aria-label':k.aria, style:style(k.style) }, k.label))),
        h('div', { style:style('display:flex; gap:10px') }, h('button', { type:'button', disabled:v.switching, onClick:v.pinBack, style:style('flex:1; height:50px; border:2px solid #CBD5E1; border-radius:12px; background:#FFFFFF; font-weight:700') }, t('Cancel')), v.pinIsManager && h('button', { type:'submit', disabled:v.switching, style:style('flex:1; height:50px; border:0; border-radius:12px; background:#2563EB; color:#FFFFFF; font-weight:800') }, t('Continue'))))));
}
