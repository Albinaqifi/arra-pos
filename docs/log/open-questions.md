# Open questions

Only decisions likely to cause substantial rework, data loss, financial errors, privacy exposure or an unusable deployment are questions here. All are **open**, not decisions. `[P]` marks a recommendation or working assumption for planning, never your answer. Existing confirmed requirements still apply. Routine details can be chosen during implementation and changed as needed. References to deferred IDs are listed at the end so the reconciliation remains traceable.

## Q-01 — Owner financial privacy and configurable access

**User direction:** Create accounts with strong authorization and a quick way to control what each account can see and do, including showing or hiding information between accounts.

[P] Plan separately authenticated accounts and a simple permissions screen with view and action permissions and financial-data scope, enforced by the application on every request. Start with the documented Owner A, Owner B and combined-account restrictions as defaults; make grants configurable by an appropriately authorized account. The exact screens and controls can evolve during implementation.

**Still to clarify before implementing access administration:** Who is allowed to change financial access, including their own, and may the existing A/B privacy restrictions be changed? The original admin requirements describe these restrictions as mandatory. [P] Until the user decides otherwise, preserve them and do not assume anyone may grant access across them.

## Q-02 — Payment recording

The question means: after a customer pays in cash or on the restaurant's separate card terminal, how does a waiter tell the POS that the bill has been paid? For example, [P] the waiter could press “Paid” after receiving the money or seeing the terminal approve the card. This is a workflow detail we can refine when building payment; it does not need an answer to start the system.

Working assumption: [P] the POS records a staff-confirmed payment, while the card terminal handles the actual card transaction. Printing and payment are separate. The owner has ruled out a refund workflow (D-011).

## Q-03 — Business day and corrections — deferred

The user wants to establish the system first. [P] Design the data so business-day rules and authorized corrections can be configured or extended later; do not choose a closing time now. The documented rule that transfer-manager corrections stop after closure remains in force.

## Q-06 — Printers — deferred

The user does not yet know the models; the local provider supplies terminals and printers. [P] Keep preparation tickets and bills separate from printer-specific code so actual hardware can be investigated later. Do not block the first database or early development on printer models.

## Q-07 — Location and fiscal obligations

**User answer:** The restaurant is in North Macedonia. Its provider supplies terminals and printers. Currency, integration details, fiscal obligations and provider requirements remain unconfirmed. [P] Investigate those before implementing real fiscal/payment integration or live use, rather than blocking initial development.

## Q-10 — First milestone — deferred

The user wants to start building a real system in increments, without first deciding every operational detail. [P] Propose a small, useful first milestone after intent and architecture are approved. The exact first production launch and its scope remain open.

## Q-11 — Offline operation

**User answer:** The app must work without internet. The user wants help researching and choosing the best way to achieve this.

[P] Evaluate a local application and database first, including how local printing, backup and recovery would work. Offline service is a requirement; the specific architecture is not decided. Needed before: selecting the deployment architecture. This is an architecture discussion for Part C, not a reason to delay drafting intent once the user is ready.

## Q-12 — Backups and data loss

**User direction:** Aim to prevent data loss as well as reasonably possible; do not require an arbitrary loss or downtime limit before starting.

[P] Design durable local storage, independent backups and tested restoration. No backup arrangement can promise zero loss in every failure, so explain practical tradeoffs when choosing the architecture. Exact schedules and recovery targets can be refined later; a working backup and restore process is needed before real operational data depends on the system.

## Deferred implementation details

These are not questions holding up planning. The project can use reversible, explicitly proposed defaults and refine them with real usage. Keep financial, privacy and audit invariants from the source documents intact.

- **Q-04** Sent-item correction interaction and optional preparation notice: [P] authorized admin records a reasoned correction; staff notify preparation directly. Confirm the business consequences alongside Q-02 if necessary.
- **Q-05** Refund amounts and interface: closed by the owner's no-refund decision (D-011). Fiscal reversal obligations remain to be verified under Q-07.
- **Q-08** Correction reason, day/shift filter and interface: [P] whole eligible cash payment, mandatory reason, current business day. The confirmed pre-close B-to-A restriction remains; exceptional post-close authority is part of Q-03.
- **Q-09** PIN length, reset screens and routine permission administration: [P] unique administrator identities, protected credentials, rate limits and session locking. Optional waiter PINs remain a known attribution risk; refine with implementation.
- **Q-13** Item move details: [P] preserve identities and history, never overwrite an active order, and use confirmation for merges; refine the interaction during development.
- **Q-14** Modifier controls and pending-price behavior: [P] use configurable choices and preserve historical sale details; refine using the actual menu.
- **Q-15** Report labels and counting conventions: [P] retain underlying events and show voids separately; refine report definitions before relying on them for accounting.
- **Q-16** Export and deletion interface: [P] restrict access and establish retention/deletion rules with jurisdiction-specific advice before production; legal obligations belong to Q-07.
- **Q-17** Notifications: [P] start with in-app warnings.
- **Q-18** Setup and migration: [P] start with manual setup and no historical import, unless existing data changes the scope.
- **Q-19** Language and accessibility details: [P] use readable controls and select the initial language during implementation.
- **Q-20** Capacity targets: [P] start with one shared PC and validate performance with representative restaurant data as it becomes available.


