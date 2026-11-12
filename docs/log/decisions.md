# Decisions

Append-only log. Accepted architecture recommendations are recorded below; `[P]` identifies proposed implementation details rather than additional user decisions. Do not rewrite past entries: append a superseding entry if a decision changes. Source requirements remain authoritative where they establish business rules.

## D-001 — Offline local operation
- **Origin:** User answer Q-11 and approved intent.
- **What:** Core POS runs without internet on one shared restaurant PC.
- **Why:** Service must continue during an internet outage.
- **Revisit if:** Restaurant operating model changes or additional devices are required.

## D-002 — Desktop application
- **Origin:** User accepted architecture recommendations after the local-browser versus desktop discussion.
- **What:** Build a locally installed desktop application; [P] evaluate Electron for its shell.
- **Why:** A familiar app window while retaining local operation and the existing web skills.
- **Revisit if:** Packaging, hardware integration or maintenance makes another local approach materially simpler.

## D-003 — React and Node.js
- **Origin:** User accepted architecture recommendations; existing demo.
- **What:** Use React for screens and Node.js for application logic; [P] use TypeScript.
- **Why:** Reuse the existing project and use one familiar language across the application.
- **Revisit if:** A concrete integration or maintenance problem outweighs reuse.

## D-004 — SQLite on the local PC
- **Origin:** Accepted architecture recommendation.
- **What:** Use SQLite locally, accessed through application services; [P] use versioned migrations.
- **Why:** Transactional storage with little operational setup for one PC.
- **Revisit if:** Concurrency, operational requirements or multiple devices demand a different database.

## D-005 — Shared application and authorization
- **Origin:** User Q-01 direction and accepted architecture recommendation; admin AUTH 03–07.
- **What:** Waiter and admin share the application and data; use local accounts with configurable view/action permissions and enforced financial scope. Preserve the documented A/B separation pending clarification of who may change it.
- **Why:** Simple management and one enforcement point, including offline.
- **Revisit if:** Access policy changes or a separate service becomes necessary for additional devices.

## D-006 — Local background tasks and files
- **Origin:** Accepted architecture recommendations.
- **What:** Handle background tasks in the application and store needed files locally; no separate queue or cloud storage initially.
- **Why:** Fewer moving parts and offline operation.
- **Revisit if:** Task volume, reliability or integration requirements require isolation.

## D-007 — Notifications
- **Origin:** Accepted architecture recommendation.
- **What:** Use in-app notices initially; defer email/SMS.
- **Why:** Works without internet and avoids unnecessary services.
- **Revisit if:** Operational monitoring requires external alerts.

## D-008 — Verification and CI
- **Origin:** Accepted architecture recommendation.
- **What:** Automate tests for money, permissions, order integrity and key flows; run tests and build checks automatically on code changes. Manually verify usability and hardware.
- **Why:** Catch consequential regressions while keeping checks proportional.
- **Revisit if:** The delivery workflow or risk profile changes.

## D-009 — Backups and restoration
- **Origin:** User Q-12 direction and approved intent.
- **What:** Protect data with independent backups and tested restoration before live dependence; details remain open.
- **Why:** Reduce data loss and recover from failure without promising impossible guarantees.
- **Revisit if:** Deployment or recovery needs change.

## D-010 — Separate terminal and deferred fiscal integration
- **Origin:** Admin PAY 02, user location/provider answer, approved intent.
- **What:** Card terminal operates separately; investigate North Macedonian fiscal/provider requirements before real integration and live operation. Printer details do not block the foundation.
- **Why:** Reflect the documented workflow without inventing provider or legal requirements.
- **Revisit if:** Verified provider requirements or business needs change.

## D-011 — No refund workflow
- **Origin:** Owner direction, 2026-11-09.
- **What:** The product will not provide a refund workflow; retire S-029. This supersedes earlier refund planning.
- **Why:** The owner confirmed that there will be no refunds.
- **Revisit if:** The owner changes this direction or verified fiscal obligations require further consideration. The legal treatment of reversals remains to be verified under Q-07.

## D-012 — System-day boundaries
- **Origin:** Owner direction for daily detailed turnover, 2026-11-12.
- **What:** A system day runs without a fixed time limit, including past midnight, until an authorized admin closes it. The next system day starts automatically on close. Before confirmation, show the admin the day's permitted turnover and outstanding orders.
- **Why:** Match the restaurant's actual closing routine and keep the POS ready for the next day.
- **Revisit if:** The owner changes the closing routine. Exceptional post-close correction authority remains open under Q-03.

## D-013 — Owner administration and financial scope
- **Origin:** Owner direction, 2026-11-12; clarifies D-005 and Q-01.
- **What:** Combined has full administration access and sees A and B. Owner A and Owner B can use administration features with only their respective financial data. Both may close the single shared system day; warn that this also closes it for the other owner, stops that day's transfers and automatically starts the next day. Print only the closing owner's account report; Combined may print the full report later. Combined closing prints both accounts.
- **Shared administration:** Both owners may manage shared menu, prices, tables and staff; changes affect the whole restaurant and must be attributable. Only Combined may create or change owner accounts or financial access; this protects the A/B boundary. Both owners may see unpaid bills as shared operational information because the payment account is not assigned yet.
- **Transfers:** A B-to-A correction counts once in A turnover and no longer in B turnover. Only Combined sees the transfer history and original B account; A sees the payment as A turnover.
- **Revisit if:** The owner changes these rules. Preserve card-to-A and existing correction and financial-history rules.

## D-014 — Staff credentials and operational permissions
- **Origin:** Owner direction during S-060, 2026-11-12; clarifies D-013.
- **What:** Keep staff credential and operational-permission actions for Combined only. Owner A and Owner B may manage shared staff details within that boundary.
- **Why:** Prevent an owner from obtaining restricted staff access by setting a staff credential and permissions.
- **Revisit if:** The owner changes this boundary or a future identity design safely supports broader delegation.

## D-015 — Legacy test-database provisioning
- **Origin:** Owner direction during S-060, 2026-11-12.
- **What:** An authenticated one-time Combined setup may be provided for older waiter-only test databases; unsupported older test databases may be left as they are if recovery is not straightforward.
- **Why:** The existing databases were used for testing and do not require a comprehensive recovery feature.
- **Revisit if:** A production provisioning or recovery process is designed.
