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
**As an authorized admin**, I can record a correction to a sent item. **Depends on:** S-017 and S-010. **Acceptance:** waiters cannot edit/remove sent items; an authorized admin can record a reasoned correction or void without deleting the original item or preparation history; actor, quantity and time are recorded; billable totals reflect the valid correction. Post-payment handling is not defined by this story.

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
**Retired:** The owner confirmed that there will be no refunds (D-011). Fiscal reversal obligations remain to be verified under Q-07.

## Milestone 5 — Operations, reporting and launch readiness

**Outcome:** Reports, recoverability and real integrations are verified before live use. Provider and legal investigation can occur independently of earlier development.

### S-030 — Sales and payment reports
**As an authorized admin**, I can review sales by period, account and method. **Depends on:** S-028. **Acceptance:** filter by business day/date and allowed financial scope; show sales and corrections separately; corrected payments count once; results reconcile with underlying records and enforce scope on direct requests. The owner directed proceeding without refunds; refund recording and reporting are out of scope. Define final accounting terms before relying on figures (Q-15).

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

## Milestone 6 — Designed administration experience

**Outcome:** Replace the plain, browser-default presentation of the existing administration features with a coherent, finished desktop experience. These are implementation stories, not mockups: connect the designed screens to the existing local services and preserve their current behavior. Use the waiter interface as a visual starting point while making administration easy to scan and operate on the shared PC. Native semantic HTML controls are fine, but their appearance and layout must be intentionally designed rather than left as browser defaults.

For every story in this milestone: use a consistent visual language, clear hierarchy, readable labels and appropriately sized controls; support keyboard operation, visible focus and accessible names; handle loading, empty, denied, validation, success and failure states where applicable. Keep navigation and data usable at the target desktop window size and when resized. Verify the real Electron flow with sample data as well as appropriate automated checks, and record what was actually verified. Do not invent dashboard figures, financial definitions, new privileges or hardware functionality; preserve trusted-service authorization, account scope, audit history, retry behavior and offline operation. Do not expose secrets or another owner's data. If a required capability is unavailable to the signed-in identity, show an appropriate access state rather than bypassing its service restrictions. The S-031 board status requires a post-merge update; its merge is present in local history.

For future end-to-end automation, each builder should document a few concise scenarios in the story handoff: sample setup, user actions and expected outcome, including an appropriate denied or failure case. Record which scenarios were actually exercised and their results. Use sample data; no E2E framework or automated E2E suite is required by these stories.

### S-037 — Administration navigation and visual foundation
**As an authorized administrator**, I can find the available administration areas in a consistent, polished desktop layout. **Depends on:** S-010, S-012, S-013, S-015 and S-025. **Acceptance:** replace the row of plain administration links with an intentional, coherent navigation and page shell that fits the existing product; provide clear entry, return and current-location cues without weakening the existing sign-in or identity checks; link to the existing areas, menu, employees, order history, financial information and operational reports flows; make unavailable or denied access understandable without implying access has been granted. Establish reusable styling and components for the following stories, including buttons, form fields, status messages and confirmation surfaces. Do not present unimplemented dashboard metrics or create a new authentication mechanism. Verify navigation, identity switching and denied access in the desktop app.

**E2E scenarios to document:** navigate between permitted areas and return to tables; switch identity and verify restricted areas and stale data are inaccessible.

### S-038 — Designed areas and tables management
**As an authorized administrator**, I can configure the floor through a clear, finished interface. **Depends on:** S-012. The owner authorized S-038 to proceed while S-037 desktop verification remains outstanding; coordinate with its existing administration shell. **Acceptance:** design the area and table lists and create/edit flows, including capacity and active state, with clear relationships between areas and tables; make validation, saving, deactivation and the existing open-order restriction understandable; reflect saved changes on returning to the table grid. Preserve stable identities, existing authorization and historical references. Verify create, edit, deactivate, denied and open-order cases using sample data.

**E2E scenarios to document:** create and edit an area and table, then check the waiter grid; attempt to deactivate a table with an open order and confirm the order remains intact.

### S-039 — Designed menu and modifier management
**As an authorized administrator**, I can maintain the menu and product choices without navigating unstyled forms. **Depends on:** S-013, S-014 and S-037. **Acceptance:** design the category and subcategory hierarchy, product list and editing flows for names, prices, ordering, activation and preparation destination; provide clear management of modifier groups, required/optional choices, options and price adjustments; show validation and save outcomes. Preserve existing selection limits, snapshots, routing semantics and service authorization. Verify representative category, product and modifier edits and the resulting waiter menu with sample data.

**E2E scenarios to document:** configure a product and required modifier, then order it as a waiter; change the menu and verify the earlier order snapshot stays unchanged.

### S-040 — Designed employee and permission management
**As an authorized administrator**, I can manage staff and their existing operational permissions confidently. **Depends on:** S-015 and S-037. **Acceptance:** design employee selection, creation, editing, activation, credential reset, grants and existing change-history views; group and label permissions in language staff can understand while retaining the distinction between viewing and changing; make sensitive actions, validation and save results clear without displaying or retaining credentials unnecessarily. Preserve service checks, session invalidation, audit behavior and last-administrator protection. Do not add financial-scope grants or decide Q-01. Verify allowed and denied actions, reset and deactivation with sample identities.

**E2E scenarios to document:** create a sample employee, grant and revoke an action, and verify the resulting access; reset or deactivate an account and verify access changes and history.

### S-041 — Designed order history and sent-item corrections
**As an authorized user**, I can understand an order's operational history and record an eligible correction through a finished interface. **Depends on:** S-021 and S-022. Use the existing S-037 shell; the owner authorizes this story to proceed while S-037's separate desktop verification remains outstanding. **Acceptance:** design the existing order list, detail, item and activity timeline, including moves, sends and simulated print attempts; replace raw event property dumps with readable descriptions and clearly indicate the existing privacy and access limits. Design the existing sent-item correction interaction with quantity, reason, confirmation and error states; preserve the original history and trusted-service checks. Do not add post-payment corrections or expand owner access while shared-history policy is unresolved. Verify navigation, history across moves, allowed and denied corrections and failure states with sample data.

**Design and structure:** Give the order list a scannable layout with clear status, table and time; make order details, current items and a chronological, readable activity timeline distinct. Make the correction action and its quantity, reason, confirmation and result understandable in context. Build cohesive JSX screen and flow components in appropriate modules, including the existing correction entry point; reuse the administration shell and shared controls/styles where suitable. Do not add the entire implementation to `App.js` or a single catch-all component. Preserve service boundaries and history.

Apply the [shared implementation and review expectations](#implementation-and-review-expectations-for-s-041s-043).

**E2E scenarios to document:** send and move items, then inspect their timeline; record an authorized correction and verify its history, and check that an unauthorized user cannot correct it.

### S-042 — Designed financial history and business-day close
**As an authorized administrator**, I can inspect the financial information available to me and close a business day through a clear, finished interface. **Depends on:** S-025, S-026 and S-028. Use the existing S-037 shell; the owner authorizes this story to proceed while S-037's separate desktop verification remains outstanding. **Acceptance:** design the existing scoped payment list, totals, bill/payment detail, unpaid-bill and correction history views; distinguish original and effective account and make clear that a correction is not a second payment. Design the existing business-day view, outstanding issues and close confirmation, including the effect on transfer-manager corrections. Preserve scope on records, totals and details; do not imply a real fiscal receipt, invent accounting definitions or expose unclassified bills beyond existing authorization. Verify A, B and combined sample identities, corrected payments, denial and close behavior.

**Design and structure:** Provide scannable scoped totals and payment/unpaid lists, a legible bill and payment detail with correction history, and a distinct business-day section showing outstanding issues before a clear close confirmation. Use cohesive JSX components and modules for the history, details and business-day flow; reuse the shell and shared controls/styles where suitable. Do not put the whole screen and close flow in one catch-all component or `App.js`. Preserve existing service calls, authorization and financial semantics.

Apply the [shared implementation and review expectations](#implementation-and-review-expectations-for-s-041s-043).

**E2E scenarios to document:** inspect sample payments as A, B and combined users, including a corrected payment; close a day with outstanding issues and verify the recorded close and correction cutoff.

### S-043 — Designed operational reports and restricted transfer flow
**As an authorized user**, I can read existing operational reports or perform the restricted transfer-manager task in a coherent, finished interface. **Depends on:** S-027 and S-031. Use the existing S-037 shell for reports; the owner authorizes this story to proceed while S-037's separate desktop verification remains outstanding. **Acceptance:** design report date selection, product, table and waiter results and empty/error states, retaining the existing provisional counting definitions and financial scope. Separately design the transfer manager's table selection, eligible payment list and B-to-A correction confirmation, making the open-day restriction and optional reason clear; this restricted identity must not gain administration or waiter navigation. Preserve single-count totals, retry safety and service authorization. Verify representative reports and transfer success, denied, repeated and closed-day cases with sample data. Sales reports remain S-030 and are not invented here. Split this story if the two flows do not fit one session.

**Design and structure:** Make the date range and report definitions clear and present product, table and waiter results as distinct scannable sections. Give the transfer manager a separate focused layout for choosing a table, reviewing eligible payments and confirming a correction, with visible outcomes. Implement the report and transfer flows as separate cohesive JSX modules, moving the transfer presentation out of `App.js`; reuse appropriate controls/styles without giving the restricted identity admin navigation. Keep service authorization and retry handling intact.

Apply the [shared implementation and review expectations](#implementation-and-review-expectations-for-s-041s-043).

**E2E scenarios to document:** filter reports for a sample period and verify scoped results; correct an eligible cash payment once and verify repeat and closed-day attempts fail.

### Implementation and review expectations for S-041–S-043

Before coding, inspect the existing waiter UI, administration shell, completed management screens, shared styles and the existing flow. Use them as visual and interaction references. Give each screen a deliberate layout, hierarchy, spacing and typography; use styled controls, readable lists or tables, status indicators and confirmation surfaces appropriate to the task. Native semantic elements are welcome, but an unstyled list of controls is not a finished design. Handle loading, empty, denied, validation, success and failure states where applicable, with accessible names, keyboard operation and visible focus. Make the target desktop size and a resized window usable.

Use JSX for new or substantially redesigned presentation, organize related views and interactions into cohesive modules, and reuse existing components and styles when they fit. Extract distinct flows and repeated UI where useful without introducing a new framework or unnecessary abstractions. Keep business rules and authorization in trusted services; do not change existing contracts or data for presentation convenience. Include relevant focused tests and the story's required direct-request, financial and failure checks.

Verify the real Electron flow on the available machine with synthetic data, including representative states, keyboard/focus and resizing, and record exactly what was exercised and any limitations in the handoff. A different machine is not required for these stories or S-037. If desktop verification cannot be performed, do not claim it passed; record the limitation and follow the workflow's completion rules. Reviewers must assess the actual visual result and component organization as well as behavior, and return an incomplete design or tangled implementation for correction. A separate-device recovery exercise is an unresolved S-032 readiness requirement, not a prerequisite for these UI stories.

## Milestone 7 — Application transformation

The rationale, priority order, readiness work and owner decisions are in [the application transformation plan](../app-transformation.md). These stories are independent sessions, not authorization to implement the whole milestone at once. Preserve all existing data, service contracts, offline operation, authorization, financial rules, retries and history. Use the board for status. Coordinate with S-038–S-043 to avoid repeating administration work.

### S-044 — JSX and local build foundation
**Goal:** Introduce a conventional, minimal React build with JSX and migrate one small existing component without redesigning the app. **Depends on:** the existing desktop foundation. **Scope:** install and lock the necessary build dependencies; build locally into Electron-compatible assets; adapt the relevant entry points and tests; preserve the current desktop bridge and a documented development path. Do not migrate all screens, change database/business rules, or require a development server or network in the built app. **Acceptance:** a clean dependency install and documented build produce local assets; a representative component uses JSX in its own module; Electron loads the built UI offline with local assets and the bridge; existing behavior and applicable tests pass. **Checks/review:** build and appropriate automated tests, plus an actual offline Electron smoke check with sample data; review asset paths, CSP and packaging implications. **Risk:** file-URL asset resolution and existing tests that evaluate `App.js` directly. If desktop verification cannot be performed, record the exact limitation rather than claiming it passed.

### S-045 — Extract administration screens
**Goal:** Move administration shell and screens into understandable modules, preserving behavior and existing service calls. **Depends on:** S-044. **Scope:** split into smaller stories if needed; coordinate with S-038–S-043. **Acceptance:** navigation, loading, denied and return states work; waiters cannot see admin navigation or access admin services directly; admins remain limited to granted actions and financial scope; identity changes do not expose stale protected data. **Checks/review:** focused renderer and direct-request authorization tests and sample-data Electron navigation and identity-switch checks. **Risk:** stale asynchronous responses or inadvertently broadening access.

### S-046 — Extract table and order workflows
**Goal:** Separate table selection and waiter order, send and move views from the monolithic component. **Depends on:** S-044. **Scope:** extract incrementally, preserving the waiter’s normal workflows and trusted service contracts; split further if needed. **Acceptance:** table/order state, restart persistence, send/move retries, loading and failure handling behave as before; no duplicate items or lost history. **Checks/review:** focused renderer and service tests and a representative sample-data Electron flow. **Risk:** stale state or duplicate operations when asynchronous requests resolve.

### S-047 — Extract billing and payment presentation
**Goal:** Isolate bill review and payment screens while keeping all financial decisions in trusted services. **Depends on:** S-044; coordinate with S-046 if it changes the same code. **Acceptance:** card is A; the same payment retry never creates a second POS payment; uncertain responses retain the selection and have a clear recovery path; existing bill, payment and correction history is preserved. **Checks/review:** direct invalid requests, repeated and concurrent submissions, rollback and renderer uncertainty tests; review the financial change and check the desktop flow with sample data. **Risk:** confusing a POS record with a separate terminal outcome or changing retry behavior.

### S-048 — Separate the browser demo
**Goal:** Isolate simulated browser behavior from real desktop workflows, or retire the demo after the owner chooses. **Depends on:** S-044; coordinate with S-045–S-047. **Acceptance:** desktop failures cannot silently fall back to sample data or simulated actions; any retained demo is clearly labeled and its startup documented. **Checks/review:** desktop empty/error states, local startup and chosen demo path. **Risk:** inadvertently presenting simulation as a real operation. **Owner decision:** retain or retire the browser demo before removing it.

### S-049 — Simplify shared frontend code
**Goal:** Extract only repeated controls, styles and request-handling patterns demonstrated by the screen work. **Depends on:** S-045–S-047. **Acceptance:** shared code has clear interfaces; screen behavior and accessibility are preserved; no unnecessary framework or broad redesign is introduced. **Checks/review:** focused UI tests and representative desktop checks. **Risk:** abstractions can obscure behavior rather than simplify it.

### S-050 — Harden production identity and access
**Goal:** Establish suitable failed-attempt controls, session locking, account provisioning and recovery for a shared Windows PC. **Depends on:** S-009, S-010 and S-015; relevant owner policy decisions. **Acceptance:** direct unauthorized requests fail; revocation and deactivation take effect; recovery does not silently grant financial privileges; credentials are not logged or exposed; waiter, admin and restricted transfer access remain distinct. **Checks/review:** invalid and repeated sign-ins, lockout/recovery, revocation, role and direct-request tests; security-focused review. **Risk:** weak attribution or locking legitimate staff out. Resolve PIN and recovery authority with the owner; do not infer cross-owner grant authority (Q-01).

### S-051 — Safe upgrades and database durability
**Goal:** Rehearse release upgrades, recovery and failure handling against representative existing data. **Depends on:** S-052 and selection of the release runtime; coordinate with S-036. **Acceptance:** historical migrations remain intact; representative orders, payments, corrections and history survive upgrade; interrupted or failed upgrade leaves a recoverable original; newer databases are not silently opened by older code; disk-full and related failures are visible. Document a safe pre-upgrade backup and rollback procedure. **Checks/review:** fresh and historical migration fixtures, injected failures, integrity and recovery checks, independent review. **Risk:** irreversible schema changes or loss of data after an attempted rollback.

### S-052 — Verify local backup and restore
**Goal:** Complete the feasible Windows interactive backup and isolated GUI restore exercise using sample data, without requiring removable storage. **Depends on:** existing S-032 backup implementation. **Acceptance:** a database-safe backup is created while the sample app is operating; restore into a clean isolated local location preserves known sample orders and users; failure is visible and the source remains untouched; document actual results and unresolved limitations. **Checks/review:** focused backup tests, interactive Windows procedure and independent review of any fixes. **Risk:** a local copy does not protect against loss of the PC; temporary plaintext and passphrase handling need care. This story does not satisfy S-032's separate protected copy or separate-device recovery requirement; complete those when storage is available and before live use.

### S-053 — Retire moving selected items
**Goal:** Let waiters move a whole order to another table without offering a separate action to move selected items. **Depends on:** S-019 and S-020. The owner requested this retirement for S-053.

**Acceptance:** the waiter interface and retained demo do not offer selected-item moves; new selected-item moves cannot be initiated through the desktop application service or bridge, including direct requests; whole-order moves continue to work with their existing destination, authorization, retry and history safeguards. Existing orders and historical item-move audit and activity records remain intact and readable; preserve historical migrations. Remove obsolete active UI and service code where safe, retaining any code needed to interpret historical records.

**Checks/review:** verify the waiter flow and whole-order moves, direct item-move requests, and an existing item-move history fixture; review data preservation and retry behavior. **Risk:** existing whole-order moves require a free destination, so this does not merge orders at occupied tables.

### S-054 — Keep an untouched table free after leaving it
**Bug:** Select a free table, then return to the table list without adding or sending anything. The table appears orange and Taken even though no order was made.

**Expected:** The untouched table remains Free when returning to the list, including after reopening the app. A table with an actual order remains Taken and its items and history are preserved. Reopening an untouched table should work normally without accumulating duplicate active orders.

**Checks/review:** Reproduce the reported desktop flow with sample data; verify the free status after returning and restarting, and verify that leaving a table with pending or sent items still preserves the order and shows Taken. Check the relevant service and renderer behavior, including a failed save or cleanup if applicable.

### S-055 — Return to waiter selection after sending or completing a bill
**Goal:** After a waiter successfully sends an order or completes the final payment step of a bill, show the waiter selection screen so the next user can select their name.

**Acceptance:** A confirmed successful Send Order returns to waiter selection; a confirmed successful final bill/payment action also returns there. The next user can select a waiter normally. Keep the existing send, printing, billing, payment, permissions and retry behavior unchanged; the navigation change must not cause another send or payment. Failed or uncertain actions retain their existing error and recovery flow rather than navigating away. Preserve any existing warnings, including pending items or print issues, so they remain visible and actionable.

**Checks/review:** Verify both successful paths with sample data and waiter reselection; check failed and uncertain responses, a send with a print issue or remaining pending items, and retry behavior. Confirm no duplicate send or payment and no change to existing financial rules.

### S-056 — Test kitchen, bar and bill printing on one printer

**Goal:** Test actual output from the desktop app using sample orders and bills. Keep three separate logical destinations—kitchen, bar and bill—with independently changeable Windows printer queue identifiers. Initially map all three to `Arra Test Printer`; later they can be mapped to different printers without changing the order or bill workflows. This is a test-mode experiment, not fiscal integration or approval for live sales.

**Depends on:** S-018 and S-023. This limited sample-only hardware test may proceed while S-033 remains blocked; it does not complete or replace S-033, S-034 or S-035.

**Acceptance:**

- Provide a clearly labeled test-mode configuration for each destination, persisted across restarts and validated in trusted application code. The three mappings can share a queue or be changed independently; the named queue is an initial test setting, not a hard-coded production assumption. Explain how to select or change the queues.
- Sending a sample order produces separate kitchen and bar tickets using the existing item routing and the newly sent round only. Each ticket identifies its destination, table and round, and includes the relevant quantities, item names, modifiers and notes where available. A mixed order must not leak bar items onto the kitchen ticket or vice versa, even when both use the same physical printer.
- Provide a clearly marked **test bill, not a fiscal receipt** print from an existing generated sample bill, with its saved lines, modifiers and total. Keep the bill destination separate from the preparation destinations. Printing or reprinting must never create a bill, payment, sale or charge, or change A/B classification; card remains A. Enforce existing permissions and financial visibility.
- Record distinct print jobs and attempts, preserving existing order, ticket, bill and payment history. Send to the configured local Windows queue offline. A queue acceptance is not proof that paper was printed; expose failed and uncertain outcomes and an explicit operator check before retrying uncertain output. Retries refer to the original job and do not duplicate order or payment data. Handle missing queues, disconnected printers, paper issues and interrupted/restarted app without silently claiming a physical print succeeded.
- Verify on the owner's connected Birch device using the `Arra Test Printer` Windows queue: a mixed sample order prints separate kitchen and bar tickets and a generated sample bill prints separately; inspect paper for routing, content and readability. Verify that changing one destination does not change the others, including a test with different queue identifiers or controlled fakes. Record the actual hardware results and any limitations; do not claim a separate-physical-printer test until those devices are available.

**Checks/review:** Focused tests for routing, snapshots, permissions, bill/payment invariants, repeated requests, failures and uncertain recovery, plus an offline desktop and physical-printer test with sample data. Review persistence and safe failure handling. Document Windows setup, test mode, queue mappings and later separate-printer test steps. Actual fiscal output and provider/legal verification remain separate.

### S-057 — Daily detailed turnover

**Goal:** As an authorized administrator, I can review detailed turnover for a system day in Financial Information.

**Depends on:** S-024, S-025, S-026, S-028 and S-030.

**Acceptance:**

- A system day runs from its start until an authorized admin closes it, with no fixed time limit; it can continue past midnight. Closing it automatically starts the next system day. Show running turnover for the open day and allow completed days to be reviewed with their start and close times. Before confirmation, show the authorized admin the day's scoped turnover and outstanding orders.
- Base turnover on recorded paid bills. Show totals by payment method and permitted account, and a detailed payment list with time, table, waiter, amount and method. Allow inspection of the associated bill details within the user's scope.
- Account A sees only A turnover; account B sees only B turnover; an authorized combined account sees A and B turnover and transfer details. Enforce the same scope for totals, lists, details and direct requests in trusted application code.
- Show transfers/corrections to authorized combined users with their history. Count each payment once under its effective account; a transfer is not another payment. Preserve the original payment and correction history, and retain the rule that card belongs to A.
- Work offline and preserve existing records. Clearly handle an empty day and unavailable data. Do not present the report as a fiscal or finalized accounting report; final accounting definitions remain subject to Q-15.

**Checks/review:** Use sample data to verify a day spanning midnight, running and closed-day results, automatic next-day start, repeated close requests and failure recovery, cash and card, a B-to-A transfer, reconciliation to underlying payments, and direct-request denial for A and B across totals and details. Check persistence across restart and review financial and authorization behavior. Resolve any necessary historical-day handling before implementation.

### S-058 — Print daily turnover when closing the system day

**Goal:** When an authorized admin closes the system day, automatically print a report listing its paid bills and total turnover on the restaurant printer.

**Depends on:** S-026, S-056 and S-057. This is a non-fiscal report; fiscal closing and fiscal output remain separate and subject to S-033 and S-035.

**Acceptance:**

- Closing the day creates a durable report and print job for that closed day and automatically attempts to print it. The report identifies the day and its opening and closing times, lists each paid bill with its number, time, table and amount, and shows the total. The list and total reconcile to the day's recorded payments; each payment counts once under its effective account, including corrected payments.
- Closing and report creation must not duplicate payments or close multiple days on repeated requests. Preserve the closed day's report and history across restarts. A print failure or uncertain outcome must be visible and must not undo or repeat the day close. Allow an authorized user to retry the original report; when output is uncertain, ask the operator to check the printer before retrying.
- Enforce the existing close and financial-scope permissions in trusted code. The full A/B report is available only to an authorized combined account; do not expose the other account's bills or totals to A-only or B-only users through printing, history or direct requests. Print locally without internet, using the existing configurable printer setup where suitable.
- Clearly label the output as a non-fiscal daily turnover report. A Windows queue acceptance alone is not proof of paper output. Verify with sample data on the available restaurant printer and record the actual result or limitation.

**Checks/review:** Verify a day spanning midnight, multiple bills, cash and card, a corrected payment and total reconciliation; denied direct requests; repeated close and print requests; printer failure, uncertain output, retry and restart recovery. Inspect the sample printed paper for completeness and readability. Review financial integrity and authorization.

### S-059 — Shared unpaid bills for owners

**Goal:** Allow Owner A, Owner B and Combined to see shared unpaid bills while preserving paid-bill financial scope. **Depends on:** S-025 and S-057. This is the first slice of the original S-059; S-060–S-062 retain the remaining D-013 requirements. Existing restrictions continue until each capability is safely delivered.

**Acceptance:**

- Owner A, Owner B and Combined can list and inspect unpaid bills as shared operational information before account classification. Direct requests obey the same rules.
- Once paid, a bill and its financial information are protected by the effective account scope. A B-to-A correction is visible to A as an A payment; only Combined sees the transfer history and original B account. Card remains A. Preserve payment and correction history.

**Checks/review:** Exercise all three identities and direct requests, including unpaid-to-paid transitions for both accounts and a B-to-A correction. Review financial and authorization behavior and report unverified UI or desktop evidence.

### S-060 — Protected shared administration

**Goal:** Deliver D-013 shared configuration and protected account management. **Depends on:** S-059, S-010, S-015 and S-027.

**Acceptance:** Both owners and Combined can manage shared menu, prices, tables and staff within D-014's boundary, with clear restaurant-wide messaging and attributable history. Only Combined can manage staff credentials and operational permissions, or create or change owner accounts or financial access, including credentials and grants. Prevent self-escalation and preserve active-administrator and session protections. Keep sensitive operational and financial paths restricted unless explicitly authorized.

**Checks/review:** Exercise all three identities and direct requests, attempts to change owner credentials and grants, self-escalation, shared changes and attribution, sessions, and applicable migration and restart behavior.

### S-061 — Scoped shared-day close and reports

**Goal:** Deliver D-013 shared-day closing and protected printing. **Depends on:** S-060, S-026 and completed S-058. Preserve S-058 close and print history and its outstanding verification.

**Acceptance:**

- Either owner or Combined can close the one shared system day. Before confirmation explain that it closes for both owners, stops that day's transfer-manager corrections and automatically opens the next day. Display only permitted turnover. Preserve outstanding-issue warnings, history, retry safety and atomic close behavior.
- When A closes, print A's paid-bill report only; when B closes, print B's only; when Combined closes, print both. Combined can print the full closed-day report later. Keep scoped and full reports protected across retries, printer failures and restarts; preserve existing report snapshots and jobs without exposing previously printed full reports to A or B. Printing is non-fiscal, and queue acceptance is not proof of paper output.
- A B-to-A correction counts once in A turnover and is no longer in B turnover. Only Combined sees the transfer history and original B account; A sees it as an A payment. Preserve the original payment, correction history and existing transfer-manager restrictions.

**Checks/review:** Test all three identities using UI and direct requests, including denied cross-account details, totals and print retries. Exercise close by each identity, repeated requests, shared-day consequences, report reconciliation, print failure and uncertain recovery, restart, and existing historical snapshots. Use sample data and include financial, authorization and migration review plus appropriate offline printer verification; report any unverified hardware results.

### S-062 — Verify owner administration policy across the application

**Goal:** Verify the full original S-059 and D-013 policy across the admin application. **Depends on:** S-059–S-061.

**Acceptance:** Combined can use every admin feature and see both accounts. Owner A and Owner B can use admin features while financial records, totals, reports and details remain restricted to A and B respectively, including direct requests and printed output. Card remains A. Do not leak the other account through aggregates, search, exports, print jobs, errors or historical records. Verify shared administration, unpaid-to-paid transitions, correction visibility, shared-day closing and scoped printing together.

**Checks/review:** Test all three identities using UI and direct requests, financial and authorization review, relevant recovery and migration paths, and appropriate offline printer verification. Record any hardware limitations.

## Suggested next session

Start **S-044 — JSX and local build foundation**. It establishes the frontend build in a small, reviewable increment before extracting larger workflows. It does not change database or financial rules.
