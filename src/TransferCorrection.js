const h = React.createElement;
class TransferCorrection extends React.Component {
  constructor(props) {
    super(props);
    this.state = { records: null, tables: [], table: null, reason: "", selected: null, error: "", success: "", loading: true, busy: false };
    this.sequence = 0;
    this.submitting = false;
  }
  componentDidMount() {
    this.load();
  }
  componentWillUnmount() {
    this.sequence++;
  }
  async load() {
    const sequence = ++this.sequence;
    this.setState({ loading: true, records: null, selected: null, error: "" });
    try {
      const r = await window.arra.transferCorrection({ action: "list" });
      if (sequence !== this.sequence) return;
      this.setState(r.ok ? { records: r.data.payments, tables: r.data.tables, loading: false } : { loading: false, error: "Eligible payments are unavailable. Check your access and try again." });
    } catch (_) {
      if (sequence === this.sequence) this.setState({ loading: false, error: "Eligible payments are unavailable. Check your connection and try again." });
    }
  }
  async correct(id) {
    if (this.submitting || this.state.selected !== id) return;
    this.submitting = true;
    this.setState({ busy: true, error: "", success: "" });
    try {
      const r = await window.arra.transferCorrection({ action: "correct", paymentId: id, reason: this.state.reason });
      if (r.ok) {
        this.setState({ reason: "", success: "Payment #" + id + " corrected from Account B to Account A." });
        await this.load();
      } else {
        this.setState({ records: null, selected: null, error: "Correction was not confirmed. Refresh the list and check the payment before trying again." });
      }
    } catch (_) {
      this.setState({ records: null, selected: null, error: "Correction result is unavailable. Refresh the list and check the payment before trying again." });
    } finally {
      this.submitting = false;
      this.setState({ busy: false });
    }
  }
  render() {
    const s = this.state, rows = s.records && s.records.filter((p) => p.tableId === s.table), selected = rows && rows.find((p) => p.id === s.selected);
    return h("div", { className: "transfer-shell" },
      h("header", { className: "transfer-header" },
      h("div", { className: "admin-brand" },
      h("span", { className: "admin-brand-mark", "aria-hidden": "true" }, "A"),
      h("span", null, "Arra ",
      h("small", null, "Transfer manager"))),
      h("button", { disabled: s.busy, onClick: this.props.onBack }, "Switch user")),
      h("main", { className: "transfer-content" },
      h("p", { className: "admin-eyebrow" }, "RESTRICTED WORKSPACE"),
      h("h1", null, "Transfer manager"),
      h("p", { className: "admin-intro" }, "Correct eligible cash payments from Account B to Account A."),
      h("div", { className: "floor-note" },
      h("strong", null, "Open business day only"),
      h("p", null, "Only uncorrected cash payments in an open business day are eligible. Once the day is closed, its payments cannot be corrected here.")), s.loading &&
      h("p", { role: "status", className: "admin-status" }, "Loading eligible payments\u2026"), s.error &&
      h("p", { role: "alert", className: "transfer-error" }, s.error), s.success &&
      h("p", { role: "status", className: "floor-success" }, s.success), !s.loading &&
      h("button", { disabled: s.busy, onClick: () => {
      this.setState({ success: "" });
      this.load();
    } }, "Refresh eligible payments"), s.records && s.table === null &&
      h("section", { className: "history-panel" },
      h("p", { className: "admin-eyebrow" }, "STEP 1"),
      h("h2", null, "Choose a table"),
      h("p", { className: "history-muted" }, "Select a table to review its eligible payments."), s.tables.length ?
      h("div", { className: "transfer-tables" }, s.tables.map((t) =>
      h("button", { key: t.id, onClick: () => this.setState({ table: t.id, success: "" }) },
      h("strong", null, "Table ", t.id),
      h("span", null, t.area, t.active ? "" : " \xB7 Inactive"),
      h("small", null, s.records.filter((p) => p.tableId === t.id).length, " eligible")))) :
      h("p", { className: "floor-empty" }, "No tables available.")), s.records && s.table !== null &&
      h("section", { className: "history-panel" },
      h("button", { disabled: s.busy, onClick: () => this.setState({ table: null, selected: null, reason: "", success: "" }) }, "\u2190 All tables"),
      h("p", { className: "admin-eyebrow floor-eyebrow" }, "STEP 2"),
      h("h2", null, "Table ", s.table, " \xB7 Eligible payments"),
      h("p", { className: "history-muted" }, "Amounts are shown in minor units. Review a payment before confirming its correction."), rows.length ?
      h("ul", { className: "transfer-payments" }, rows.map((p) =>
      h("li", { key: p.id },
      h("div", null,
      h("strong", null, "Payment #", p.id),
      h("span", null, new Date(p.paidAt).toLocaleString())),
      h("strong", null, p.amount, " minor units"),
      h("button", { disabled: s.busy, onClick: () => this.setState({ selected: p.id, reason: "", success: "" }) }, "Review correction")))) :
      h("p", { className: "floor-empty" }, "No eligible payments for this table."), selected &&
      h("div", { className: "finance-confirm", role: "group", "aria-label": "Confirm payment correction" },
      h("p", { className: "admin-eyebrow" }, "STEP 3"),
      h("h3", null, "Correct payment #", selected.id, "?"),
      h("p", null, "Table ", s.table, " \xB7 ", selected.amount, " minor units \xB7 cash. This records a correction from Account B to Account A."),
      h("label", { className: "transfer-reason" }, "Reason (optional)",
      h("textarea", { maxLength: 500, disabled: s.busy, value: s.reason, onChange: (e) => this.setState({ reason: e.target.value }) })),
      h("div", { className: "floor-actions" },
      h("button", { className: "transfer-primary", disabled: s.busy, onClick: () => this.correct(selected.id) }, s.busy ? "Correcting\u2026" : "Confirm B to A"),
      h("button", { disabled: s.busy, onClick: () => this.setState({ selected: null, reason: "" }) }, "Cancel"))))));
  }
}
export {
  TransferCorrection
};
