import { historyReportsText } from './history-reports-i18n.js';
const h = React.createElement;
const date = value => new Date(value).toLocaleString();
const itemRefs = ids => (ids || []).map(id => '#' + id).join(', ');
export function describeEvent(e, language = 'en') {
 const t = (key, values) => historyReportsText(language, key, values);
 switch (e.action) {
 case 'open': return t('Opened at table {table}.',{table:e.tableId});
 case 'add': return t('Added {quantity} × {name} (item #{id}).',{quantity:e.quantity,name:e.name,id:e.entityId});
 case 'quantity_changed': return t('Changed {name} (item #{id}) from {before} to {after}.',{name:e.name,id:e.entityId,before:e.beforeQuantity,after:e.afterQuantity});
 case 'remove': return t('Removed {name} (item #{id}); quantity {before} to {after}.',{name:e.name,id:e.entityId,before:e.beforeQuantity,after:e.afterQuantity});
 case 'note_changed': return t('Updated the note for item #{id}. Note text is private.',{id:e.entityId});
 case 'send': return t('Sent round {number} for preparation: items {items}.',{number:e.number,items:itemRefs(e.itemIds)});
 case 'move': return t('Moved the order from table {source} to table {destination}.',{source:e.sourceId,destination:e.destinationId});
 case 'move_items': return t('Moved items {items} from table {source} to table {destination} (order #{order}).',{items:itemRefs(e.itemIds),source:e.sourceId,destination:e.destinationId,order:e.destinationOrderId});
 case 'cancel_order': return t('Cancelled order. Reason: {reason}. Affected items: {items}.',{reason:e.reason,items:e.items.map(i => `${i.quantity} × ${i.name} (#${i.id}, ${t(i.status)})`).join(', ')});
 case 'correct_sent': return t('Corrected {quantity} of item #{id}. Reason: {reason}.',{quantity:e.quantity,id:e.entityId,reason:e.reason});
 case 'print_attempt': return t(e.adapter === 'windows' ? 'Windows {destination} print attempt for round {number}: {result}.' : 'Simulated {destination} print attempt for round {number}: {result}.',{destination:t(e.destination),number:e.number,result:t(e.result)});
 case 'cancellation_print_attempt': return t(e.adapter === 'windows' ? 'Windows {destination} cancellation for round {number}: {result}.' : 'Simulated {destination} cancellation for round {number}: {result}.',{destination:t(e.destination),number:e.number,result:t(e.result)});
 default: return t('Activity recorded.');
 }
}
function localDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  const date = new Date(0); date.setFullYear(y,m-1,d);
  return date.getFullYear() === y && date.getMonth() === m-1 && date.getDate() === d;
}
function OrderList({ orders, open, t, title = 'All orders' }) {
  return h('section', {className:'history-panel'},
    h('div', {className:'history-section-head'}, h('div', null, h('p',{className:'admin-eyebrow'},t('ORDERS')),h('h2',null,title)),h('span',null,t('{count} recorded',{count:orders.length}))),
    orders.length ? h('ul',{className:'history-list'},orders.map(o=>h('li',{key:o.id},h('button',{className:'history-order',onClick:()=>open(o.id)},
      h('span',null,h('strong',null,t('Order #{id}',{id:o.id})),h('small',null,t('Table {id} · Opened {date}',{id:o.tableId,date:date(o.openedAt)}))),h('span',{className:'history-badge'},t(o.status)),h('span',{'aria-hidden':true},'→'))))) : h('p',{className:'floor-empty'},t('No orders match this selection.')));
}
function OrderDetail({ data, open, t, language }) {
  const {order,items,events}=data;
  return h(React.Fragment,null,
    h('section',{className:'history-panel history-summary'},h('p',{className:'admin-eyebrow'},t('ORDER DETAILS')),h('h2',null,t('Order #{id}',{id:order.id})),h('div',{className:'history-meta'},h('strong',null,t('Table {id}',{id:order.tableId})),h('span',{className:'history-badge'},t(order.status)),h('span',null,t('Opened {date}',{date:date(order.openedAt)})))),
    h('section',{className:'history-panel'},h('div',{className:'history-section-head'},h('div',null,h('p',{className:'admin-eyebrow'},t('CURRENT ORDER')),h('h2',null,t('Current items'))),h('span',null,t('{count} lines',{count:items.length}))),
      items.length ? h('ul',{className:'history-items'},items.map(i=>h('li',{key:i.id},h('span',null,h('strong',null,i.name),h('small',null,t('Item #{id} · {status}',{id:i.id,status:t(i.status)}))),h('span',{className:'history-quantity'},h('strong',null,t('{count} remaining',{count:order.status === 'cancelled' ? 0 : i.quantity-(i.correctedQuantity||0)})),h('small',null,t('{original} original · {corrected} corrected',{original:i.quantity,corrected:i.correctedQuantity||0})))))) : h('p',{className:'floor-empty'},t('No current items.'))),
    h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},t('OLDEST FIRST')),h('h2',null,t('Activity timeline')),h('p',{className:'history-muted'},t('Item history can include activity from other orders after a move.')),
      events.length ? h('ol',{className:'history-timeline'},events.map(e=>h('li',{key:e.id},h('div',null,h('strong',null,describeEvent(e,language)),h('small',null,date(e.occurredAt)+' · '+e.actor),e.orderId!==order.id && h('button',{onClick:()=>open(e.orderId)},t('View order #{id}',{id:e.orderId})))))) : h('p',{className:'floor-empty'},t('No activity recorded.'))));
}
export class OrderHistory extends React.Component {
  constructor(props) { super(props); this.state={orders:[],data:null,error:'',loading:true,tab:'table',tableId:null,from:'',to:'',period:null,dateError:''}; this.sequence=0; this.target=null; }
  componentDidMount() { this.load(null); }
  componentWillUnmount() { this.sequence++; }
  async load(id) {
    this.target=id;
    const sequence=++this.sequence; this.setState({loading:true,error:'',data:null});
    try {
      const r=await window.arra.orderHistory(id); if(sequence!==this.sequence) return;
      if(!r.ok) return this.setState({loading:false,error:'History unavailable. Check your access and try again.',...(id===null ? {orders:[]} : {})});
      this.setState(id===null ? {orders:r.data.orders,data:null,loading:false} : {data:r.data,loading:false});
    } catch (_) { if(sequence===this.sequence) this.setState({loading:false,error:'Could not load order history. Please try again.',...(id===null ? {orders:[]} : {})}); }
  }
  applyDates() {
    const {from,to}=this.state;
    if (!validDate(from) || (to && !validDate(to)) || (to && to < from)) return this.setState({dateError:'Choose a valid start date and an end date on or after it.'});
    this.setState({period:{from,to:to || from},dateError:'',tableId:null});
  }
  render() {
    const {data,error,loading,orders,tab,tableId,from,to,period,dateError}=this.state;
    const language=this.props.language || 'en';
    const t=(key,values)=>historyReportsText(language,key,values);
    const matching=orders.filter(o=>!period || (localDate(o.openedAt)>=period.from && localDate(o.openedAt)<=period.to));
    const tableOrders=matching.filter(o=>o.tableId===tableId);
    const tables=[...new Set(matching.map(o=>o.tableId))].sort((a,b)=>a-b);
    const back=()=>{ if (this.target===null && !data) return; this.sequence++; this.target=null; this.setState({data:null,error:'',loading:false}); };
    return h('main',null,h('button',{onClick:this.props.onBack},t('← Back to administration')),h('p',{className:'admin-eyebrow floor-eyebrow'},t('ADMINISTRATION / ORDER HISTORY')),h('h1',null,t('Order history')),h('p',{className:'admin-intro'},t('Review operational activity across orders and moves.')),h('p',{className:'admin-access-note'},t('Prices, payments and note text are excluded. Owner history is limited to permitted accounts, including connected orders after item moves.')),
      h('section',{className:'history-panel'},h('h2',null,t('Opening date')),h('p',null,t('Orders are selected by their opening date in the local calendar.')),h('label',null,t('From'), ' ',h('input',{type:'date',value:from,onChange:e=>this.setState({from:e.target.value})})), ' ',h('label',null,t('Through (optional)'), ' ',h('input',{type:'date',value:to,onChange:e=>this.setState({to:e.target.value})})), ' ',h('button',{onClick:()=>this.applyDates()},t('Apply dates')), ' ',h('button',{onClick:()=>this.setState({from:'',to:'',period:null,dateError:'',tableId:null})},t('All dates')),h('p',null,period ? t('Opening dates: {from} through {to}',period) : t('Showing all opening dates.')),dateError && h('p',{role:'alert'},t(dateError))),
      h('div',{className:'history-panel','aria-label':t('History view')},h('button',{'aria-pressed':tab==='table',onClick:()=>{back();this.setState({tab:'table'})}},t('By table')), ' ',h('button',{'aria-pressed':tab==='all',onClick:()=>{back();this.setState({tab:'all'})}},t('All orders'))),
      (data || this.target!==null) && h('button',{onClick:back},tab==='table' && tableId!==null ? t('← Back to table {id}',{id:tableId}) : t('← Back to results')),
      loading ? h('p',{role:'status',className:'admin-status'},t('Loading order history…')) : error ? h('div',null,h('p',{role:'alert'},t(error)),h('button',{onClick:()=>this.load(this.target)},t('Try again'))) : data ? OrderDetail({data,open:id=>this.load(id),t,language}) : tab==='all' ? OrderList({orders:matching,open:id=>this.load(id),t,title:t('All orders')}) : tableId!==null ? h(React.Fragment,null,h('button',{onClick:()=>this.setState({tableId:null})},t('← All tables')),OrderList({orders:tableOrders,open:id=>this.load(id),t,title:t('Table {id}',{id:tableId})})) : h('section',{className:'history-panel'},h('h2',null,t('By table')),tables.length ? h('ul',{className:'history-list'},tables.map(id=>h('li',{key:id},h('button',{className:'history-order',onClick:()=>this.setState({tableId:id})},t('Table {id}',{id}), ' · ',t('{count} recorded',{count:matching.filter(o=>o.tableId===id).length}))))) : h('p',{className:'floor-empty'},t('No orders match this selection.'))));
  }
}
