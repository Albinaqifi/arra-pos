import { financeText } from './finance-i18n.js';
import { SalesReports } from './SalesReports.js';
import { BusinessDays } from './BusinessDays.js';
import { PaymentLists, FinancialDetail } from './FinancialDetails.js';
export class FinancialVisibility extends React.Component {
  constructor(props) { super(props); this.state={view:null,records:[],unpaid:null,totals:null,detail:null,error:'',loading:false,dayRevision:0}; this.sequence=0; }
  componentWillUnmount() { this.sequence++; }
  async load() {
    const sequence=++this.sequence; this.setState({loading:true,error:'',detail:null,records:[],unpaid:null,totals:null});
    try {
      const [records,totals,unpaid]=await Promise.all([window.arra.financialVisibility({action:'search',account:null}),window.arra.financialVisibility({action:'aggregate',account:null}),window.arra.financialVisibility({action:'unpaid'})]);
      if(sequence!==this.sequence) return;
      if(!records.ok || !totals.ok || !unpaid.ok) return this.setState({loading:false,error:'Financial information unavailable.'});
      this.setState({records:records.data,totals:totals.data,unpaid:unpaid.data,loading:false});
    } catch (_) { if(sequence===this.sequence) this.setState({loading:false,error:'Could not load financial information. Please try again.'}); }
  }
  selectView(view) { this.sequence++; this.setState({view,detail:null,error:'',loading:false}); if(view==='history') this.load(); }
  detail(id) { return this.open('detail',id); }
  unpaidDetail(id) { return this.open('unpaidDetail',id); }
  async open(action,id) {
    const sequence=++this.sequence; this.setState({loading:true,error:'',detail:null});
    try {
      const r=await window.arra.financialVisibility(action==='detail'?{action,paymentId:id}:{action,billId:id});
      if(sequence!==this.sequence) return;
      this.setState(r.ok?{detail:r.data,loading:false}:{loading:false,error:'This record is unavailable or outside your access. Return to history and try again.'});
    } catch (_) { if(sequence===this.sequence) this.setState({loading:false,error:'Could not load this record. Return to history and try again.'}); }
  }
  render() {
    const h=React.createElement,s=this.state, t=key=>financeText(this.props.language,key);
    const options=[['today',t("Current day turnover"),t("See today’s payments and totals")],['reports',t("Previous days & reports"),t("Review a closed day or date range")],['history',t("Payment history"),t("Find payments and unpaid bills")],['close',t("Close current day"),t("Review outstanding orders before closing")]];
    const title=options.find(x=>x[0]===s.view)?.[1];
    return h('main',{className:'finance-home'},h('button',{className:'finance-back',onClick:s.view?()=>this.selectView(null):this.props.onBack},s.view?t("← Financial information"):t("← Back to administration")),
      h('p',{className:'admin-eyebrow floor-eyebrow'},t("ADMINISTRATION / FINANCIAL INFORMATION")),h('h1',null,title || t("Financial information")),
      !s.view ? h(React.Fragment,null,h('p',{className:'admin-intro'},t("Choose what you would like to review.")),h('div',{className:'finance-choices'},options.map(([id,label,description])=>h('button',{key:id,className:'finance-choice',onClick:()=>this.selectView(id)},h('span',{className:'finance-choice-icon','aria-hidden':true},id==='today'?'◷':id==='reports'?'▦':id==='history'?'≡':'✓'),h('span',{className:'finance-choice-copy'},h('strong',null,label),h('small',null,description)),h('span',{className:'finance-choice-arrow','aria-hidden':true},'→')))),h('p',{className:'finance-footnote'},t("Sample data · Non-fiscal, provisional reporting"))) : null,
      s.view==='today' && h(SalesReports,{language:this.props.language,key:'today-'+s.dayRevision,mode:'today'}),
      s.view==='reports' && h(SalesReports,{language:this.props.language,key:'reports-'+s.dayRevision,mode:'reports'}),
      s.view==='close' && h(BusinessDays,{language:this.props.language,onDaysChanged:()=>this.setState({dayRevision:this.state.dayRevision+1})}),
      s.view==='history' && h(React.Fragment,null,h('p',{className:'admin-intro'},t("Recorded payments available to your account.")),h('section',{className:'history-panel'},s.detail && h('button',{onClick:()=>this.load()},t("← All payment history")),s.loading ? h('p',{role:'status'},t("Loading financial information…")) : s.error ? h('div',null,h('p',{role:'alert'},t(s.error)),h('button',{onClick:()=>this.load()},t("Reload history"))) : !s.detail && s.totals && h('div',{className:'finance-metrics'},h('div',null,h('span',null,t("Payments")),h('strong',null,s.totals.count)),h('div',null,h('span',null,t("Total")),h('strong',null,s.totals.total)))),!s.loading && !s.error && (s.detail ? h(FinancialDetail,{language:this.props.language,data:s.detail}) : h(PaymentLists,{language:this.props.language,records:s.records,unpaid:s.unpaid,openPayment:id=>this.open('detail',id),openBill:id=>this.open('unpaidDetail',id)}))));
  }
}
