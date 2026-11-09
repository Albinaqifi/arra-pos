# Discovered work

Record issues found outside the current story in one short line: date, story, issue and why it matters. Do not silently expand the current story. Promote an item to the backlog when appropriate.

- 2026-11-09, S-046: Existing full-suite failures: application-info's expected bridge list omits `adminAccess`; bills-renderer and session-independent evaluate the admin-dependent renderer without loading `ArraComponents`, obscuring unrelated regression checks.
- 2026-11-09, S-042: Concurrent-payment test failed during the full suite but passed in isolation; investigate possible load-related flakiness.
