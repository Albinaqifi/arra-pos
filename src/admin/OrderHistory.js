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
 case 'correct_sent': return t('Corrected {quantity} of item #{id}. Reason: {reason}.',{quantity:e.quantity,id:e.entityId,reason:e.reason});
 case 'print_attempt': return t('Simulated {destination} print attempt for round {number}: {result}.',{destination:t(e.destination),number:e.number,result:t(e.result)});
 default: return t('Activity recorded.');
 }
}
function OrderList({ orders, open, t }) {
  return h('section', {className:'history-panel'},
    h('div', {className:'history-section-head'}, h('div', null, h('p',{className:'admin-eyebrow'},t('ORDERS')),h('h2',null,t('All orders'))),h('span',null,t('{count} recorded',{count:orders.length}))),
    orders.length ? h('ul',{className:'history-list'},orders.map(o=>h('li',{key:o.id},h('button',{className:'history-order',onClick:()=>open(o.id)},
      h('span',null,h('strong',null,t('Order #{id}',{id:o.id})),h('small',null,t('Table {id} · Opened {date}',{id:o.tableId,date:date(o.openedAt)}))),h('span',{className:'history-badge'},t(o.status)),h('span',{'aria-hidden':true},'→'))))) : h('p',{className:'floor-empty'},t('No orders recorded.')));
}
function OrderDetail({ data, open, t, language }) {
  const {order,items,events}=data;
  return h(React.Fragment,null,
    h('section',{className:'history-panel history-summary'},h('p',{className:'admin-eyebrow'},t('ORDER DETAILS')),h('h2',null,t('Order #{id}',{id:order.id})),h('div',{className:'history-meta'},h('strong',null,t('Table {id}',{id:order.tableId})),h('span',{className:'history-badge'},t(order.status)),h('span',null,t('Opened {date}',{date:date(order.openedAt)})))),
    h('section',{className:'history-panel'},h('div',{className:'history-section-head'},h('div',null,h('p',{className:'admin-eyebrow'},t('CURRENT ORDER')),h('h2',null,t('Current items'))),h('span',null,t('{count} lines',{count:items.length}))),
      items.length ? h('ul',{className:'history-items'},items.map(i=>h('li',{key:i.id},h('span',null,h('strong',null,i.name),h('small',null,t('Item #{id} · {status}',{id:i.id,status:t(i.status)}))),h('span',{className:'history-quantity'},h('strong',null,t('{count} remaining',{count:i.quantity-(i.correctedQuantity||0)})),h('small',null,t('{original} original · {corrected} corrected',{original:i.quantity,corrected:i.correctedQuantity||0})))))) : h('p',{className:'floor-empty'},t('No current items.'))),
    h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},t('OLDEST FIRST')),h('h2',null,t('Activity timeline')),h('p',{className:'history-muted'},t('Item history can include activity from other orders after a move.')),
      events.length ? h('ol',{className:'history-timeline'},events.map(e=>h('li',{key:e.id},h('div',null,h('strong',null,describeEvent(e,language)),h('small',null,date(e.occurredAt)+' · '+e.actor),e.orderId!==order.id && h('button',{onClick:()=>open(e.orderId)},t('View order #{id}',{id:e.orderId})))))) : h('p',{className:'floor-empty'},t('No activity recorded.'))));
}
export class OrderHistory extends React.Component {
  constructor(props) { super(props); this.state={orders:[],data:null,error:'',loading:true}; this.sequence=0; }
  componentDidMount() { this.load(null); }
  componentWillUnmount() { this.sequence++; }
  async load(id) {
    const sequence=++this.sequence; this.setState({loading:true,error:'',data:null});
    try {
      const r=await window.arra.orderHistory(id); if(sequence!==this.sequence) return;
      if(!r.ok) return this.setState({loading:false,error:'History unavailable. Check your access and try again.',orders:[]});
      this.setState(id===null ? {orders:r.data.orders,data:null,loading:false} : {data:r.data,loading:false});
    } catch (_) { if(sequence===this.sequence) this.setState({loading:false,orders:[],error:'Could not load order history. Please try again.'}); }
  }
  render() {
    const {data,error,loading}=this.state;
    const language=this.props.language || 'en';
    const t=(key,values)=>historyReportsText(language,key,values);
    return h('main',null,h('button',{onClick:this.props.onBack},t('← Back to administration')),h('p',{className:'admin-eyebrow floor-eyebrow'},t('ADMINISTRATION / ORDER HISTORY')),h('h1',null,t('Order history')),h('p',{className:'admin-intro'},t('Review operational activity across orders and moves.')),h('p',{className:'admin-access-note'},t('Prices, payments and note text are excluded. Owner history is limited to permitted accounts, including connected orders after item moves.')),
      data && h('button',{onClick:()=>this.load(null)},t('← All orders')),loading ? h('p',{role:'status',className:'admin-status'},t('Loading order history…')) : error ? h('div',null,h('p',{role:'alert'},t(error)),h('button',{onClick:()=>this.load(null)},t('Try again'))) : data ? OrderDetail({data,open:id=>this.load(id),t,language}) : OrderList({orders:this.state.orders,open:id=>this.load(id),t}));
  }
}
