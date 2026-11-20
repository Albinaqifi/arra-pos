import { financeText } from './finance-i18n.js';
import { AccountAPrinterCashMovement } from './AccountAPrinterCashMovement.js';

// Work with decimal text so validation and the printer limit do not depend on floating point.
function cashAmount(value, direction) {
  value = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction=''] = value.split('.');
  const amount = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
  if (!/[1-9]/.test(amount) || amount.length + (direction === 'out' ? 1 : 0) > 9) return null;
  return amount;
}

export class AccountAPrinter extends React.Component {
  constructor(props) { super(props); this.cashMovement=props.cashMovement || new AccountAPrinterCashMovement(); this.state={busy:false,cashBusy:this.cashMovement.busy,cashResult:this.cashMovement.result,cashMovement:this.cashMovement.movement,uncertainMovements:this.cashMovement.uncertainMovements,result:'',view:'daily',direction:'in',amount:'',review:false,error:false,range:'date',format:'short',fromDate:'',toDate:'',firstRecord:'',lastRecord:''}; this.busy=false; this.mounted=false; }
  componentDidMount() { this.mounted=true; const update=()=>this.setState({cashBusy:this.cashMovement.busy,cashResult:this.cashMovement.result,cashMovement:this.cashMovement.movement,uncertainMovements:this.cashMovement.uncertainMovements}); this.unsubscribe=this.cashMovement.subscribe(update); update(); }
  componentWillUnmount() { this.mounted=false; this.unsubscribe?.(); }
  async print() {
    if (this.busy || this.cashMovement.busy) return;
    this.busy=true; this.setState({busy:true,result:''});
    let ok=false;
    try { ok=(await window.arra.businessDays({action:'accountAPrinterDailyControl'}))?.ok===true; } catch (_) {}
    this.busy=false;
    if (this.mounted) this.setState({busy:false,result:ok?'sent':'failed'});
  }
  async printPeriodic() {
    if (this.busy || this.cashMovement.busy) return;
    const {range,format,fromDate,toDate,firstRecord,lastRecord}=this.state;
    this.busy=true; this.setState({busy:true,result:''});
    let ok=false;
    try { ok=(await window.arra.businessDays({action:'accountAPrinterPeriodicReport',range,format,
      start:range==='date'?fromDate:firstRecord,end:range==='date'?toDate:lastRecord}))?.ok===true; } catch (_) {}
    this.busy=false;
    if (this.mounted) this.setState({busy:false,result:ok?'periodicSent':'periodicFailed'});
  }
  reviewCash() {
    if (this.busy || this.cashMovement.busy) return;
    if (!cashAmount(this.state.amount,this.state.direction)) { this.setState({error:true,result:''}); return; }
    this.setState({review:true,error:false,result:''});
  }
  async confirmCash() {
    const {direction,amount,review}=this.state;
    const normalized=cashAmount(amount,direction);
    if (this.busy || this.cashMovement.busy || !review || !normalized) return;
    const pending=this.cashMovement.send(direction,normalized);
    this.setState({review:false,amount:''});
    await pending;
  }
  render() {
    const h=React.createElement,t=key=>financeText(this.props.language,key),s=this.state;
    const cash=s.view==='cash', periodic=s.view==='periodic';
    const messages={periodicSent:'Periodic report request sent.',periodicFailed:'Could not confirm the periodic report request. Check the range and printer.',sent:'Daily control request sent.',failed:'Could not confirm the print request. Check the printer.',accepted:'Cash movement request sent.',declined:'The printer declined this cash movement.',unknown:'The printer may already have recorded this cash movement. Check before entering it again.',not_sent:'Cash movement request was not sent.'};
    const outcome=cash?s.cashResult:(s.result||s.cashResult), busy=s.busy||s.cashBusy;
    const movementLabel=movement=>movement && h('span',null,' ',t(movement.direction==='in'?'Cash in:':'Cash out:'),' ',movement.amount,' MKD');
    const result=h(React.Fragment,null,
      outcome && outcome!=='unknown' ? h('p',{role:['sent','periodicSent','accepted'].includes(outcome)?'status':'alert',className:'fiscal-result'},t(messages[outcome]),['sent','failed','periodicSent','periodicFailed'].includes(outcome)?null:movementLabel(s.cashMovement))
        : s.cashBusy && h('p',{role:'status',className:'fiscal-result'},t('Cash movement request in progress.'),movementLabel(s.cashMovement)),
      s.uncertainMovements.map((movement,index)=>h('p',{key:index,role:'alert',className:'fiscal-result'},t(messages.unknown),movementLabel(movement))));
    return h('div',{className:'fiscal-printer'},
      h('p',{className:'fiscal-device'},'Synergy PF700'),
      h('div',{className:'fiscal-switcher',role:'group','aria-label':t('Printer actions')},
        h('button',{type:'button','aria-pressed':s.view==='daily',disabled:busy,onClick:()=>this.setState({view:'daily',result:'',review:false,error:false})},t('Daily control')),
        h('button',{type:'button','aria-pressed':cash,disabled:busy,onClick:()=>this.setState({view:'cash',result:'',review:false,error:false})},t('Cash in / out')),
        h('button',{type:'button','aria-pressed':periodic,disabled:busy,onClick:()=>this.setState({view:'periodic',result:'',review:false,error:false})},t('Periodic report'))),
      h('div',{className:'fiscal-desk'},
        cash ? h('section',{className:'fiscal-panel'},h('h2',null,t('Register cash in or out')),
          h('p',{className:'fiscal-intro'},t('Enter the amount you are adding to or taking from the Account A wallet.')),
          h('form',{onSubmit:e=>{e.preventDefault(); if(s.review) this.confirmCash(); else this.reviewCash();}},
            h('fieldset',{className:'fiscal-choice',disabled:busy||s.review},h('legend',null,t('Movement')),
              ...['in','out'].map(direction=>h('label',{key:direction},h('input',{type:'radio',name:'fiscal-direction',value:direction,checked:s.direction===direction,onChange:()=>this.setState({direction,error:false,result:''})}),t(direction==='in'?'Cash in':'Cash out')))),
            h('label',{className:'fiscal-field'},t('Amount (MKD)'),h('input',{type:'text',inputMode:'decimal',autoComplete:'off',value:s.amount,disabled:busy||s.review,onChange:e=>this.setState({amount:e.target.value,error:false,result:''})})),
            s.error && h('p',{role:'alert',className:'fiscal-result'},t('Enter a positive amount with up to two decimal places that fits the printer limit.')),
            s.review && h('p',{className:'fiscal-confirm'},t(s.direction==='in'?'Review cash in:':'Review cash out:'),' ',cashAmount(s.amount,s.direction),' MKD. ',t('Confirmation required.')),
            h('div',{className:'fiscal-actions'},h('button',{type:'submit',className:'fiscal-print',disabled:busy},t(s.review?(s.direction==='in'?'Confirm cash in and print':'Confirm cash out and print'):(s.direction==='in'?'Review cash in':'Review cash out'))),
              s.review && h('button',{type:'button',disabled:busy,onClick:()=>this.setState({review:false})},t('Cancel')))),result)
        : periodic ? h('section',{className:'fiscal-panel'},h('h2',null,t('Periodic fiscal report')),
          h('p',{className:'fiscal-intro'},t('Print turnover and tax totals from closed fiscal days.')),
          h('form',{onSubmit:e=>{e.preventDefault(); this.printPeriodic();}},
            h('fieldset',{className:'fiscal-choice',disabled:busy},h('legend',null,t('Select by')),
              ...['date','record'].map(range=>h('label',{key:range},h('input',{type:'radio',name:'fiscal-range',value:range,checked:s.range===range,onChange:()=>this.setState({range,result:''})}),t(range==='date'?'Date range':'Fiscal record numbers')))),
            h('div',{className:'fiscal-pair'},...(s.range==='date'?[['From date','fromDate'],['To date','toDate']]:[['First closure record','firstRecord'],['Last closure record','lastRecord']]).map(([label,key])=>
              h('label',{className:'fiscal-field',key},t(label),h('input',{type:s.range==='date'?'date':'text',inputMode:s.range==='record'?'numeric':undefined,maxLength:s.range==='record'?4:undefined,min:s.range==='date'?'2000-01-01':undefined,max:s.range==='date'?'2099-12-31':undefined,value:s[key],disabled:busy,onChange:e=>this.setState({[key]:e.target.value,result:''})})))),
            h('fieldset',{className:'fiscal-choice',disabled:busy},h('legend',null,t('Report format')),
              ...['short','detailed'].map(format=>h('label',{key:format},h('input',{type:'radio',name:'fiscal-format',value:format,checked:s.format===format,onChange:()=>this.setState({format,result:''})}),t(format==='short'?'Short totals':'Detailed by closure')))),
            h('p',{className:'fiscal-confirm'},t(s.range==='date'?'Date range':'Fiscal record numbers'),': ',(s.range==='date'?s.fromDate:s.firstRecord)||'—',' – ',(s.range==='date'?s.toDate:s.lastRecord)||'—',' · ',t(s.format==='short'?'Short totals':'Detailed by closure')),
            h('button',{type:'submit',className:'fiscal-print',disabled:busy},t('Print periodic fiscal report'))),result)
        : h('section',{className:'fiscal-panel'},h('h2',null,t('Daily fiscal control')),
          h('p',{className:'fiscal-intro'},t('Print the figures registered so far. Service continues with the fiscal day open.')),
          h('div',{className:'fiscal-figure'},h('span',null,t('Expected Account A cash')),h('strong',null,t('See printed report'))),
          h('button',{type:'button',className:'fiscal-print',disabled:busy,onClick:()=>this.print()},t('Print daily fiscal control')),result),
        h('aside',{className:'fiscal-tray','aria-label':t('Example paper')},h('div',{className:'fiscal-tray-title'},t('Example paper'),h('span',null,'PF700')),
          h('div',{className:'fiscal-paper',lang:'mk'},h('strong',null,'АРРА'),h('small',null,'ПРИМЕРОК'),cash ? null : h('p',null,'КОНТРОЛЕН ФИНАНСИСКИ ИЗВЕШТАЈ'),h('hr'),h('p',null,'КОНТРОЛНА СМЕТКА')),
          h('small',null,t('Illustrative excerpt · firmware determines the layout')))));
  }
}
