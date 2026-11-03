# Requirements reconciliation

Status: analysis for discussion, not an approved specification. Sources: `admin_requirements.md` (sections and IDs below) and `restaurant_pos_v1_requirements.docx` (numbered sections below), both at repository root. The admin document explicitly says its confirmed rules override conflicting earlier waiter wording. `[P]` marks a proposed resolution, not an approved decision. Q references point to `../log/open-questions.md`; some IDs now refer to deferred implementation details rather than questions or planning blockers. Proposed decision IDs are placeholders for a later decision log; none are approved.

## A. Waiter UI promises that administration does not yet fully support

- **A1 Modifier selection:** Waiter §5 promises grid choices; MENU 02 supports required/optional choices but omits limits, defaults, combinations and whether multiple choices are allowed. [P] Resolve through Q-14; configure selection limits and validate them on the server (proposed D-P01).
- **A2 Printer recovery:** Waiter §6.3 promises retry or configured backup and clear uncertainty; SET 03 records attempts but hardware, confirmation and backup behavior remain unspecified. Q-06 determines feasible behavior; [P] never claim physical output is certain without device evidence (D-P02).
- **A3 History and corrections:** Waiter §§10–11 expect completed history and reports. Admin TR 02, TR 07 and REP leave day/shift filtering, historical reach and permissions unresolved. Q-03, Q-08 and Q-15.
- **A4 Moves:** Waiter §8 supports selected-item moves; FLOOR 07 prohibits overwriting an active order, but neither specifies whether selected items can be added to another occupied table, or partial quantities moved. Q-13.
- **A5 Billable items and closure:** Waiter §§4, 9 expect one complete bill and freeing the table; PAY 06 and REP 06 leave confirmation, failure and open-order handling undefined. Q-02 and Q-03.

## B. Administration needs screens or data absent or deferred in the waiter document

- **B1 Management scope:** Admin §§4–7, 10–11 require dashboard, floor/menu/employee settings, reports, audit, printers and close of day; waiter §1.2 defers full admin design. Q-10 defines launch scope. [P] These need authorized admin screens and persisted data (D-P03).
- **B2 Separate identities and restricted data:** AUTH 03–07 require three admin identities, granular grants and owner-scoped information; waiter §3 only describes restaurant login and optional waiter PIN. Q-01 and Q-09 define safe visibility and credentials. [P] Enforce scope on the server, including derived totals (D-P04; already required by AUTH 07).
- **B3 Voids and refunds:** FLOOR 05–06 and PAY 08 require an authorized admin correction and refund history, including post-payment cases. Waiter §7 instead describes waiter cancellation and review, with no refund workflow. Q-04 and Q-05.
- **B4 Transfer manager:** TR 01–07 requires a special selection-screen entry, PIN, constrained history and pre-close B-to-A correction; waiter §10 defers the UI and permissions. Q-08 and Q-09. [P] Enforce the role and cutoff server-side (D-P05).
- **B5 Configuration history:** MENU 04 and FLOOR 01 preserve prior menu and table references, while SET 01 adds tax, service charge and receipt settings. Waiter §§5, 12 need configuration but leave the management interface and change timing open. Q-07 and Q-14. [P] Snapshot sale details for historical bills (D-P06).
- **B6 Day-end and incidents:** REP 05–06 and DASH 04 require a close-day screen and visible printer issues; waiter mentions warnings but not an admin closure flow. Q-03 and Q-06.

## C. Different descriptions or unresolved terminology

- **C1 Sent-item cancellation:** Waiter §7.2 and acceptance criteria allow a waiter to cancel with a reason and admin review; admin FLOOR 05 and §15 supersede this with no waiter edit/removal after send and an authorized admin's recorded correction. [P] Update waiter baseline to match the later rule (D-P07). Q-04 covers operational details.
- **C2 Reclassification actor and direction:** Waiter §10 leaves permissions and direction open; admin TR 03 and §15 specify restricted transfer-manager cash B-to-A only, before day close. [P] Apply that confirmed scope; any exceptional admin path is Q-08 (D-P08).
- **C3 Admin delivery timing:** Waiter §1.2 calls admin experience a later phase; admin describes a full administration side without a precise launch boundary. Q-10 decides sequencing; the documents need not conflict if phases are made explicit.
- **C4 Day versus shift:** Admin DEF 03 uses both terms for an operational period but TR 07 leaves filter and boundaries open; waiter §11 asks for time zone and business-day boundary. Q-03 and Q-08. [P] Use “business day” consistently once defined (D-P09).
- **C5 Terminal integration:** Waiter §15 calls integration open; later PAY 02 explicitly specifies a separate terminal and no integration requirement. [P] Use separate-terminal operation as the current baseline (D-P10); Q-02 defines staff confirmation.
- **C6 Account meaning:** Waiter §9.3 calls A/B internal reporting categories and denies physical bank-account meaning; admin DEF 01 warns against assuming legal, banking or tax arrangements. [P] Use neutral owner/reporting-account labels and do not infer actual fund flows (D-P11); Q-07 covers jurisdiction and obligations.
- **C7 Sent versus printed:** Waiter §§6–7 sometimes couples sent/printed; failed or uncertain printing means these can differ. [P] Treat sending, ticket creation and physical print outcome as separate facts (D-P12); Q-06 determines recovery.
- **C8 Counts and status:** DASH 02/05 and waiter §11 ask for sales, orders and tables served without shared definitions; §4 has only Free/Taken table states, which do not define order, bill or payment states. Q-02, Q-03 and Q-15.

## D. Missing system requirements

- **D1 Login and access lifecycle:** AUTH specifies protections but not who provisions accounts, resets credentials, session duration, shared-device switching or recovery if all admins are locked out. Q-09. [P] Do not use shared admin identities (D-P13; AUTH 03 requires attributable identities).
- **D2 Errors and empty states:** Neither defines consistent validation, empty lists, offline/network failures, stale data or recoverable error messages. [P] Provide clear actionable states and preserve committed work; exact offline behavior is Q-11 (D-P14).
- **D3 Audit trail:** Both require append-only history, but access, retention, tamper resistance, sensitive fields and clock/time-zone behavior need policy. Q-01, Q-07, Q-09 and Q-16. [P] Restrict audit access and never log passwords or PINs (D-P15).
- **D4 Export and deletion:** AUTH 07 mentions exports but neither specifies export format, authorized users, deletion requests or legal holds. Q-16.
- **D5 Notifications:** DASH 04 and printer warnings cover in-app attention; external alerts, recipients and escalation are unspecified. Q-17.
- **D6 Deployment and recovery:** One shared PC is specified, but local versus hosted operation, internet dependency, updates, backup location, frequency, restore targets and responsibility are not. Q-11 and Q-12.
- **D7 Initial setup and migration:** Neither describes initial users, menu import, printer setup, acceptance of existing history, or training. Q-18. [P] Provide a controlled first-admin setup and test data separate from live data (D-P16).
- **D8 Lifecycle and concurrent actions:** Future clients are anticipated, but payment/print retries, crashes and accidental repeat actions already happen on one PC. [P] Use stable operation IDs and transactional state changes for money and sends (D-P17); Q-02 and Q-06 determine recovery.
- **D9 Accessibility and language:** Neither specifies languages, keyboard access, readability or accessibility needs. Q-19.

## E. Weak or risky spots

- **E1 Financial privacy:** Shared orders, item details, counts, correction histories and totals could reveal another owner's finances indirectly. Suppressing a button is insufficient. Q-01; test direct requests and aggregates after policy is approved.
- **E2 Payment and printing:** A terminal transaction, a POS payment and paper output can disagree after a crash or unclear printer result. Q-02, Q-05 and Q-06; avoid automatic duplicate charges or printing without clear operator guidance.
- **E3 Identity and security:** Optional waiter PINs weaken attribution on a shared PC; short admin/transfer PINs are vulnerable to guessing without rate limits and recovery controls. Q-09; never store plaintext credentials or secrets in logs.
- **E4 Data loss and availability:** A single PC is a single point of failure, and hosted operation can depend on internet. Q-11 and Q-12 determine acceptable downtime and data loss. [P] Test restores, not just backup creation (D-P18).
- **E5 Legal and privacy:** Jurisdiction, fiscal receipts, tax, employee monitoring, retention and deletion are not determined. Q-07 and Q-16 must be checked with a qualified local professional before production; terminal slip or operational bill is not assumed compliant.
- **E6 Scope, time and cost:** Fine-grained access, printing, full reporting, refunds and recovery add considerable work for a solo builder; ongoing hosting, hardware, backup and support costs are unknown. Q-10–Q-12; [P] phase delivery around one complete safe service flow (D-P19).
- **E7 Performance and scale:** Menu size, order volume, history length and expected response time are unspecified. Q-20; [P] define modest measurable targets and check report performance with representative data (D-P20).
- **E8 Business-process risk:** Changing an accounting classification is not moving money; the effect on owner settlement and taxes is unverified. Q-07 and Q-08; preserve the original and correction history and avoid implying a bank transfer.

