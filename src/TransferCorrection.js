import { transferText } from "./admin/transfer-i18n.js";
const h = React.createElement;
class TransferCorrection extends React.Component {
  constructor(props) {
    super(props);
    this.state = { records: null, tables: [], table: null, reason: "", selected: null, error: "", success: "", successId: null, loading: true, busy: false };
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
    this.setState({ busy: true, error: "", success: "", successId: null });
    try {
      const r = await window.arra.transferCorrection({ action: "correct", paymentId: id, reason: this.state.reason });
      if (r.ok) {
        this.setState({ reason: "", success: "Payment #" + id + " corrected from Account B to Account A.", successId: id });
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
    const t = (key, values) => transferText(this.props.language, key, values);
    const s = this.state, rows = s.records && s.records.filter((p) => p.tableId === s.table), selected = rows && rows.find((p) => p.id === s.selected);
    return h("div", { className: "transfer-shell" },
      h("header", { className: "transfer-header" },
      h("div", { className: "admin-brand" },
      h("span", { className: "admin-brand-mark", "aria-hidden": "true" }, "A"),
      h("span", null, "Arra ",
      h("small", null, t("Transfer manager")))),
      h("button", { disabled: s.busy, onClick: this.props.onBack }, t("Switch user"))),
      h("main", { className: "transfer-content" },
      h("p", { className: "admin-eyebrow" }, t("RESTRICTED WORKSPACE")),
      h("h1", null, t("Transfer manager")),
      h("p", { className: "admin-intro" }, t("Correct eligible cash payments from Account B to Account A.")),
      h("div", { className: "floor-note" },
      h("strong", null, t("Open business day only")),
      h("p", null, t("Only uncorrected cash payments in an open business day are eligible. Once the day is closed, its payments cannot be corrected here."))), s.loading &&
      h("p", { role: "status", className: "admin-status" }, t("Loading eligible payments…")), s.error &&
      h("p", { role: "alert", className: "transfer-error" }, t(s.error)), s.success &&
      h("p", { role: "status", className: "floor-success" }, s.successId != null ? t("Payment #{id} corrected from Account B to Account A.", {id:s.successId}) : t(s.success)), !s.loading &&
      h("button", { disabled: s.busy, onClick: () => {
      this.setState({ success: "", successId: null });
      this.load();
    } }, t("Refresh eligible payments")), s.records && s.table === null &&
      h("section", { className: "history-panel" },
      h("p", { className: "admin-eyebrow" }, t("STEP 1")),
      h("h2", null, t("Choose a table")),
      h("p", { className: "history-muted" }, t("Select a table to review its eligible payments.")), s.tables.length ?
      h("div", { className: "transfer-tables" }, s.tables.map((table) =>
      h("button", { key: table.id, onClick: () => this.setState({ table: table.id, success: "", successId: null }) },
      h("strong", null, t("Table {id}", {id:table.id})),
      h("span", null, table.area, table.active ? "" : t(" · Inactive")),
      h("small", null, t("{count} eligible", {count:s.records.filter((p) => p.tableId === table.id).length}))))) :
      h("p", { className: "floor-empty" }, t("No tables available."))), s.records && s.table !== null &&
      h("section", { className: "history-panel" },
      h("button", { disabled: s.busy, onClick: () => this.setState({ table: null, selected: null, reason: "", success: "", successId: null }) }, t("← All tables")),
      h("p", { className: "admin-eyebrow floor-eyebrow" }, t("STEP 2")),
      h("h2", null, t("Table {id} · Eligible payments", {id:s.table})),
      h("p", { className: "history-muted" }, t("Amounts are shown in minor units. Review a payment before confirming its correction.")), rows.length ?
      h("ul", { className: "transfer-payments" }, rows.map((p) =>
      h("li", { key: p.id },
      h("div", null,
      h("strong", null, t("Payment #{id}", {id:p.id})),
      h("span", null, new Date(p.paidAt).toLocaleString())),
      h("strong", null, t("{amount} minor units", {amount:p.amount})),
      h("button", { disabled: s.busy, onClick: () => this.setState({ selected: p.id, reason: "", success: "", successId: null }) }, t("Review correction"))))) :
      h("p", { className: "floor-empty" }, t("No eligible payments for this table.")), selected &&
      h("div", { className: "finance-confirm", role: "group", "aria-label": t("Confirm payment correction") },
      h("p", { className: "admin-eyebrow" }, t("STEP 3")),
      h("h3", null, t("Correct payment #{id}?", {id:selected.id})),
      h("p", null, t("Table {table} · {amount} minor units · cash. This records a correction from Account B to Account A.", {table:s.table,amount:selected.amount})),
      h("label", { className: "transfer-reason" }, t("Reason (optional)"),
      h("textarea", { maxLength: 500, disabled: s.busy, value: s.reason, onChange: (e) => this.setState({ reason: e.target.value }) })),
      h("div", { className: "floor-actions" },
      h("button", { className: "transfer-primary", disabled: s.busy, onClick: () => this.correct(selected.id) }, s.busy ? t("Correcting…") : t("Confirm B to A")),
      h("button", { disabled: s.busy, onClick: () => this.setState({ selected: null, reason: "" }) }, t("Cancel")))))));
  }
}
export {
  TransferCorrection
};
