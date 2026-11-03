# Data model

Status: conceptual first model, not an approved schema. `[P]` marks proposed design; unresolved rules are in `../log/open-questions.md`. IDs are stable. Money uses integer minor units [P]; currency and rounding rules are open. Timestamps include a consistent instant; business-day boundaries and local time zone are not yet decided.

## Records and relationships

| Record | Main fields and relationships |
| --- | --- |
| Restaurant settings | Restaurant identity, configured currency/tax/charge settings, printer routes and business-day policy when defined. |
| User | ID, display name, active flag, credential reference/hash and assigned roles/grants. Employee names and credentials are personal/sensitive. |
| Role / permission / scope | Role and per-user grants for view and action, including A/B/combined financial scope. Permission administration authority is open (Q-01). |
| Dining area / table | ID, label, capacity, active flag and area. Preserve historical references. |
| Category / product | IDs, names, ordering, active flag, price, preparation destination and category links. |
| Modifier group / option | Product association, labels, selection constraints and price adjustments; precise behavior can evolve. |
| Business day | ID, start, close time, status and closing actor; boundary and later adjustment rules open. |
| Order | ID, table, business day, opening actor, timestamps and status. [P] At most one active order per table. |
| Order item | ID, current order, product reference plus name, unit price, tax context and modifier snapshots; quantity, notes, actor and state. Item notes may contain personal/sensitive data. |
| Send round / ticket / print job / attempt | Links to order and sent item quantities, preparation destination, target printer, job status, timestamps and attempt outcomes. Retry links to the existing job. |
| Bill / bill line | Order, immutable item and amount snapshots, totals, version/number and print state. Formal numbering and fiscal fields open. |
| Payment | Bill, amount, method, original account, recorded time, actor and status; effective account derives from valid corrections. |
| Refund | Original payment, amount, method, reason, actor, time and status; external terminal action recorded honestly. Procedure open. |
| Account correction | Payment, source and destination, actor, time, reason and business day. Preserve the original payment. |
| Audit event | Actor, time, action, entity, reason and relevant before/after context. May contain employee and financial data; restrict access. |

## States and transitions

These are proposed starting points, not final workflow decisions. Transitions must be validated in application logic and stored atomically where needed.

- **Table:** Free ↔ Taken, derived from active order; a print warning is not a table state.
- **Order:** [P] open → completed; an empty or abandoned order may need a separate recorded closure rule. Completion depends on the eventual payment workflow (Q-02).
- **Item:** [P] pending → sent → voided/corrected only by an authorized admin; pending items can be edited or removed with history. Moving changes its current order without copying its identity.
- **Print job:** [P] queued → attempted → confirmed, failed or uncertain; failed/uncertain → retry on the existing job. A printer response does not always prove physical output.
- **Bill and payment:** [P] bill draft → issued; payment not recorded → recorded, with refunds recorded separately. Exact confirmation, failure recovery and any additional states are open (Q-02, Q-05).
- **Business day:** [P] open → closed by an authorized actor; transition conditions and exceptional later corrections are open (Q-03).

## Invariants

- One full payment per bill in v1; no split or mixed tender. Card is always Account A; cash may be A or B. Classification is separate from printer routing.
- Transfer manager may correct eligible cash B to A before day close only; count the original payment once under its effective account. Do not infer bank transfers.
- A sent item, payment, refund or correction is not silently deleted. Preserve actors, original values and history; historical snapshots survive menu changes.
- A move cannot duplicate an active item, overwrite an order or move it to the same table. Use transactional changes and constraints; protect against repeated sends and payment submissions with stable request identifiers [P].
- Limit access to personal, financial, audit and credential data. The precise financial visibility policy and retention periods remain open.
