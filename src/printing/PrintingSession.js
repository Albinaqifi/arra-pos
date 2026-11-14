import { waiterTranslate } from '../shared/waiter-ui.js';

// This owner outlives printing panels and identity changes. A panel may discard
// its displayed data; an unacknowledged print attempt must keep its identity.
export class PrintingSession {
  #bridge;
  #uuid;
  #retryTokens = new Map();
  #testRetryTokens = new Map();
  #billTokens = new Map();
  #busy = { printJobs: false, testPrinting: false };
  #revision = 0;
  #revisionListeners = new Set();
  #activityListeners = new Set();

  constructor({ bridge, uuid = () => crypto.randomUUID() }) {
    this.#bridge = bridge;
    this.#uuid = uuid;
  }

  get simulatedBusy() { return this.#busy.printJobs; }
  get testBusy() { return this.#busy.testPrinting; }
  get revision() { return this.#revision; }

  subscribeRevision(listener) {
    this.#revisionListeners.add(listener);
    return () => this.#revisionListeners.delete(listener);
  }

  subscribeActivity(listener) {
    this.#activityListeners.add(listener);
    return () => this.#activityListeners.delete(listener);
  }

  jobsChanged() {
    this.#revision++;
    for (const listener of this.#revisionListeners) listener(this.#revision);
  }

  dispose() {
    this.#revisionListeners.clear();
    this.#activityListeners.clear();
  }

  async listJobs() {
    try { return await this.#bridge.printJobs({ action: 'list' }); }
    catch (_) { return { ok: false }; }
  }

  async listTestJobs() {
    if (!this.#bridge?.testPrinting) return { disabled: true };
    try { return await this.#bridge.testPrinting({ action: 'list' }); }
    catch (_) { return { ok: false }; }
  }

  simulate(destination, result) {
    return this.#change('printJobs', () => ({ action: 'simulate', destination, result }));
  }

  retry(jobId) {
    return this.#change('printJobs', () => ({
      action: 'retry', jobId, requestId: this.#retryToken(this.#retryTokens, jobId),
    }), () => this.#retryTokens.delete(jobId));
  }

  configureQueue(destination, queue) {
    return this.#change('testPrinting', () => ({ action: 'configure', destination, queue }));
  }

  retryTestJob(jobId, checked) {
    if (checked !== true) return Promise.resolve({ ok: false });
    return this.#change('testPrinting', () => ({
      action: 'retry', jobId, checked: true, requestId: this.#retryToken(this.#testRetryTokens, jobId),
    }), () => this.#testRetryTokens.delete(jobId));
  }

  submitTestBill(billId) {
    return this.#change('testPrinting', () => ({ action: 'bill', billId, requestId: this.#retryToken(this.#billTokens, billId) }));
  }

  #retryToken(tokens, jobId) {
    if (!tokens.has(jobId)) tokens.set(jobId, this.#uuid());
    return tokens.get(jobId);
  }

  async #change(method, request, confirmed = () => {}) {
    if (this.#busy[method]) return { ok: false, busy: true };
    this.#busy[method] = true;
    for (const listener of this.#activityListeners) listener();
    try {
      const result = await this.#bridge[method](request());
      if (result.ok) confirmed();
      return result;
    } catch (_) { return { ok: false }; }
    finally {
      this.#busy[method] = false;
      for (const listener of this.#activityListeners) listener();
    }
  }

  async handoffNotice(language) {
    try {
      const jobs = await this.listJobs();
      if (jobs.ok) {
        return jobs.data.jobs.some(job => job.result !== 'success' || job.hadUncertain)
          ? waiterTranslate(language, 'waiter.A print job needs attention or had uncertain output. Select a waiter to review it and retry if needed.')
          : '';
      }
    } catch (_) { /* Keep the existing unavailable warning for an unusable status response. */ }
    return waiterTranslate(language, 'waiter.Print status unavailable. Select a waiter and check print jobs.');
  }
}
