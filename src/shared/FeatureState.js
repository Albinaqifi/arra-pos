// A feature publishes its own snapshot. Subscribers only request a render;
// commands and state remain with the feature that owns them.
export class FeatureState {
  constructor(state) { this.state = state; this.listeners = new Set(); this.disposed = false; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  _set(update) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
}
