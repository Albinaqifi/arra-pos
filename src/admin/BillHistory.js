import { financeText } from './finance-i18n.js';
export class BillHistory extends React.Component {
  constructor(props) { super(props); this.state={from:'',to:'',range:null,page:0,records:[],hasMore:false,count:null,token:null,busy:false,error:'',notice:''}; this.sequence=0; }
  componentWillUnmount() { this.sequence++; }
  t(key,values) { return financeText(this.props.language,key,values); }
  edit(field,value) { this.sequence++; this.setState({[field]:value,range:null,records:[],count:null,error:'',notice:'',busy:false}); }
  async load(e,page=0,range=null) {
    if(e) e.preventDefault();
    const retained=!!range;
    if (!range) {
      const parse = value => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const date=new Date(value+'T00:00:00'); return Number.isFinite(date.getTime()) && date.getFullYear()===Number(value.slice(0,4)) && date.getMonth()+1===Number(value.slice(5,7)) && date.getDate()===Number(value.slice(8,10)) ? date : null; };
      const start=parse(this.state.from), end=parse(this.state.to);
      if (!start || !end || start > end) return this.setState({range:null,records:[],count:null,error:this.t('Choose a valid date range.')});
      end.setDate(end.getDate()+1); range={from:start.getTime(),to:end.getTime()};
    }
    const token=++this.sequence; this.setState({busy:true,error:'',notice:'',records:[],range:null});
    try {
      const result=await window.arra.billHistory({action:'page',...range,page,token:retained ? this.state.token : null});
      if(token!==this.sequence) return;
      if(!result.ok) return this.setState({busy:false,error:this.t('Bill history unavailable. Try again.')});
      this.setState({busy:false,range,page,records:result.data.records,hasMore:result.data.hasMore,count:{count:result.data.count,printBatch:result.data.printBatch},token:result.data.token});
    } catch (_) { if(token===this.sequence) this.setState({busy:false,error:this.t('Bill history unavailable. Try again.')}); }
  }
  async output(action) {
    const range=this.state.range; if(!range || this.state.busy) return;
    if (action==='print' && !window.confirm(this.t('Check the report printer and paper. Queue acceptance does not confirm printing. Continue?'))) return;
    const token=++this.sequence; this.setState({busy:true,error:'',notice:''});
    try {
      const r=await window.arra.billHistory({action,...range,language:this.props.language === 'sq' ? 'sq' : 'en'}); if(token!==this.sequence) return;
      if(r.cancelled) return this.setState({busy:false,notice:this.t('Export cancelled.')});
      if(r.resourceLimit) return this.setState({busy:false,error:this.t('This database is too large to safely prepare bill history on this device.')});
      if(!r.ok) return this.setState({busy:false,error:this.t(action==='print' ? 'Printing may be incomplete or its result unknown. Check all paper before trying again.' : 'Export failed. Try again.')});
      this.setState({busy:false,notice:action==='print' ? this.t('Sent {parts} parts to the printer queue. Check all paper; queue acceptance does not confirm printing.',{parts:r.parts}) : this.t('Export saved.')});
    } catch (_) { if(token===this.sequence) this.setState({busy:false,error:this.t(action==='print' ? 'Printing may be incomplete or its result unknown. Check all paper before trying again.' : 'Export failed. Try again.')}); }
  }
  render() {
    const h=React.createElement,s=this.state,t=(key,values)=>this.t(key,values), date=x=>new Date(x).toLocaleString(); let previous=null;
    return h('section',{className:'finance-report'},h('p',null,t('Paid bills by local payment date. Provisional and non-fiscal.')),
      h('form',{className:'report-form',onSubmit:e=>this.load(e)},...['from','to'].map(k=>h('label',{key:k},t(k==='from'?'From':'Through'),h('input',{type:'date',required:true,value:s[k],disabled:s.busy,onChange:e=>this.edit(k,e.target.value)}))),h('button',{className:'floor-primary',disabled:s.busy},t('Show bill history'))),
      s.busy && h('p',{role:'status'},t('Loading…')),s.error && h('p',{role:'alert'},s.error),s.notice && h('p',{role:'status'},s.notice),
      s.range && h(React.Fragment,null,h('p',null,t('{count} paid bills in this range.',{count:s.count.count})),h('p',null,t('Large reports print in multiple parts of up to {count} bills. Check every part on paper.',{count:s.count.printBatch})),
        h('button',{type:'button',disabled:s.busy,onClick:()=>this.output('print')},t('Print bill history')), ' ',h('button',{type:'button',disabled:s.busy,onClick:()=>this.output('export')},t('Export to Excel')),
        !s.records.length ? h('p',null,t('No paid bills in this range.')) : s.records.map(r=>{const heading=r.dayId!==previous;previous=r.dayId;return h('div',{key:r.id},heading && h('h3',null,t('Business day #{id}',{id:r.dayId}),r.closedAt===null?' · '+t('Open'):'',r.firstDay?' · '+t('Original day boundaries may be unavailable'):'',h('small',null,' · '+date(r.openedAt)+(r.closedAt===null?'':' – '+date(r.closedAt)))),h('p',null,date(r.paidAt),' · ',t('Bill #{id}',{id:r.billId}),' · ',t('Table {id}',{id:r.tableId}),' · ',t(r.method==='cash'?'Cash':'Card'),' · ',r.account,' · ',t('Amount (minor units)'),': ',r.amount.toLocaleString()));}),
        h('div',null,h('button',{type:'button',disabled:s.busy || s.page===0,onClick:()=>this.load(null,s.page-1,s.range)},t('Previous page')),' ',h('span',null,t('Page {page}',{page:s.page+1})),' ',h('button',{type:'button',disabled:s.busy || !s.hasMore,onClick:()=>this.load(null,s.page+1,s.range)},t('Next page')))));
  }
}
