# Test strategy

Test what changed and focus effort on the consequences of a failure. Builder tests and independent tester checks should complement each other; do not run the same long suite repeatedly without a reason. Record exact commands and results, including anything not run.

- **Routine UI or documentation:** check the changed behavior and relevant existing checks. No test just to mirror trivial implementation.
- **Orders and persistence:** test saved state, restart, invalid input, duplicate actions and changes that must be atomic when relevant.
- **Permissions and privacy:** test allowed and denied roles through the trusted application boundary, including direct requests and protected totals where applicable.
- **Money and corrections:** test method/account rules, repeated submissions, transaction integrity and history, including failure paths.
- **Migrations and backups:** test fresh install and upgrade with existing data; verify a database-safe backup can be restored and checked in a separate location.
- **Offline and printing:** verify relevant core flow without internet; distinguish a simulated printer from actual hardware and uncertain output from confirmed output.

Use synthetic data. Tests must not contain real credentials or personal/financial records. Add stronger independent review for consequential changes when available. Define actual project commands as tooling is introduced; none are assumed to exist yet.
