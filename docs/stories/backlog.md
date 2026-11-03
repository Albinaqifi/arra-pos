# Development backlog

Status: proposed backlog, 2026-11-03. Each story is intended for one development session. Scope and order can be adjusted as we learn; split a story if it cannot be completed and verified in a session. This is a development plan, not permission to use the app for real sales. Product rules come from the approved intent, architecture, `admin_requirements.md` and the waiter requirements; the later admin requirements override conflicts in the waiter document.

## How to use this backlog

- Start a session by naming one story ID. Read that story, its dependencies and relevant requirements; implement and verify only that story. Follow-up fixes necessary to finish it belong in the same session.
- Statuses are tracked only in [the board](../progress/board.md): **Todo**, **In progress**, **Done**, **Blocked**. Unlisted stories are Todo. Mark a story done only after its acceptance criteria and required review/testing pass; when a pull request is used, mark it done after merge. Record evidence and remaining issues in the handoff.
- For every story: run relevant automated checks and verify the changed flow; preserve existing behavior and data; report what changed, how it was checked, and anything unfinished. Add meaningful tests for financial, access and data-integrity rules. No live customer or financial data until the production-readiness stories are complete.
- Dependencies are prerequisites, not a promise that a story must immediately follow the preceding number. Estimates in sessions are planning targets, not guarantees. `[P]` denotes a proposed implementation choice, not a new business decision.
- Q references point to [open questions](../log/open-questions.md). Deferred details should not block unrelated foundation work. If a later story depends on an unresolved rule, capture a proposed approach and work on independent stories rather than inventing the answer.

## Milestone 1 — Offline foundation and real orders

**Outcome:** A local app saves and restores sample table orders without internet. It is a development build, not a production POS. Verify the complete flow after S-008.

### S-001 — Start the desktop app
**As a developer**, I can open the existing React interface in a local desktop window so the app can run without internet. **Depends on:** none. **Acceptance:** the app starts locally with internet disconnected; the existing demo remains accessible; startup and any required commands are documented; no remote login or external runtime asset is required. [P] Prove the Electron approach without implementing business features.

### S-002 — Set up the local database
**As a developer**, I can create and upgrade a SQLite database so data survives application restarts. **Depends on:** S-001. **Acceptance:** the database is stored in a documented writable app-data location, not bundled code; versioned migrations create and upgrade a database without erasing existing records; reopening the app preserves test data; initialization failures show a useful error. Test a fresh database and an upgrade.

### S-003 — Connect screens to local application services
**As a developer**, I can request data through a controlled desktop bridge so screens cannot access the database or operating system directly. **Depends on:** S-002. **Acceptance:** a small typed/validated request and response round trip works offline; the UI has no raw database or unrestricted Node access; invalid requests fail safely; a test covers the boundary. [P] Use a minimal health or application-info request.

### S-004 — Persist tables
**As a waiter**, I can see saved restaurant tables after restarting the app. **Depends on:** S-003. **Acceptance:** a repeatable development setup creates sample tables without duplicates; the table grid reads persisted data and handles an empty list; table identities remain stable after restart. Editing tables belongs to S-012.

### S-005 — Persist a sample menu
**As a waiter**, I can browse saved sample products instead of browser-only demo data. **Depends on:** S-003. **Acceptance:** categories and products have stable IDs, names, prices and active flags; a repeatable sample setup avoids duplicates; active products appear after restart and inactive ones do not appear for ordering. Full menu editing and modifiers come later.

### S-006 — Open an order on a table
**As a waiter**, I can open a table order and return to it later. **Depends on:** S-004. **Acceptance:** opening a free table creates one persistent active order; reopening a taken table returns the same order; only Free and Taken appear; repeated open requests do not produce two active orders for the same table. Verify restart and the duplicate-open rule.

### S-007 — Add and remove pending items
**As a waiter**, I can add sample menu items to an order and remove them before sending. **Depends on:** S-005 and S-006. **Acceptance:** items, quantities and price/name snapshots persist after restart; totals use consistent integer money values [P]; pending items can be removed; invalid product/order input is rejected. Sending, payment and admin menus are out of scope.

### S-008 — Add item notes and verify the first slice
**As a waiter**, I can add a note to an unsent item and resume the order after restarting. **Depends on:** S-007. **Acceptance:** a note is saved and editable before send; an offline run can open a table, add items and a note, restart and recover the same order; empty and save-error states are understandable. Note text is not written to routine logs. Record the end-to-end verification.

## Milestone 2 — Staff access and configuration

**Outcome:** Staff use identifiable local accounts and authorized admins can configure the basics. Financial scope administration must respect Q-01; sample-only development can continue independently.

### S-009 — Local sign-in and session
**As a staff member**, I can sign in locally so actions have an identity without internet. **Depends on:** S-003. **Acceptance:** local credential verification uses salted password/PIN hashes, never plaintext; invalid credentials fail without exposing secrets; deactivated users cannot sign in; sign-out clears the active session; tests cover successful and failed sign-in. [P] Provide controlled development bootstrap without a shipped default production password.

### S-010 — Enforce permissions in application services
**As an owner**, I need protected operations checked outside the screen. **Depends on:** S-009. **Acceptance:** the service rejects unauthenticated and unauthorized requests even when invoked directly; view and change permissions are distinct; tests cover allowed and denied actions; the UI does not expose privileged capabilities through an unrestricted bridge. Initial roles may be seeded [P].

### S-011 — Select and switch waiter
**As staff**, I can select a waiter and switch identity on the shared PC. **Depends on:** S-009 and S-010. **Acceptance:** active waiter names are listed after restaurant sign-in; configured PIN behavior is enforced; switching replaces the active identity; inactive staff cannot be selected; subsequent actions use the selected identity. Optional PIN attribution limits are made clear in development documentation.

### S-012 — Manage dining areas and tables
**As an authorized admin**, I can configure areas and tables. **Depends on:** S-004 and S-010. **Acceptance:** create, edit and deactivate tables/areas and set capacity; denied users cannot change them; changes persist and historical references remain readable; an active order is not silently lost when a table is changed or deactivated.

### S-013 — Manage menu categories and products
**As an authorized admin**, I can maintain categories, products and prices. **Depends on:** S-005 and S-010. **Acceptance:** create, edit, order and deactivate categories/products; waiter menu reflects active configuration; existing order snapshots do not change; unauthorized edits fail. Subcategories can use the same hierarchy [P].

### S-014 — Configure and select modifiers
**As an admin and waiter**, I can configure product choices and select them when ordering. **Depends on:** S-013 and S-007. **Acceptance:** authorized admin can configure groups/options, required/optional rules and price adjustments; waiter sees configured choices in a grid; invalid selections are rejected by services; selected labels and prices persist on the order. Detailed limits use a reversible proposed default (Q-14).

### S-015 — Manage employees and permissions
**As an authorized admin**, I can create, deactivate and configure staff accounts. **Depends on:** S-010 and S-011. **Acceptance:** accounts and granted actions can be maintained without code changes; credentials are set/reset securely; deactivated users lose access; unauthorized changes are rejected and permission changes are attributable. Cross-owner financial grant authority remains blocked by Q-01; retain the existing A/B restrictions until resolved.

## Milestone 3 — Service workflow and history

**Outcome:** Waiters can send rounds and move orders with traceable history. Physical printing remains separately scheduled.

### S-016 — Record meaningful actions
**As an admin**, I can trace important changes to an actor and time. **Depends on:** S-009 and S-007. **Acceptance:** a protected append-only application audit records item additions/removals and subsequent supported material actions with relevant context; ordinary waiters cannot change history; secrets and PINs are excluded; action and associated change are saved together where appropriate. Extend coverage as later stories add actions.

### S-017 — Send a preparation round
**As a waiter**, I can send pending items as a preparation round. **Depends on:** S-008, S-011 and S-016. **Acceptance:** one send records a round and kitchen/bar ticket records for configured destinations; only newly pending items appear in the next round; sent items remain on the order and cannot be edited or removed by waiters; repeated requests do not duplicate items or rounds. Use a simulated printer adapter [P], clearly labeled.

### S-018 — Record print jobs and retry state
**As a waiter**, I can see and retry an unsuccessful preparation ticket without losing the order. **Depends on:** S-017. **Acceptance:** jobs and attempts are separate from orders; simulated failure/uncertain results are visible; retry refers to the original job and creates no extra sale items; uncertain output is not presented as confirmed. No real printer support is claimed.

### S-019 — Move a whole order
**As a waiter**, I can move an order to another table without losing its history. **Depends on:** S-017. **Acceptance:** a valid move changes the order's table, frees the source and marks destination Taken; same-table and occupied-destination moves cannot overwrite an order; actor, source, destination and time are recorded; retries do not duplicate the order.

### S-020 — Move selected items
**As a waiter**, I can move selected items between tables while keeping their history. **Depends on:** S-019. **Acceptance:** moved items retain IDs and appear in only one active order; invalid or already-moved selections are rejected; an occupied destination is never overwritten; history includes actor, source and destination; source-table state follows remaining active order. Quantity/merge details use reversible defaults (Q-13).

### S-021 — Admin correction of sent items
**As an authorized admin**, I can record a correction to a sent item. **Depends on:** S-017 and S-010. **Acceptance:** waiters cannot edit/remove sent items; an authorized admin can record a reasoned correction or void without deleting the original item or preparation history; actor, quantity and time are recorded; billable totals reflect the valid correction. Handling after payment remains for S-029.

### S-022 — View order and activity history
**As an authorized admin**, I can inspect an order's history. **Depends on:** S-016, S-019 and S-021. **Acceptance:** view order details and timeline of additions, sends, moves and corrections with actor and time; access is checked in application services; no other owner's protected financial details are exposed. Payment/print events appear when their stories are complete.

## Milestone 4 — Billing and financial controls

**Outcome:** A test-mode full-payment flow with protected account classification and traceable corrections. Real-world use remains blocked by fiscal/provider and recovery work.

### S-023 — Review and generate a bill
**As a waiter**, I can review a table's bill before recording payment. **Depends on:** S-017 and S-021. **Acceptance:** summary includes eligible items across rounds, modifiers, snapshots and valid corrections; declining confirmation changes nothing; bill and lines are stored separately from payment and printing; no split bill or partial tender is offered. Tax and fiscal specifics remain unverified (Q-07).

### S-024 — Record one full payment
**As a waiter**, I can record a full cash or separate-terminal card payment in test mode. **Depends on:** S-023. **Acceptance:** cash selects A or B; card is always A and service rejects card-to-B on direct requests; exactly one full payment can be recorded for a bill despite retries; payment recording is separate from print success; completed workflow closes the table without losing history. Use sample data only until Q-02 and readiness are addressed.

### S-025 — Protect financial visibility
**As an owner**, I see only the financial data allowed for my account. **Depends on:** S-024 and S-010. **Acceptance:** A cannot access B-only financial information and vice versa through screens or direct requests; combined account sees both when authorized; automated tests cover records, search and aggregates; uncertain shared-data exposure defaults to the documented restrictions. Configurable exceptions remain subject to Q-01.

### S-026 — Record business day and close
**As an authorized admin**, I can close a business day and preserve its history. **Depends on:** S-024 and S-010. **Acceptance:** close records day, actor and time; only authorized users can close; closed status persists; outstanding orders/print issues are shown rather than silently discarded; transfer-manager post-close correction is rejected. Exact day boundaries and unresolved handling are deferred to Q-03; keep the policy replaceable.

### S-027 — Restricted account correction
**As a transfer manager**, I can correct an eligible cash payment from B to A. **Depends on:** S-025 and S-026. **Acceptance:** separately authenticated restricted role can find eligible payments and record a correction with actor/time and reason [P]; card-to-B, A-to-B, repeated and post-close corrections are rejected by services; original payment is preserved and totals count it once under the effective account; ordinary waiter/admin actions are inaccessible to this role.

### S-028 — Payment and bill history
**As an authorized admin**, I can review bills, payments and corrections. **Depends on:** S-025 and S-027. **Acceptance:** history connects order, bill, original payment and corrections with actors and times; account scope applies to search, details and totals; original and effective classification are traceable without duplicate sales; empty results are clear.

### S-029 — Record refunds
**As an authorized admin**, I can record a refund against an original payment. **Depends on:** S-024, S-025 and S-016. **Acceptance:** refund preserves the payment and records amount, reason, actor, method and time; unauthorized requests and amounts exceeding eligible payment are rejected; card-terminal action is never falsely described as processed by the POS; reports distinguish refunds from sales. Final procedure/amount policy requires Q-02/Q-05 before real use.

## Milestone 5 — Operations, reporting and launch readiness

**Outcome:** Reports, recoverability and real integrations are verified before live use. Provider and legal investigation can occur independently of earlier development.

### S-030 — Sales and payment reports
**As an authorized admin**, I can review sales by period, account and method. **Depends on:** S-028 and S-029. **Acceptance:** filter by business day/date and allowed financial scope; show sales, corrections and refunds separately; corrected payments count once; results reconcile with underlying records and enforce scope on direct requests. Define final accounting terms before relying on figures (Q-15).

### S-031 — Product, table and waiter reports
**As an authorized admin**, I can inspect operational activity and product performance. **Depends on:** S-022 and S-024. **Acceptance:** display product quantity/value, table usage and waiter activity over a selected period from structured records; respect permissions and financial scope; definitions for multi-waiter/moved tables are labeled as provisional until resolved.

### S-032 — Backup and restore
**As an owner**, I can recover a consistent database after a PC failure. **Depends on:** S-002. **Acceptance:** produce a consistent backup using a database-safe method while the app is operating; store a protected copy separately from the live database; restore onto a clean test location and verify orders/users; failure is visible and credentials are not exposed. Document the procedure. Final schedule/location can evolve (Q-12).

### S-033 — Investigate fiscal and printer provider requirements
**As the developer**, I know what real integration must do before committing to it. **Depends on:** none. **Acceptance:** record provider documentation/contact findings, models or interfaces when available, relevant North Macedonia requirements to verify, open unknowns and a recommended integration approach; distinguish verified facts from assumptions. No live-payment or compliance claim is made. Q-06/Q-07 may block completion until provider information is available, but do not block earlier stories.

### S-034 — Integrate preparation printing
**As a waiter**, I can send preparation tickets to the configured real printer. **Depends on:** S-018 and S-033. **Acceptance:** configured kitchen/bar routing sends only the appropriate round; failures and uncertain outcomes are visible; retry/backup follows the chosen hardware procedure without duplicating order data; test with actual supported hardware. Fiscal receipt integration is separate.

### S-035 — Integrate bill and fiscal output
**As staff**, I can produce the required customer output through the supported provider equipment. **Depends on:** S-023, S-024 and S-033. **Acceptance:** verified provider and jurisdiction requirements are documented and implemented; cash A/B and card A route as required without changing financial classification; output failures preserve payment/order state and have a safe recovery path; actual hardware and relevant local requirements are verified. Split further when provider details are known.

### S-036 — Package, restore and pilot readiness
**As an owner**, I can install and safely evaluate a release on the restaurant PC. **Depends on:** S-015, S-025, S-032, S-033, S-034 and S-035; complete other required stories for the chosen pilot scope. **Acceptance:** installation, startup and core operations work offline on the target PC; no development/default credentials are shipped; backup and restoration are demonstrated; permissions and payment rules are checked with realistic scenarios; known limitations and a rollback/support procedure are documented; required fiscal/legal and provider checks are completed before real sales. Split packaging and pilot verification into separate stories if needed.

## Suggested next session

Start **S-001 — Start the desktop app**. It creates the offline desktop foundation while preserving the current demo. The first session does not build the database, payments, accounts or printers.

