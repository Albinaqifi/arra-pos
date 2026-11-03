# Restaurant POS Administration Requirements

Requirements baseline for the owner and administration side

Status: working specification | 2 November 2026

Purpose: define the administration features, access rules, owner account separation, and interactions with the waiter POS. This document is intended to be carried into a later design or implementation session. Confirmed decisions below take precedence over conflicting wording in the earlier waiter specification.

## 1 Purpose and scope

The POS supports one restaurant with two owners, referred to as Owner A and Owner B. The administration side provides operational oversight and configuration while protecting each owner’s financial information. A third authorized account can see the combined information. The existing waiter interface is the visual and workflow reference, not an implemented backend.

The existing project is a React waiter demo with simulated data and actions. It does not provide a production database, real authentication, printer integration, or real payments. This specification describes the intended system, not existing functionality.

The launch baseline is one shared PC. The underlying design should allow future clients without making multiple active devices a requirement for the first release.

## 2 Terminology and boundaries

DEF 01  Account A and Account B identify the two owners and their respective sales and payment records. Do not assume a particular legal structure, bank account arrangement, or tax treatment.

DEF 02  The combined account is a third authorized login that can view A, B, and combined figures, subject to its assigned permissions.

DEF 03  A business day or shift is the operational period used for day history and closure. Its exact start and end rules remain to be configured.

DEF 04  A preparation ticket instructs the kitchen or bar; a bill presents the customer’s charges; a payment is a separate recorded event. A card terminal operates separately from the POS and prints its own terminal receipt.

DEF 05  A transfer means correction of the owner-account classification of an existing eligible payment. It is not a second payment or an assumed transfer of bank funds.

## 3 Users authentication and permissions

AUTH 01  Staff first sign in to the restaurant using its username and password. The waiter selection screen lists waiter names; waiter PINs are optional or configurable under the existing waiter baseline.

AUTH 02  An Administration button opens admin authentication using an administrator username and PIN.

AUTH 03  Support Owner A admin, Owner B admin, and a third combined-view account. Each identity is separately authenticated and its actions are attributable.

AUTH 04  Provide a flexible permission system that can grant or revoke access to individual screens, data, reports, and actions. Role defaults and individual assignments should be configurable without rewriting the interface.

AUTH 05  Separate permission to view from permission to modify or perform sensitive operations, including voids, refunds, transfers, employee management, menu changes, financial reports, printer settings, and close of day.

AUTH 06  Owner A can access only A’s financial information; Owner B can access only B’s. The combined account can see both and combined totals. A detailed field-by-field access policy for shared operational records remains to be defined without exposing the other owner’s protected data.

AUTH 07  Enforce permissions and owner data scope on the server for all views, search results, totals, reports, exports, and direct requests. Hiding interface controls alone is insufficient.

AUTH 08  Protect PINs and passwords, limit repeated failed attempts, support account deactivation and secure credential reset, and provide session locking or timeout suitable for a shared PC.

## 4 Administration entry and dashboard

DASH 01  After successful admin authentication, display an easy-to-scan dashboard with access to relevant sections according to the signed-in account’s permissions.

DASH 02  Show today’s sales and completed order count, active tables and orders, and cash versus card totals. Financial amounts and counts must respect account visibility.

DASH 03  Provide drill-down to underlying records where the user is authorized. Date or business-day filtering should be available for historical views.

DASH 04  Show operational issues such as failed printer jobs and other actions requiring attention where permitted. Keep detailed employee activity in deeper screens rather than crowding the dashboard.

DASH 05  Define gross sales, net sales, order counts, voids, refunds and time boundaries consistently across dashboard and reports before implementation.

## 5 Tables floor and order administration

FLOOR 01  Authorized admins can create and edit tables, dining areas, and table capacities. Changes must preserve historical table references.

FLOOR 02  Support assigning waiters to tables for organization. The waiter baseline allows any waiter to serve any table; assignment must not silently prohibit that workflow.

FLOOR 03  Display active and completed orders, their status, table, items, modifiers, notes, timestamps, and relevant actors, subject to permissions and owner visibility.

FLOOR 04  Order detail must provide a traceable timeline of additions, send rounds, table and item moves, voids, bills, payments, and relevant print attempts.

FLOOR 05  A waiter may remove or change an unsent item. After an item has been sent for preparation, a waiter cannot remove or edit it; an authorized admin can perform a recorded void or correction later from administration. Admin presence during service is not required.

FLOOR 06  A void or correction preserves the original item, affected quantity, time, actor and reason; it must not silently erase the transaction or preparation history. Handling of a correction after a bill has already been paid requires a defined adjustment or refund workflow.

FLOOR 07  Whole-order and selected-item moves retain original item identities and history, do not duplicate items, and do not overwrite another active order. Audit source, destination, actor and time.

## 6 Menu management

MENU 01  Authorized admins can create, edit, activate or deactivate main categories, subcategories, products, prices and display order.

MENU 02  Support fixed products and products with modifier groups or submenu choices, including labels, options, required or optional selection and price adjustments.

MENU 03  Configure preparation routing per product or appropriate menu item so food and drinks can be sent to kitchen and bar printers respectively.

MENU 04  Existing order items retain their original names, prices, selected modifiers and tax context when the menu is changed later. Historical records must remain readable after products are deactivated.

MENU 05  Waiters see modifier options as a grid when choosing an item and can add per-item notes from the order sidebar, consistent with the existing design.

## 7 Employees roles and activity

EMP 01  Authorized admins can create, edit and deactivate employee accounts, configure roles and permissions, and set or reset PINs according to policy.

EMP 02  Each meaningful action records the acting employee and time. Optional waiter PINs limit confidence in attribution because another person could choose that name; this is a known operational tradeoff.

EMP 03  Provide employee daily records and deeper searchable activity: items added or removed before sending, sent orders, table and item moves, bill and payment actions, and authorized corrections or voids.

EMP 04  Support reports on tables served and activity by waiter. Define whether the measure counts the opening waiter, every contributing waiter, or both; preserve individual action records so these measures remain possible.

## 8 Billing and payment rules

PAY 01  A bill covers the eligible items on the active table order. The waiter sees a summary and confirms before choosing cash or card.

PAY 02  Card payments are made on a separate Wi-Fi card terminal, which prints its own terminal receipt. The POS records the card payment under Account A only; the POS bill uses Printer A. There is no card-terminal integration requirement.

PAY 03  For cash, the waiter chooses Account A or Account B. The POS bill uses the corresponding configured printer and the payment is recorded for the selected owner.

PAY 04  Card to Account B must be rejected by server-side business rules on every path, including edits, corrections, imports and future features. Printer routing and account classification are separate concepts.

PAY 05  A bill is paid in full as one transaction. Split bills, partial payments and multiple tenders on one bill are out of scope.

PAY 06  Maintain separate states for bill generation or printing and for payment recording. Printing a bill or a terminal receipt is not by itself proof that the POS has recorded a payment. Define the staff confirmation step and recovery path during detailed design.

PAY 07  Retries and repeated clicks must not create duplicate payments. A printer failure must preserve the order and provide a clear recovery path without duplicating financial records.

PAY 08  Authorized admins can view payment history and perform refunds. Record the original payment, amount, reason, actor, time, method and status. Card refunds require the appropriate separate terminal/provider procedure; the POS must not claim it processed a refund unless it actually did. Exact refund procedure remains open.

## 9 Transfer manager and account correction

TR 01  Show Transfer Manager as the last entry on the waiter selection screen. Authenticate this role with a four- or six-digit PIN; the exact length remains to be chosen.

TR 02  The transfer manager sees the table overview and selects a table to inspect eligible completed payments in current-day or current-shift history. This role cannot enter orders or perform ordinary waiter or admin actions.

TR 03  The only transfer-manager financial operation is correcting an eligible cash payment from B to A. Card payments already belong to A and cannot be assigned to B. No A-to-B transfer is authorized by this requirement.

TR 04  Record the original payment, original and destination account, actor, timestamp and reason or other required context. Preserve the original record and display the correction to authorized administrators.

TR 05  Count the payment once under its effective account in combined financial totals. Owner reports reflect the effective account while preserving a traceable correction history within each user’s access rights.

TR 06  Do not permit the transfer-manager correction after the relevant business day has been closed. The system must enforce the cutoff, including direct requests and repeated submissions.

TR 07  Day versus shift filtering, reason requirements, whether the action must be whole-payment only, and any exceptional post-close correction procedure remain open; none grants the transfer manager post-close access.

## 10 Reports and close of day

REP 01  Provide sales by business day and date range, account, cash or card, and relevant payment status; show refunds and voids separately so totals can be reconciled.

REP 02  Provide most-sold products by quantity and sales value, with date and time-of-day filters. Preserve historical product prices and names for reliable reports.

REP 03  Report table usage frequency and waiter service activity. Preserve table moves and multi-waiter activity so measures can be defined accurately.

REP 04  Provide detailed records of voids, refunds, payment corrections and employee actions, with filters appropriate to each report and role.

REP 05  Provide an authorized close-of-day process that records who closed which business day and when. Show outstanding issues or reconciliation information as defined in detailed design.

REP 06  After closing, block transfer-manager B-to-A corrections for that day. Define how open orders, outstanding print jobs, refunds and any authorized later adjustments are handled before implementing close of day.

REP 07  Totals and drill-downs must consistently enforce A, B and combined visibility. A combined view must not double-count a transferred payment.

## 11 Settings printers and reliability

SET 01  Authorized admins can manage restaurant details, taxes, service charges, business-day settings, receipt configuration and kitchen, bar, A and B printer settings.

SET 02  Preparation tickets route kitchen and bar items separately; additional rounds include only newly sent items. Printer configuration does not alter financial account classification.

SET 03  Record print jobs and attempts. Show failures and uncertain outcomes; retry or configured backup printing must not duplicate an order or a payment.

SET 04  Persist data outside browser memory. Maintain recoverable backups, access controls and a tested restoration procedure suitable for the restaurant.

SET 05  Formal receipt, fiscalization, tax, refund and retention obligations depend on the deployment jurisdiction and must be verified before production. Do not assume the operational bill or card-terminal slip satisfies those obligations.

## 12 Data integrity and audit

Use a structured persistent data model with stable IDs for users, tables, orders, items, tickets, print attempts, bills, payments, refunds, owner-account corrections and audit events. A relational database such as PostgreSQL is a recommendation to evaluate against installation, backup and recovery needs; it is not a finalized technology decision.

DATA 01  Financial and order changes use transactions and enforce invariants on the backend and, where appropriate, in the database.

DATA 02  Keep an append-only audit record of material actions with actor, timestamp, affected record, action, reason where relevant, and sufficient before/after context. Ordinary waiters cannot edit audit history.

DATA 03  Separate the current state from historical events. A correction, refund or void must remain traceable and never silently erase the original.

DATA 04  Store monetary values and rounding consistently; retain enough item, tax and price detail for reproducible historical bills and reports.

## 13 Acceptance scenarios

AC 01  Owner A signs in and cannot access B-only financial data through the interface, search, reports, export or a direct request; the same applies in reverse for Owner B.

AC 02  The combined account sees both owners and a correct combined total, with no duplicate when a B payment is corrected to A.

AC 03  A waiter cannot remove a sent item; an authorized admin later records a void and the original item and actor remain visible in the audit history.

AC 04  A card payment is recorded under A and the POS bill is routed to Printer A. Attempts to save a card payment under B fail.

AC 05  A cash payment can be assigned to either owner and routes its POS bill to the associated printer.

AC 06  The transfer manager can find an eligible current-day cash B payment, correct it to A once, and cannot take orders or correct that payment after day close.

AC 07  A failed preparation or bill print preserves the underlying order and payment state. A retry does not create a second order or payment.

AC 08  A menu price change does not change an earlier order; a table or item move leaves one active item and a complete history.

AC 09  Reports can show product performance, table usage, waiter activity, voids, refunds and corrections for authorized users without exposing restricted data.

AC 10  The POS supports one full payment per bill and does not offer split or partial payment.

## 14 Open details for the next session

These are implementation details, not changes to the confirmed decisions above:

- The exact visibility of shared active orders and item details before a payment has an owner account, and how to prevent indirect disclosure in aggregate reports.

- The exact business-day start, close authority, treatment of open orders, and whether current-day or current-shift history is the transfer manager’s filter.

- The workflow for an admin correction discovered after a bill has been paid, including whether a refund or adjustment is necessary.

- Refund amounts, permissions and the procedure for cash and separate-terminal card refunds.

- Transfer manager PIN length, whether a reason is mandatory, and treatment of exceptional errors discovered after closure.

- Precise printer models, connectivity, backup routing, receipt format and behavior when a print outcome is uncertain.

- Currency, tax and service-charge rules, formal receipt obligations, data-retention period, backup schedule and restore targets.

- How tables served are attributed when multiple waiters serve the same party or a party moves between tables.

- Exact role permission matrix, credential recovery and responsibility for granting elevated access.

## 15 Relationship to earlier waiter requirements

Continue using the existing waiter specification and UI design for ordinary order entry, two table states, kitchen and bar routing, and whole or selected-item moves. This document supersedes earlier conflicting statements that a waiter may cancel sent items, that the ordinary waiter performs B-to-A corrections, or that split bills are included. The confirmed rule is admin-only correction of sent items, a restricted transfer manager for eligible B-to-A corrections before day close, and no split bills. Where prior text and this document leave a detail unresolved, do not invent a business rule.
