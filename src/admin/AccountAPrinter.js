import { financeText } from './finance-i18n.js';
export class AccountAPrinter extends React.Component {
  constructor(props) { super(props); this.state={busy:false,result:''}; this.busy=false; this.mounted=false; }
  componentDidMount() { this.mounted=true; }
  componentWillUnmount() { this.mounted=false; }
  async print() {
    if (this.busy) return;
    this.busy=true; this.setState({busy:true,result:''});
    let ok=false;
    try { ok=(await window.arra.businessDays({action:'accountAPrinterDailyControl'}))?.ok===true; } catch (_) {}
    this.busy=false;
    if (this.mounted) this.setState({busy:false,result:ok?'sent':'failed'});
  }
  render() {
    const h=React.createElement,t=key=>financeText(this.props.language,key),s=this.state;
    return h('div',{className:'fiscal-printer'},
      h('p',{className:'fiscal-device'},'Synergy PF700'),
      h('div',{className:'fiscal-switcher'},h('button',{type:'button','aria-pressed':true},t('Daily control'))),
      h('div',{className:'fiscal-desk'},
        h('section',{className:'fiscal-panel'},h('h2',null,t('Daily fiscal control')),
          h('p',{className:'fiscal-intro'},t('Print the figures registered so far. Service continues with the fiscal day open.')),
          h('div',{className:'fiscal-figure'},h('span',null,t('Expected Account A cash')),h('strong',null,t('See printed report'))),
          h('button',{type:'button',className:'fiscal-print',disabled:s.busy,onClick:()=>this.print()},t('Print daily fiscal control')),
          s.result && h('p',{role:s.result==='sent'?'status':'alert',className:'fiscal-result'},t(s.result==='sent'?'Daily control request sent.':'Could not confirm the print request. Check the printer.'))),
        h('aside',{className:'fiscal-tray','aria-label':t('Example paper')},h('div',{className:'fiscal-tray-title'},t('Example paper'),h('span',null,'PF700')),
          h('div',{className:'fiscal-paper',lang:'mk'},h('strong',null,'АРРА'),h('small',null,'ПРИМЕРОК'),h('p',null,'КОНТРОЛЕН ФИНАНСИСКИ ИЗВЕШТАЈ'),h('hr'),h('p',null,'КОНТРОЛНА СМЕТКА')),
          h('small',null,t('Illustrative excerpt · firmware determines the layout')))));
  }
}
