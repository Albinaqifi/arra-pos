import { waiterTranslate, printDestination } from '../shared/waiter-ui.js';

export class QueueJobs extends React.Component {
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
    else this.setState({ error: this.t('Print status unavailable. Refresh before retrying.') });
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
    else this.setState({ error: this.t('Unable to change printing. Check permission and output before trying again.') });
  }
  t(text, values) { return waiterTranslate(this.props.language, 'waiter.' + text, values); }
  confirmRetry() {
    const prompt = this.state.data?.preparationMode === 'training'
      ? 'Have you checked the simulated ticket? Retrying may duplicate it.'
      : 'Have you checked the printer and paper? Retrying may print a duplicate.';
    return window.confirm(this.t(prompt));
  }
  retry(jobId) {
    if (!this.confirmRetry()) return;
    return this.change(() => this.props.printing.retryTestJob(jobId, true));
  }
  retryNotice(jobId) {
    if (!this.confirmRetry()) return;
    return this.change(() => this.props.printing.retryNotice(jobId, true));
  }
  renderSettings(queues, training) {
    const h = React.createElement;
    if (training) return queues.map(q => h('div', { key: q.destination },
      this.t('{destination} queue', { destination: printDestination(this.props.language, q.destination) }), ' · ', q.queue));
    return h(React.Fragment, null,
      queues.map(q => h('div', { key: q.destination },
        h('label', null, this.t('{destination} queue', { destination: printDestination(this.props.language, q.destination) }), ' ',
          h('input', { defaultValue: q.queue, id: 'test-queue-' + q.destination, maxLength: 255 })),
        h('button', { disabled: this.state.busy, onClick: () => this.change(() =>
          this.props.printing.configureQueue(q.destination, document.getElementById('test-queue-' + q.destination).value)) }, this.t('Save queue')))),
      queues.filter(q => ['kitchen', 'kitchen2', 'bar'].includes(q.destination)).map(q => h('div', { key: 'alert-' + q.destination },
        this.t('{destination} cancellation sound: {mode}', {
          destination: printDestination(this.props.language, q.destination),
          mode: this.t(q.beep ? 'Three beeps requested' : 'No sound requested'),
        }), ' ',
        h('button', { disabled: this.state.busy, onClick: () => this.change(() => this.props.printing.configureAlert(q.destination, !q.beep)) },
          this.t(q.beep ? 'Disable sound' : 'Enable compatible printer sound')))),
      h('p', null, this.t('Enable sound only for a printer confirmed to support ESC B. Sound is not confirmed by Windows.')),
      h('p', null, this.t('Changing queues requires employee management permission.')));
  }
  status(result, training) {
    if (training) {
      const labels = { accepted: 'Simulated success.', failed: 'Simulated failure.', uncertain: 'Simulated output uncertain.' };
      if (Object.hasOwn(labels, result)) return this.t(labels[result]);
    }
    return this.t(result);
  }
  renderNotice(job, training) {
    const h = React.createElement;
    return h('div', { key: 'notice-' + job.id },
      this.t('CANCELLATION · {destination} · Table {table} · Round {round} · {quantity} × {name} · {status} · {attempts} attempt(s)', {
        destination: printDestination(this.props.language, job.destination), table: job.tableId, round: job.round,
        quantity: job.lines[0].quantity, name: job.lines[0].name,
        status: job.retryBlocked ? this.t('Output uncertain; check paper') : this.status(job.result, training), attempts: job.attempts,
      }), ' ',
      job.retryBlocked ? this.t('Original printer output could not be verified. Tell preparation staff in person.')
        : job.destination === 'unknown' ? this.t('Original destination unknown; tell preparation staff in person.')
        : !training && this.t(job.beep ? 'Three beeps requested; sound unconfirmed.' : 'No sound requested.'), ' ',
      !job.retryBlocked && job.destination !== 'unknown' && h('button', { disabled: this.state.busy, onClick: () => this.retryNotice(job.id) }, this.t('Retry after checking')));
  }
  renderJob(job, training) {
    const h = React.createElement;
    const title = job.ticketId ? '{destination} job #{id} · Table {table} · Round {round} · {attempts} attempt(s) · {queue} · '
      : '{destination} job #{id} · Bill #{bill} · {attempts} attempt(s) · {queue} · ';
    return h('div', { key: job.id }, this.t(title, {
      destination: printDestination(this.props.language, job.destination), id: job.id, table: job.tableId, round: job.round,
      bill: job.billId, attempts: job.attempts, queue: job.queue,
    }), job.cancelled ? this.t('A ticket contains a cancelled item: do not retry. Earlier output may still arrive; tell preparation staff in person.')
      : job.result === 'unattempted' && !training ? this.t('Not yet attempted; check paper before printing')
      : this.status(job.result, training), ' ',
      !job.cancelled && h('button', { disabled: this.state.busy, onClick: () => this.retry(job.id) }, this.t('Retry after checking')));
  }
  render() { return this.renderPanel(null); }
  renderPanel(settings) {
    const h = React.createElement, d = this.state.data;
    if (this.state.disabled || (!d && !this.state.error)) return null;
    const mode = d?.preparationMode || this.props.preparationMode;
    const training = mode === 'training';
    const notices = d?.notices || [], jobs = d?.jobs || [];
    const title = training ? 'Simulated preparation tickets' : mode === 'routine' ? 'Preparation tickets' : 'TEST MODE: Windows printer queues';
    const controls = h(React.Fragment, null,
      this.state.error && h('p', { role: 'alert' }, this.state.error),
      !training && h('p', null, this.t('Queue acceptance does not confirm paper. Inspect the printer and paper before retrying.')),
      !this.props.waiter && this.renderSettings(d?.queues || [], training),
      h('button', { disabled: this.state.busy, onClick: () => this.load() }, this.t(mode ? 'Refresh tickets' : 'Refresh test jobs')),
      !training && notices.length > 0 && h('p', null, this.t('Cancellation alerts: tell preparation staff in person. Windows acceptance does not confirm paper, sound or staff awareness.')),
      notices.map(job => this.renderNotice(job, training)),
      jobs.map(job => this.renderJob(job, training)));
    if (this.props.waiter) {
      if (!jobs.length && !notices.length && !this.state.error) return null;
      const issues = [...jobs, ...notices].filter(job => job.retryBlocked || (!job.cancelled && job.result !== 'accepted')).length;
      return h('details', { style: { padding: '6px 20px', maxHeight: 180, overflow: 'auto' } },
        h('summary', null, this.t(title), issues ? ' · ' + this.t('{count} need attention', { count: issues }) : ''), controls);
    }
    return h('section', { style: { padding: 12, background: '#fff7ed' } }, settings, h('strong', null, this.t(title)), controls);
  }
}
