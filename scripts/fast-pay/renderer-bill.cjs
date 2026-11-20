// This factory is included in the RC2 DesktopBill module by renderer.cjs.
// Its superclass supplies the existing identity, order-write and modal lifetimes.
function fastPayBill(DesktopBill, bridge, h, translate) {
  const holdMessage = 'An earlier checkout needs review. Keep this bill for recovery.';
  const pendingMessage = 'Pay records the payment now. The fiscal receipt is processed separately.';
  const messages = {
    'Pay': 'Paguaj',
    'Cash A': 'Para në dorë A',
    'Card A': 'Kartë A',
    [holdMessage]: 'Një pagesë e mëparshme kërkon kontroll. Ruajeni këtë faturë për rikuperim.',
    [pendingMessage]: 'Pagesa regjistrohet tani. Kuponi fiskal përpunohet veçmas.',
    'Check the enrolled printer profile for this payment method.': 'Kontrolloni profilin e printerit të regjistruar për këtë mënyrë pagese.',
  };
  const held = bill => !!(bill.fastPayLegacyHeld || bill.physicalCardHold || bill.physicalCardIntent || bill.physicalCashIntent ||
    bill.fiscal || bill.simulatedCardIntent || bill.simulatedCardApproval || bill.simulatedCashIntent);
  const isId = value => Number.isSafeInteger(value) && value > 0;
  const receiptStates = ['queued', 'unconfirmed', 'acknowledged', 'previously-paid'];
  const money = value => value.toLocaleString('en-US') + ' den';

  return class extends DesktopBill {
    t(key, values) {
      if (Object.hasOwn(messages, key)) return this.props.language === 'sq' ? messages[key] : key;
      return translate(this.props.language, 'waiter.' + key, values);
    }
    presentBill(bill, rejection) {
      if (bill.fastPayVersion !== 1) return super.presentBill(bill, rejection);
      this.setState({ data: bill, loading: false, error: held(bill) ? holdMessage : '', fiscalHold: held(bill) });
    }
    selectMethod(method, account = 'A') {
      if (this.state.data?.fastPayVersion !== 1) return super.selectMethod(method, account);
      if (this.disposed || this.operation || this.confirmed || this.paymentSelection || this.state.fiscalHold) return;
      if ((method === 'cash' && ['A', 'B'].includes(account)) || (method === 'card' && account === 'A')) {
        this.setState({ method, account, error: '' });
      }
    }
    async generateForPayment(preview, operation) {
      let result;
      try {
        result = await bridge.bill({ action: 'generate', orderId: this.props.orderId, fingerprint: preview.fingerprint });
      } catch { /* Review can retrieve a bill even if generation lost its reply. */ }
      if (!this.current(operation)) return;
      const bill = result?.data;
      if (!result?.ok || bill?.fastPayVersion !== 1 || !isId(bill.id) || bill.orderId !== this.props.orderId ||
          bill.fingerprint !== preview.fingerprint || bill.total !== preview.total) {
        // Require a fresh review before paying a changed order.
        this.setState({ data: null, error: this.serviceError(result?.error, 'Could not prepare bill') });
        return;
      }
      this.presentBill(bill);
      return held(bill) ? null : bill;
    }
    async payFast() {
      const { data, account, method } = this.state;
      if (data?.fastPayVersion !== 1 || this.state.fiscalHold || held(data) ||
          !['cash', 'card'].includes(method) || !['A', 'B'].includes(account) || method === 'card' && account !== 'A') return;
      const operation = this.begin('payment');
      if (!operation) return;
      this.setState({ error: '' });
      try {
        const bill = data.id ? data : await this.generateForPayment(data, operation);
        if (!bill || !this.current(operation)) return;
        const retry = !!this.paymentSelection;
        const selection = this.paymentSelection || Object.freeze({
          billId: bill.id, method, account, ...(account === 'A' ? { fastPay: true } : {}),
        });
        // Cash B keeps the installed payment channel contract and printer routing.
        this.paymentSelection = selection;
        let result;
        try { result = await bridge.payment(selection); } catch { /* The transaction may have committed. */ }
        if (!this.current(operation)) return;
        const saved = result?.data;
        if (result?.ok === true && isId(saved?.id) && (selection.account === 'B' ||
            (saved.billId === selection.billId && saved.method === selection.method && saved.account === 'A' &&
              receiptStates.includes(saved.receiptStatus)))) {
          this.confirmed = true;
          this.paymentSelection = null;
          this.props.onConfirmed?.();
          this.props.onUncertain?.(false);
          this.end(operation);
          await this.props.onPaid?.();
          return;
        }
        const denied = result?.error === 'Access denied';
        const locked = result?.fiscalStatus === 'blocked' || result?.fiscalStatus === 'cardTrialHold' ||
          result?.error === 'Bill already paid with a different selection';
        const uncertain = !denied && !locked && (retry || result?.ok !== false || result.uncertain === true);
        this.paymentSelection = uncertain ? selection : null;
        this.props.onUncertain?.(uncertain);
        const fiscalErrors = {
          origin: 'A bill item has no saved Macedonian-product mark. Ask Combined to classify it in Menu management.',
          unmapped: 'A bill item has no saved VAT group. Check its menu and order details.',
          unavailable: 'The PF700 cannot register the items or amounts on this bill.',
          scope: 'Check the enrolled printer profile for this payment method.',
        };
        this.setState({ ...(denied ? { data: null } : {}), uncertain, fiscalHold: locked,
          error: locked ? (result?.error === 'Bill already paid with a different selection' ? result.error : holdMessage)
            : uncertain ? 'Payment result unknown. Retry the same selection.'
            : fiscalErrors[result?.fiscalStatus] || this.serviceError(result?.error, 'Could not record payment. Retry the same selection.') });
      } finally {
        this.end(operation);
      }
    }
    render() {
      const { data: bill, method, account, busy, uncertain, fiscalHold, error } = this.state;
      if (bill?.fastPayVersion !== 1) return super.render();
      const t = (key, values) => this.t(key, values);
      const locked = busy || uncertain || fiscalHold;
      const choice = (label, selectedMethod) => h('button', { type: 'button', disabled: locked,
        'aria-pressed': method === selectedMethod && account === 'A',
        onClick: () => this.selectMethod(selectedMethod, 'A') }, t(label));
      return h('div', { className: 'bill-overlay' },
        h('div', { className: 'bill-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'desktop-bill-title',
          tabIndex: -1, ref: node => { this.dialog = node; }, onKeyDown: event => this.onKeyDown(event) },
          h('header', { className: 'bill-header' },
            h('h2', { id: 'desktop-bill-title' }, bill.id ? t('Bill generated #{id}', { id: bill.id }) : t('Review bill')),
            h('button', { type: 'button', className: 'bill-brand', 'aria-label': t('Select Cash B'), title: t('Select Cash B'),
              'aria-pressed': method === 'cash' && account === 'B', disabled: locked, onClick: () => this.selectMethod('cash', 'B') },
              h('span', { 'aria-hidden': 'true' }, 'A'), h('strong', null, 'Arra'))),
          h('div', { className: 'bill-body' },
            busy && h('p', { role: 'status', className: 'bill-status' }, t('Working…')),
            error && h('p', { role: 'alert', className: 'bill-error' }, t(error)),
            h('section', { className: 'bill-summary' },
              h('ul', { className: 'bill-lines' }, bill.lines.map(line =>
                h('li', { key: line.itemId }, line.quantity + ' × ' + line.name + ' · ' + money(line.quantity * line.unitPrice),
                  line.taxGroup && Number.isInteger(line.taxRate) && h('small', null, ' · ', t('VAT {rate}% ({group})', { rate: line.taxRate, group: line.taxGroup })),
                  typeof line.domesticProduct === 'boolean' && h('small', null, ' · ', t(line.domesticProduct ? 'Macedonian-product mark included' : 'Macedonian-product mark omitted')),
                  line.modifiers.length > 0 && h('div', { className: 'bill-modifiers' }, line.modifiers.map(m => m.groupName + ': ' + m.optionName + ' (' + m.adjustment + ')').join(', '))))),
              h('div', { className: 'bill-total' }, h('strong', null, t('Total: {total}', { total: money(bill.total) })))),
            !fiscalHold && h('div', { className: 'bill-payment' },
              h('div', { className: 'bill-choices' }, choice('Cash A', 'cash'), choice('Card A', 'card')),
              account === 'A' && h('p', { className: 'bill-payment-label' }, t(pendingMessage)))),
          h('footer', { className: 'bill-actions' },
            h('button', { disabled: busy || uncertain, onClick: () => this.close() }, t('Close')),
            fiscalHold && h('button', { disabled: busy, onClick: () => this.review() }, t('Reload saved bill')),
            !fiscalHold && h('button', { className: 'bill-primary', disabled: busy || !method, onClick: () => this.payFast() }, t(uncertain ? 'Retry' : 'Pay')))));
    }
  };
}
module.exports = { fastPayBill };
