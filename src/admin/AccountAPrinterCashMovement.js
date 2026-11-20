// This owner outlives the printer screen but remains scoped to the active identity.
export class AccountAPrinterCashMovement {
  constructor() { this.busy=false; this.result=''; this.movement=null; this.uncertainMovements=[]; this.generation=0; this.listeners=new Set(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify() { for (const listener of this.listeners) listener(); }
  reset() { this.generation++; this.busy=false; this.result=''; this.movement=null; this.uncertainMovements=[]; this.notify(); }
  async send(direction, amount) {
    if (this.busy) return;
    const generation=this.generation;
    const movement={direction,amount};
    this.busy=true; this.result=''; this.movement=movement; this.notify();
    let outcome='unknown';
    try {
      const response=await window.arra.businessDays({action:'accountAPrinterCashMovement',direction,amount});
      if (['accepted','declined','unknown','not_sent'].includes(response?.outcome)) outcome=response.outcome;
    } catch (_) {}
    if (generation!==this.generation) return;
    this.busy=false; this.result=outcome;
    if (outcome==='unknown') this.uncertainMovements=[...this.uncertainMovements,movement];
    this.notify();
  }
}
