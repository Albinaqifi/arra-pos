import { waiterTranslate, printDestination } from '../shared/waiter-ui.js';
import { QueueJobs } from './QueueJobs.js';

export class PrintJobs extends React.Component {
  constructor(props) {
    super(props);
    this.state = { jobs: [], printers: [], error: '', busy: props.printing.simulatedBusy };
    this.loadGeneration = 0;
  }
  componentDidMount() {
    this.disposed = false;
    this.stopRevision = this.props.printing.subscribeRevision(() => this.load());
    this.stopActivity = this.props.printing.subscribeActivity(() => {
      const busy = this.props.printing.simulatedBusy;
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
    const r = await this.props.printing.listJobs();
    if (this.disposed || generation !== this.loadGeneration) return;
    if (r.ok) this.setState({ ...r.data, error: '' });
    else this.setState({ error: waiterTranslate(this.props.language, 'waiter.Print jobs unavailable.') });
  }
  async change(command) {
    if (this.disposed || this.props.printing.simulatedBusy) return;
    const generation = ++this.loadGeneration;
    this.changing = true;
    this.setState({ busy: true });
    const r = await command();
    this.changing = false;
    if (this.disposed) return;
    this.setState({ busy: this.props.printing.simulatedBusy });
    if (generation !== this.loadGeneration) return;
    if (r.ok) this.setState({ ...r.data, error: '' });
    else this.setState({ error: waiterTranslate(this.props.language, 'waiter.Print jobs unavailable. Try again.') });
  }
  retry(jobId) {
    const training = this.state.preparationMode === 'training';
    if (training && !window.confirm(waiterTranslate(this.props.language, 'waiter.Have you checked the simulated ticket? Retrying may duplicate it.'))) return;
    return this.change(() => this.props.printing.retry(jobId, training));
  }
  renderRows() {
    const h = React.createElement;
    return this.state.jobs.map(j => h('div', { key: j.id }, waiterTranslate(this.props?.language, 'waiter.{destination} · Table {table} · Round {round} · {attempts} attempt(s) · ', {destination:printDestination(this.props?.language, j.destination),table:j.tableId,round:j.round,attempts:j.attempts}),
        j.cancelled ? waiterTranslate(this.props?.language, 'waiter.A ticket contains a cancelled item: do not retry. Earlier output may still arrive; tell preparation staff in person.') : j.result === 'uncertain' ? waiterTranslate(this.props?.language, 'waiter.Output uncertain; check before retrying.') : j.result === 'failed' ? waiterTranslate(this.props?.language, 'waiter.Simulated failure.') : waiterTranslate(this.props?.language, 'waiter.Simulated success.'),
        j.hadUncertain && j.result !== 'uncertain' && waiterTranslate(this.props?.language, 'waiter. An earlier attempt was uncertain; duplicate output is possible.'),
        !j.cancelled && j.result !== 'success' && h('button', { disabled: this.state.busy, onClick: () => this.retry(j.id), style: { marginLeft: 10 } }, waiterTranslate(this.props?.language, 'waiter.Retry simulated job'))));
  }
  renderEarlierJobs() {
    const h = React.createElement;
    if (this.state.preparationMode !== 'training' || !this.state.jobs.length) return null;
    return h('details', { style: { padding: '6px 20px', maxHeight: 180, overflow: 'auto' } },
      h('summary', null, waiterTranslate(this.props.language, 'waiter.Earlier simulated tickets')), this.renderRows());
  }
  render() {
    const h = React.createElement;
    const feedback = this.state.error && h('div', { role: 'alert' }, this.state.error, ' ',
      h('button', { disabled: this.state.busy, onClick: () => this.load() }, waiterTranslate(this.props.language, 'waiter.Refresh tickets')));
    if (!this.props.admin) {
      const queues = this.state.preparationMode
        ? h(QueueJobs, { waiter: true, printing: this.props.printing, language: this.props.language, preparationMode: this.state.preparationMode })
        : null;
      const earlier = this.renderEarlierJobs();
      return earlier || feedback ? h(React.Fragment, null, feedback, earlier, queues) : queues;
    }
    return h('section', { style: { padding: '10px 20px', background: '#fff7ed', maxHeight: 220, overflow: 'auto' } },
      h('strong', null, waiterTranslate(this.props?.language, 'waiter.Simulated printer settings')),
      feedback,
      h('div', null, this.state.printers.map(p => h('label', { key: p.destination, style: { marginRight: 16 } }, waiterTranslate(this.props?.language, 'waiter.{destination} simulated result', {destination:printDestination(this.props?.language, p.destination)}) + ' ',
        h('select', { value: p.result, disabled: this.state.busy, onChange: e => this.change(() => this.props.printing.simulate(p.destination, e.target.value)) },
          h('option', { value: 'success' }, waiterTranslate(this.props?.language, 'waiter.Success')), h('option', { value: 'failed' }, waiterTranslate(this.props?.language, 'waiter.Failure')), h('option', { value: 'uncertain' }, waiterTranslate(this.props?.language, 'waiter.Uncertain')))))),
      this.props.settingsOnly ? this.renderEarlierJobs() : this.renderRows());
  }
}
