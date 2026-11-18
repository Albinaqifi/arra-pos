# Discovered work

Record issues found outside the current story in one short line: date, story, issue and why it matters. Do not silently expand the current story. Promote an item to the backlog when appropriate.

- 2026-11-09, S-046: Existing full-suite failures: application-info's expected bridge list omits `adminAccess`; bills-renderer and session-independent evaluate the admin-dependent renderer without loading `ArraComponents`, obscuring unrelated regression checks.
- 2026-11-09, S-042: Concurrent-payment test failed during the full suite but passed in isolation; investigate possible load-related flakiness.
- 2026-11-18, S-088: Concurrent-payment test workers can race in database migration startup and hit `database is locked`, leaving the other worker waiting at the barrier; investigate the existing test/startup race.
- 2026-11-12, S-057: Baseline `table-config-flow-independent` expects one waiter grid element but finds none; the existing `session-independent` ArraComponents failure also persists, obscuring full-suite verification.
- 2026-11-13, S-065: `table-config-flow-independent` expects an untouched opened table to have an order; current S-054 behavior returns none, obscuring that flow's verification.
- 2026-11-13, S-068: Baseline admin-access-renderer expects an EmployeeConfig access-denied message but receives the unavailable message; the stale expectation obscures that unrelated check.
- 2026-11-17, S-081: `audit-independent.test.js` failed a sample PIN substring assertion in the full suite but passed in isolation; timestamp digits may coincidentally match and obscure the audit check (cause unconfirmed).
- 2026-11-18, S-085: Browser demo table availability can remain taken after the final item is corrected; active-order filtering works, but demo availability needs separate investigation.
- 2026-11-18, S-090: Clean base e64d17b reproduces three sales-report renderer assertion failures and VM module-resolution failures in s083 payment printing and second-kitchen tests, obscuring full-suite verification.
