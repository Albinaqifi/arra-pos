import { historyReportsText } from './history-reports-i18n.js';
const h = React.createElement;
class OperationalReports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { from: "", to: "", data: null, error: "", busy: false };
    this.sequence = 0;
  }
  componentWillUnmount() {
    this.sequence++;
  }
  async load(e) {
    e.preventDefault();
    if (this.state.busy) return;
    const from = (/* @__PURE__ */ new Date(this.state.from + "T00:00:00")).getTime();
    const end = /* @__PURE__ */ new Date(this.state.to + "T00:00:00");
    end.setDate(end.getDate() + 1);
    const to = end.getTime();
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to) return this.setState({ data: null, error: "Choose a valid date range." });
    const sequence = ++this.sequence;
    this.setState({ busy: true, data: null, error: "" });
    try {
      const r = await window.arra.operationalReports({ from, to, account: null });
      if (sequence === this.sequence) this.setState(r.ok ? { data: r.data, error: "", busy: false } : { data: null, error: "Report unavailable.", busy: false });
    } catch (_) {
      if (sequence === this.sequence) this.setState({ data: null, error: "Report unavailable.", busy: false });
    }
  }
  render() {
    const { from, to, data, error, busy } = this.state;
    const t = (key, values) => historyReportsText(this.props.language || 'en', key, values);
    return h("main", { className: "reports" },
      h("button", { onClick: this.props.onBack }, t("← Back to administration")),
      h("p", { className: "admin-eyebrow floor-eyebrow" }, t("ADMINISTRATION / REPORTS")),
      h("h1", null, t("Operational reports")),
      h("p", { className: "admin-intro" }, t("Explore paid product, table and waiter activity for a local date range.")),
      h("section", { className: "history-panel" },
      h("p", { className: "admin-eyebrow" }, t("REPORT PERIOD")),
      h("h2", null, t("Choose dates")),
      h("form", { className: "report-form", onSubmit: (e) => this.load(e) },
      h("label", null, t("From"),
      h("input", { type: "date", required: true, disabled: busy, value: from, onChange: (e) => this.setState({ from: e.target.value, data: null, error: "" }) })),
      h("label", null, t("Through"),
      h("input", { type: "date", required: true, disabled: busy, value: to, onChange: (e) => this.setState({ to: e.target.value, data: null, error: "" }) })),
      h("button", { className: "floor-primary", disabled: busy }, busy ? t("Loading…") : t("Show report")))),
      h("div", { className: "floor-note" },
      h("strong", null, t("Provisional definitions")),
      h("p", null, t("Paid bills only, by local payment date and your financial scope. Values are bill snapshot amounts in minor units. Products are grouped by ID and show their latest paid snapshot name in the period. Unpaid orders are excluded.")),
      h("p", null, t("Table usage counts the table on the paid order; moved tables are not attributed to earlier tables. Waiter activity counts the person who recorded payment, not every contributing waiter."))), busy &&
      h("p", { role: "status", className: "admin-status" }, t("Loading report…")), error &&
      h("p", { role: "alert" }, t(error), " ", error === "Report unavailable." && t("Check your access or sign in and select your own name.")), data &&
      h("div", null,
      h("p", { className: "reports-period" }, t("Results · {from} through {to}", {from, to})),
      h("section", { className: "history-panel" },
      h("p", { className: "admin-eyebrow" }, t("PAID BILL LINES")),
      h("h2", null, t("Products")), data.products.length ?
      h("div", { className: "report-table-wrap" },
      h("table", { className: "report-table" },
      h("thead", null,
      h("tr", null,
      h("th", null, t("Product")),
      h("th", null, t("Quantity")),
      h("th", null, t("Value · minor units")))),
      h("tbody", null, data.products.map((r) =>
      h("tr", { key: r.productId },
      h("td", null,
      h("strong", null, r.name),
      h("small", null, "ID: ", r.productId)),
      h("td", null, t("quantity {value}",{value:r.quantity})),
      h("td", null, t("value {value}",{value:r.value}))))))) :
      h("p", { className: "floor-empty" }, t("No products in this period."))),
      h("section", { className: "history-panel" },
      h("p", { className: "admin-eyebrow" }, t("PAID ORDERS")),
      h("h2", null, t("Tables")), data.tables.length ?
      h("div", { className: "report-table-wrap" },
      h("table", { className: "report-table" },
      h("thead", null,
      h("tr", null,
      h("th", null, t("Table")),
      h("th", null, t("Paid orders")))),
      h("tbody", null, data.tables.map((r) =>
      h("tr", { key: r.tableId },
      h("td", null, t("Table {id}",{id:r.tableId})),
      h("td", null, r.count)))))) :
      h("p", { className: "floor-empty" }, t("No paid orders in this period."))),
      h("section", { className: "history-panel" },
      h("p", { className: "admin-eyebrow" }, t("PAYMENT ACTIVITY")),
      h("h2", null, t("Waiters")), data.waiters.length ?
      h("div", { className: "report-table-wrap" },
      h("table", { className: "report-table" },
      h("thead", null,
      h("tr", null,
      h("th", null, t("Recorded by")),
      h("th", null, t("Payments recorded")))),
      h("tbody", null, data.waiters.map((r, i) =>
      h("tr", { key: i },
      h("td", null, r.actor),
      h("td", null, r.count)))))) :
      h("p", { className: "floor-empty" }, t("No payments recorded in this period.")))));
  }
}
export {
  OperationalReports
};
