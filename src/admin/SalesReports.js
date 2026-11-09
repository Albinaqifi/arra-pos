export class SalesReports extends React.Component {
  constructor(props) { super(props); this.state = { days:[], period:'date', dayId:'', from:'', to:'', account:'', method:'', data:null, error:'', busy:false }; }
  async componentDidMount() {
    const r = await window.arra.financialVisibility({action:'reportDays'});
    this.setState(r.ok ? {days:r.data} : {error:'Business days unavailable.'});
  }
  async load(e) {
    e.preventDefault();
    let from = null, to = null, dayId = null;
    if (this.state.period === 'day') {
      dayId = Number(this.state.dayId);
      if (!Number.isSafeInteger(dayId) || dayId <= 0) return this.setState({data:null,error:'Choose a business day.'});
    } else {
      from = new Date(this.state.from + 'T00:00:00').getTime();
      const end = new Date(this.state.to + 'T00:00:00'); end.setDate(end.getDate() + 1); to = end.getTime();
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || from >= to) return this.setState({data:null,error:'Choose a valid date range.'});
    }
    this.setState({busy:true,data:null,error:''});
    const r = await window.arra.financialVisibility({action:'report',from,to,dayId,account:this.state.account || null,method:this.state.method || null});
    this.setState(r.ok ? {busy:false,data:r.data,error:''} : {busy:false,data:null,error:'Report unavailable or account outside your scope.'});
  }
  render() {
    const h=React.createElement, s=this.state;
    const select = (name, options) => h('select', {value:s[name],disabled:s.busy,onChange:e=>this.setState({[name]:e.target.value,data:null})}, options.map(([value,label])=>h('option',{key:value,value},label)));
    return h('section', null, h('h2',null,'Sales and payment report'),
      h('p',null,'Provisional: recorded payments by payment date or assigned business day, effective account and method. Amounts are in minor units. Corrections below relate to the selected payments and do not add sales. Accounting definitions are not final.'),
      h('form',{onSubmit:e=>this.load(e)},
        h('label',null,'Period ',select('period',[['date','Payment date'],['day','Business day']])), ' ',
        s.period === 'date' ? h(React.Fragment,null,h('label',null,'From ',h('input',{type:'date',value:s.from,disabled:s.busy,onChange:e=>this.setState({from:e.target.value,data:null})})), ' ',h('label',null,'Through ',h('input',{type:'date',value:s.to,disabled:s.busy,onChange:e=>this.setState({to:e.target.value,data:null})}))) : h('label',null,'Business day ',select('dayId',[['','Choose'],...s.days.map(d=>[String(d.id),'#'+d.id+' · '+new Date(d.openedAt).toLocaleString()+(d.closedAt===null?' · open':' · closed')])])), ' ',
        h('label',null,'Account ',select('account',[['','Allowed scope'],['A','A'],['B','B']])), ' ',h('label',null,'Method ',select('method',[['','All'],['cash','Cash'],['card','Card']])), ' ',h('button',{disabled:s.busy},'Show sales report')),
      s.error && h('p',{role:'alert'},s.error), s.data && h(React.Fragment,null,
        h('h3',null,'Sales by effective account and method'),s.data.groups.length ? h('ul',null,s.data.groups.map(g=>h('li',{key:g.account+g.method},g.account+' · '+g.method+' · '+g.count+' payments · '+g.total))) : h('p',null,'No payments in this selection.'),
        h('h3',null,'Payment records'),s.data.records.length ? h('ul',null,s.data.records.map(p=>h('li',{key:p.id},'Payment #'+p.id+' · Bill #'+p.billId+' · Day #'+p.dayId+' · '+new Date(p.paidAt).toLocaleString()+' · '+p.account+' · '+p.method+' · '+p.amount))) : h('p',null,'No payment records.'),
        h('h3',null,'Account corrections'),s.data.corrections.length ? h('ul',null,s.data.corrections.map(c=>h('li',{key:c.id},'Correction #'+c.id+' · Payment #'+c.paymentId+' · B to A · '+c.amount+' · Actor #'+c.actorId+' · '+new Date(c.occurredAt).toLocaleString()+' · Reason: '+(c.reason || 'none')))) : h('p',null,'No corrections for selected payments.')));
  }
}
