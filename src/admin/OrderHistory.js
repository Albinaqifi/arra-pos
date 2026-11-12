const h = React.createElement;
const date = value => new Date(value).toLocaleString();
const itemRefs = ids => (ids || []).map(id => '#' + id).join(', ');
export function describeEvent(e) {
  switch (e.action) {
    case 'open': return `Opened at table ${e.tableId}.`;
    case 'add': return `Added ${e.quantity} × ${e.name} (item #${e.entityId}).`;
    case 'quantity_changed': return `Changed ${e.name} (item #${e.entityId}) from ${e.beforeQuantity} to ${e.afterQuantity}.`;
    case 'remove': return `Removed ${e.name} (item #${e.entityId}); quantity ${e.beforeQuantity} to ${e.afterQuantity}.`;
    case 'note_changed': return `Updated the note for item #${e.entityId}. Note text is private.`;
    case 'send': return `Sent round ${e.number} for preparation: items ${itemRefs(e.itemIds)}.`;
    case 'move': return `Moved the order from table ${e.sourceId} to table ${e.destinationId}.`;
    case 'move_items': return `Moved items ${itemRefs(e.itemIds)} from table ${e.sourceId} to table ${e.destinationId} (order #${e.destinationOrderId}).`;
    case 'correct_sent': return `Corrected ${e.quantity} of item #${e.entityId}. Reason: ${e.reason}.`;
    case 'print_attempt': return `Simulated ${e.destination} print attempt for round ${e.number}: ${e.result}.`;
    default: return 'Activity recorded.';
  }
}
function OrderList({ orders, open }) {
  return h('section', {className:'history-panel'},
    h('div', {className:'history-section-head'}, h('div', null, h('p',{className:'admin-eyebrow'},'ORDERS'),h('h2',null,'All orders')),h('span',null,orders.length+' recorded')),
    orders.length ? h('ul',{className:'history-list'},orders.map(o=>h('li',{key:o.id},h('button',{className:'history-order',onClick:()=>open(o.id)},
      h('span',null,h('strong',null,'Order #'+o.id),h('small',null,'Table '+o.tableId+' · Opened '+date(o.openedAt))),h('span',{className:'history-badge'},o.status),h('span',{'aria-hidden':true},'→'))))) : h('p',{className:'floor-empty'},'No orders recorded.'));
}
function OrderDetail({ data, open }) {
  const {order,items,events}=data;
  return h(React.Fragment,null,
    h('section',{className:'history-panel history-summary'},h('p',{className:'admin-eyebrow'},'ORDER DETAILS'),h('h2',null,'Order #'+order.id),h('div',{className:'history-meta'},h('strong',null,'Table '+order.tableId),h('span',{className:'history-badge'},order.status),h('span',null,'Opened '+date(order.openedAt)))),
    h('section',{className:'history-panel'},h('div',{className:'history-section-head'},h('div',null,h('p',{className:'admin-eyebrow'},'CURRENT ORDER'),h('h2',null,'Current items')),h('span',null,items.length+' lines')),
      items.length ? h('ul',{className:'history-items'},items.map(i=>h('li',{key:i.id},h('span',null,h('strong',null,i.name),h('small',null,'Item #'+i.id+' · '+i.status)),h('span',{className:'history-quantity'},h('strong',null,(i.quantity-(i.correctedQuantity||0))+' remaining'),h('small',null,i.quantity+' original · '+(i.correctedQuantity||0)+' corrected'))))) : h('p',{className:'floor-empty'},'No current items.')),
    h('section',{className:'history-panel'},h('p',{className:'admin-eyebrow'},'OLDEST FIRST'),h('h2',null,'Activity timeline'),h('p',{className:'history-muted'},'Item history can include activity from other orders after a move.'),
      events.length ? h('ol',{className:'history-timeline'},events.map(e=>h('li',{key:e.id},h('div',null,h('strong',null,describeEvent(e)),h('small',null,date(e.occurredAt)+' · '+e.actor),e.orderId!==order.id && h('button',{onClick:()=>open(e.orderId)},'View order #'+e.orderId))))) : h('p',{className:'floor-empty'},'No activity recorded.')));
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
    return h('main',null,h('button',{onClick:this.props.onBack},'← Back to administration'),h('p',{className:'admin-eyebrow floor-eyebrow'},'ADMINISTRATION / ORDER HISTORY'),h('h1',null,'Order history'),h('p',{className:'admin-intro'},'Review operational activity across orders and moves.'),h('p',{className:'admin-access-note'},'Prices, payments and note text are excluded. Owner history is limited to permitted accounts, including connected orders after item moves.'),
      data && h('button',{onClick:()=>this.load(null)},'← All orders'),loading ? h('p',{role:'status',className:'admin-status'},'Loading order history…') : error ? h('div',null,h('p',{role:'alert'},error),h('button',{onClick:()=>this.load(null)},'Try again')) : data ? OrderDetail({data,open:id=>this.load(id)}) : OrderList({orders:this.state.orders,open:id=>this.load(id)}));
  }
}
