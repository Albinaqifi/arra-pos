import { FeatureState } from '../shared/FeatureState.js';
import { waiterTranslate } from '../shared/waiter-ui.js';

const destination = key => key === 'bar' ? 'Bar' : 'Kitchen';

// Browser demo jobs remain in memory for the renderer lifetime, including staff
// changes. They never call the desktop bridge or represent physical output.
export class DemoPrinting extends FeatureState {
  constructor({ nextId, getLanguage, getActor, appendActivity, notify }) {
    super({ printers: { kitchen: true, bar: true, A: true, B: true }, jobs: [] });
    Object.assign(this, { nextId, getLanguage, getActor, appendActivity, notify });
  }
  t(key, values) { return waiterTranslate(this.getLanguage(), 'waiter.' + key, values); }
  isOnline(key) { return this.state.printers[key]; }
  toggle(key) {
    if (this.disposed) return;
    const names = { kitchen: 'Kitchen', bar: 'Bar', A: 'Bill A', B: 'Bill B' };
    const online = !this.isOnline(key);
    this._set({ printers: { ...this.state.printers, [key]: online } });
    this.notify('Demo: ' + names[key] + ' printer is now ' + (online ? 'online.' : 'offline.'), online ? 'ok' : 'warn');
  }
  submitRound({ tableId, round, items, actor }) {
    if (this.disposed) return '';
    const jobs = [], parts = [], bad = [], displayParts = [];
    for (const key of ['kitchen', 'bar']) {
      const routed = items.filter(item => item.route === key);
      if (!routed.length) continue;
      const count = routed.reduce((sum, item) => sum + item.qty, 0), online = this.isOnline(key), label = destination(key);
      jobs.push({ id: this.nextId('j'), tableId, round, printer: key, count, status: online ? 'ok' : 'failed', attempts: 1 });
      parts.push(label + ' got ' + count + (count === 1 ? ' item' : ' items'));
      displayParts.push(this.t(count === 1 ? '{destination} got {count} item' : '{destination} got {count} items', { destination: this.t(label), count }));
      if (!online) bad.push(label);
    }
    this.appendActivity(tableId, 'Sent round ' + round + ': ' + parts.join(', ') + (bad.length ? ' (' + bad.join(' and ') + ' ticket did not print)' : ''), actor);
    this._set({ jobs: [...this.state.jobs, ...jobs] });
    return bad.length
      ? this.t('Round {round} is saved, but the {destinations} ticket did not print. Select a waiter to retry using the red bar.', { round, destinations: bad.map(label => this.t(label)).join(this.getLanguage() === 'sq' ? ' dhe ' : ' and ') })
      : this.t('Round {round} sent. {details}.', { round, details: displayParts.join(', ') });
  }
  retry(id) {
    if (this.disposed) return;
    const job = this.state.jobs.find(value => value.id === id);
    if (!job) return;
    const label = destination(job.printer), online = this.isOnline(job.printer);
    this.appendActivity(job.tableId, online ? 'Reprinted ' + label + ' ticket for round ' + job.round + ' (same items, nothing added twice)' : 'Retry of ' + label + ' ticket failed', this.getActor());
    this._set({ jobs: this.state.jobs.map(value => value.id === id ? { ...value, attempts: value.attempts + 1, status: online ? 'ok' : value.status } : value) });
    this.notify(this.t(online ? '{destination} ticket printed. Nothing was added to the order twice.' : '{destination} printer is still not responding. Try the backup printer.', { destination: this.t(label) }), online ? 'ok' : 'err');
  }
  backup(id) {
    if (this.disposed) return;
    const job = this.state.jobs.find(value => value.id === id);
    if (!job) return;
    const label = destination(job.printer);
    this.appendActivity(job.tableId, 'Printed ' + label + ' ticket for round ' + job.round + ' on the backup printer', this.getActor());
    this._set({ jobs: this.state.jobs.map(value => value.id === id ? { ...value, attempts: value.attempts + 1, status: 'ok' } : value) });
    this.notify(this.t('{destination} ticket printed on the backup printer.', { destination: this.t(label) }));
  }
  moveJobs(from, to) { this._set({ jobs: this.state.jobs.map(job => job.tableId === from ? { ...job, tableId: to } : job) }); }
  retireOrderJobs(tableId) { this._set({ jobs: this.state.jobs.filter(job => job.tableId !== tableId) }); }
  failedTableIds() { return this.state.jobs.filter(job => job.status === 'failed').map(job => job.tableId); }
  failedView() {
    const failed = this.state.jobs.filter(job => job.status === 'failed');
    return {
      t: (key, values) => this.t(key, values), hasFailed: failed.length > 0,
      failed: failed.map(job => ({
        text: this.t(job.count === 1 ? '{destination} ticket for Table {table} (round {round}, {count} item) did not print. The order is saved.' : '{destination} ticket for Table {table} (round {round}, {count} items) did not print. The order is saved.', { destination: this.t(destination(job.printer)), table: job.tableId, round: job.round, count: job.count }),
        attempts: this.t('Tried {count}×', { count: job.attempts }), retry: () => this.retry(job.id), backup: () => this.backup(job.id),
      })),
    };
  }
  controlsView() {
    return [['kitchen', 'Kitchen'], ['bar', 'Bar'], ['A', 'Bill A'], ['B', 'Bill B']].map(([key, label]) => {
      const online = this.isOnline(key);
      return {
        label, state: online ? '' : ' offline', aria: label + ' printer ' + (online ? 'online' : 'offline') + '. Demo: click to switch',
        style: 'height:44px; padding:0 14px; border-radius:999px; font-size:15px; font-weight:800; display:inline-flex; align-items:center; gap:8px; border:2px solid ' + (online ? '#BBF7D0' : '#DC2626') + '; background:' + (online ? '#F0FDF4' : '#FEF2F2') + '; color:' + (online ? '#14532D' : '#991B1B'),
        dot: 'width:11px; height:11px; border-radius:999px; background:' + (online ? '#16A34A' : '#DC2626'), toggle: () => this.toggle(key),
      };
    });
  }
}
