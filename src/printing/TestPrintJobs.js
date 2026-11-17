import { waiterTranslate, printDestination } from '../shared/waiter-ui.js';
import { PrintJobs } from './PrintJobs.js';

export class TestPrintJobs extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: null, error: '', busy: props.printing.testBusy };
    this.loadGeneration = 0;
  }
  componentDidMount() {
    this.disposed = false;
    this.stopRevision = this.props.printing.subscribeRevision(() => this.load());
    this.stopActivity = this.props.printing.subscribeActivity(() => {
      const busy = this.props.printing.testBusy;
      if (busy === this.state.busy) return;
      this.setState({ busy });
      if (!busy && !this.changing) this.load();
    });
    this.load();
  }
  componentWillUnmount() {
    this.disposed = true;
    this.loadGeneration++;
    this.stopRevision?.();
    this.stopActivity?.();
  }
  async load() {
    const generation = ++this.loadGeneration;
    const r = await this.props.printing.listTestJobs();
    if (this.disposed || generation !== this.loadGeneration) return;
    if (r.disabled) this.setState({ disabled: true });
    else if (r.ok) this.setState({ data: r.data, error: '', disabled: false });
    else this.setState({ error: waiterTranslate(this.props.language, 'waiter.Test print status unavailable. Displayed jobs may be stale; check the printer and refresh.') });
  }
  async change(command) {
    if (this.disposed || this.props.printing.testBusy) return;
    const generation = ++this.loadGeneration;
    this.changing = true;
    this.setState({ busy: true, error: '' });
    const r = await command();
    this.changing = false;
    if (this.disposed) return;
    this.setState({ busy: this.props.printing.testBusy });
    if (generation !== this.loadGeneration) return;
    if (r.ok) this.setState({ data: r.data, error: '', disabled: false });
    else this.setState({ error: waiterTranslate(this.props.language, 'waiter.Unable to change test printing. Check permission and output before trying again.') });
  }
  retry(jobId) {
    if (!window.confirm(waiterTranslate(this.props.language, 'waiter.Have you checked the printer and paper? Retrying may print a duplicate.'))) return;
    return this.change(() => this.props.printing.retryTestJob(jobId, true));
  }
  retryNotice(jobId) {
    if (!window.confirm(waiterTranslate(this.props.language, 'waiter.Have you checked the printer and paper? Retrying may print a duplicate.'))) return;
    return this.change(() => this.props.printing.retryNotice(jobId, true));
  }
  render() {
    const h = React.createElement, d = this.state.data;
    if (this.state.disabled || (!d && !this.state.error)) return null;
    return h('section', { style: { padding: 12, background: '#fff7ed' } }, h(PrintJobs, { admin: true, printing: this.props.printing, language: this.props.language }), h('strong', null, waiterTranslate(this.props?.language, 'waiter.TEST MODE: Windows printer queues')),
      h('p', null, waiterTranslate(this.props?.language, 'waiter.Queue acceptance does not confirm paper. Inspect the printer and paper before retrying.')),
      this.state.error && h('p', { role: 'alert' }, this.state.error),
      (d?.queues || []).map(q => h('div', { key: q.destination }, h('label', null, waiterTranslate(this.props?.language, 'waiter.{destination} queue', {destination:printDestination(this.props?.language, q.destination)}) + ' ', h('input', { defaultValue: q.queue, id: 'test-queue-' + q.destination, maxLength: 255 })), h('button', { disabled: this.state.busy, onClick: () => this.change(() => this.props.printing.configureQueue(q.destination, document.getElementById('test-queue-' + q.destination).value)) }, waiterTranslate(this.props?.language, 'waiter.Save queue')))),
      (d?.queues || []).filter(q=>q.destination !== 'bill').map(q=>h('div',{key:'alert-'+q.destination}, h('span',null, waiterTranslate(this.props.language,'waiter.{destination} cancellation sound: {mode}',{destination:printDestination(this.props.language,q.destination),mode:waiterTranslate(this.props.language,q.beep ? 'waiter.Three beeps requested' : 'waiter.No sound requested')})), ' ', h('button',{disabled:this.state.busy,onClick:()=>this.change(()=>this.props.printing.configureAlert(q.destination,!q.beep))},waiterTranslate(this.props.language,q.beep ? 'waiter.Disable sound' : 'waiter.Enable compatible printer sound')))),
      h('p', null, waiterTranslate(this.props?.language, 'waiter.Enable sound only for a printer confirmed to support ESC B. Sound is not confirmed by Windows.')),
      h('p', null, waiterTranslate(this.props?.language, 'waiter.Changing queues requires employee management permission.')),
      h('button', { disabled: this.state.busy, onClick: () => this.load() }, waiterTranslate(this.props?.language, 'waiter.Refresh test jobs')),
      h('p', null, waiterTranslate(this.props.language, 'waiter.Cancellation alerts: tell preparation staff in person. Windows acceptance does not confirm paper, sound or staff awareness.')),
      (d?.notices || []).map(j => h('div', {key:'notice-'+j.id}, waiterTranslate(this.props.language, 'waiter.CANCELLATION · {destination} · Table {table} · Round {round} · {quantity} × {name} · {status} · {attempts} attempt(s)', {destination:printDestination(this.props.language,j.destination),table:j.tableId,round:j.round,quantity:j.lines[0].quantity,name:j.lines[0].name,status:waiterTranslate(this.props.language,'waiter.'+j.result),attempts:j.attempts}), ' ', waiterTranslate(this.props.language,j.destination === 'unknown' ? 'waiter.Original destination unknown; tell preparation staff in person.' : j.beep ? 'waiter.Three beeps requested; sound unconfirmed.' : 'waiter.No sound requested.'), ' ', j.destination !== 'unknown' && h('button', {disabled:this.state.busy,onClick:()=>this.retryNotice(j.id)}, waiterTranslate(this.props.language,'waiter.Retry after checking')))),
      (d?.jobs || []).map(j => h('div', { key: j.id }, waiterTranslate(this.props?.language, j.ticketId ? 'waiter.{destination} job #{id} · Table {table} · Round {round} · {attempts} attempt(s) · {queue} · ' : 'waiter.{destination} job #{id} · Bill #{bill} · {attempts} attempt(s) · {queue} · ', {destination:printDestination(this.props?.language, j.destination),id:j.id,table:j.tableId,round:j.round,bill:j.billId,attempts:j.attempts,queue:j.queue}) + (j.cancelled ? waiterTranslate(this.props?.language, 'waiter.A ticket contains a cancelled item: do not retry. Earlier output may still arrive; tell preparation staff in person.') : j.result === 'accepted' ? waiterTranslate(this.props?.language, 'waiter.Accepted by Windows; check paper') : j.result === 'failed' ? waiterTranslate(this.props?.language, 'waiter.Queue missing') : waiterTranslate(this.props?.language, 'waiter.Output uncertain; check paper')),
        !j.cancelled && h('button', { disabled: this.state.busy, onClick: () => this.retry(j.id) }, waiterTranslate(this.props?.language, 'waiter.Retry after checking')))));
  }
}
