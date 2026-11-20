// This owner outlives the printer screen but remains scoped to the active identity.
export class AccountAPrinterCashMovement {
  constructor() { this.busy=false; this.result=''; this.generation=0; this.listeners=new Set(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const listener of this.listeners) listener(); }
  reset() { this.generation++; this.busy=false; this.result=''; this.notify(); }
  async send(direction, amount) {
    if (this.busy) return;
    const generation=this.generation;
    this.busy=true; this.result=''; this.notify();
    let outcome='unknown';
    try {
      const response=await window.arra.businessDays({action:'accountAPrinterCashMovement',direction,amount});
      if (['accepted','declined','unknown','not_sent'].includes(response?.outcome)) outcome=response.outcome;
    } catch (_) {}
    if (generation!==this.generation) return;
    this.busy=false; this.result=outcome; this.notify();
  }
}
