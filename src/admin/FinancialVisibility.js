import { SalesReports } from './SalesReports.js';
import { BusinessDays } from './BusinessDays.js';
import { PaymentLists, FinancialDetail } from './FinancialDetails.js';
export class FinancialVisibility extends React.Component {
  constructor(props) { super(props); this.state={records:[],unpaid:null,totals:null,detail:null,error:'',loading:true,dayRevision:0}; this.sequence=0; }
  componentDidMount() { this.load(); }
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
    const h=React.createElement,s=this.state;
    return h('main',null,h('button',{onClick:this.props.onBack},'← Back to administration'),h('p',{className:'admin-eyebrow floor-eyebrow'},'ADMINISTRATION / FINANCIAL INFORMATION'),h('h1',null,'Financial information'),h('p',{className:'admin-intro'},'Review recorded payments and business days available to your account.'),h('p',{className:'admin-access-note'},'Sample data only. Amounts are in minor units. Records and totals follow your financial scope; unclassified unpaid bills are available only to authorized combined users.'),
      h(BusinessDays,{onDaysChanged:()=>this.setState({dayRevision:s.dayRevision+1})}),
      h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},'YOUR AVAILABLE SCOPE'),h('h2',null,'Payment history'),h('p',{className:'history-muted'},'Totals count each recorded payment once, by its effective account.'),s.detail && h('button',{onClick:()=>this.load()},'← All payment history'),s.loading ? h('p',{role:'status'},'Loading financial information…') : s.error ? h('div',null,h('p',{role:'alert'},s.error),h('button',{onClick:()=>this.load()},'Reload history')) : !s.detail && s.totals && h('div',{className:'finance-metrics'},h('div',null,h('span',null,'Payments'),h('strong',null,s.totals.count)),h('div',null,h('span',null,'Total'),h('strong',null,s.totals.total)))),
      !s.loading && !s.error && (s.detail ? h(FinancialDetail,{data:s.detail}) : h(PaymentLists,{records:s.records,unpaid:s.unpaid,openPayment:id=>this.open('detail',id),openBill:id=>this.open('unpaidDetail',id)})),h('section',{className:'history-panel'},h(SalesReports,{key:s.dayRevision})));
  }
}
