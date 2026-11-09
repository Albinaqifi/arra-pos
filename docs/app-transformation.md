# Arra POS application transformation

Purpose: turn the existing single-PC desktop application into a maintainable product and, separately, prepare it for a real restaurant. This is a sequence of small stories for separate sessions, not an instruction to implement the whole plan at once. Story status lives only in [the board](progress/board.md); story scope and acceptance live in [the backlog](stories/backlog.md). Follow [the story workflow](process/workflow.md).

## Starting point

The current React interface combines many screens, demo behavior and desktop workflows in `src/App.js`. Its size alone is not the problem: intertwined state, deeply nested `React.createElement` markup, inline styles and simulated and desktop paths make changes harder to understand and verify. The local service layer, SQLite migrations, authorization checks, financial constraints, historical records and existing tests are valuable foundations. Improve them incrementally; a wholesale rewrite is not justified by the current evidence.

The application is still a development system, not ready for real sales. Real printing and fiscal integration, a practical tested recovery process, production account security, a Windows release and target-PC verification remain necessary. The existing tests provide useful evidence, but do not replace desktop, hardware and recovery exercises. Continue to use sample data until readiness.

## Non-negotiable rules

- Preserve existing data and historical migrations; add migrations rather than rewriting released ones. Preserve sent-item, payment, correction and audit history.
- Card belongs to Account A. A retry must never create a duplicate POS payment. A separate card-terminal outcome and a fiscal or print outcome are not the same as a recorded POS payment.
- Enforce financial rules, permissions and account scope in trusted application services, including direct requests. Waiters retain their normal table, order, preparation and payment workflows, but cannot see or access administration. Admins receive only their granted actions and financial scope. The transfer manager retains its separate restricted workflow.
- Keep core restaurant operations local and usable without internet. Build tools may need internet during development; the installed application must not need a development server or remote assets. Fiscal equipment and legal outage rules require separate verification.
- Keep changes understandable for one developer, compatible with Windows, and small enough for review. Do not add frameworks or rewrite services without a demonstrated need.

## Sequence

1. **Frontend foundation and extraction:** S-044 introduces JSX and a local production build. S-045, S-046 and S-047 extract admin, waiter and payment UI in reviewable slices. S-048 separates the browser demo; S-049 simplifies demonstrated duplication. S-038–S-043 remain existing administration design stories and can be coordinated with these extractions; do not repeat a completed screen or lose their acceptance requirements.
2. **Data and access:** S-052 verifies backup and restore locally using sample data; the separate-device recovery required by S-032 can wait until suitable storage is available, but must be demonstrated before real use. S-050 hardens accounts; S-051 rehearses safe upgrades and failure recovery. S-030 is already marked Done; validate reporting definitions and reconciliation before accounting reliance instead of duplicating it.
3. **Equipment and fiscal:** finish S-033 with the provider and local professional, then refine and complete S-034 and S-035 with actual hardware. Split those stories when the provider's interfaces and failure behavior are known. Do not treat simulated printing as real output or assume a timeout is safe to repeat.
4. **Windows release and pilot:** split S-036 into a packaging/upgrade story and a separate pilot-readiness story when prerequisites and scope are known. The pilot requires demonstrated separate-device recovery, appropriate security, equipment and fiscal checks before live sales.

Frontend stories can proceed while S-032's separate-device test and S-033's provider investigation are blocked. They do not depend on access to a USB drive. The sequence is a priority guide, not permission to start the next story automatically. One story and its necessary fixes per session.

## Decisions and open evidence

The owner needs to decide the waiter PIN policy, account recovery authority, who may change financial access (Q-01), business-day and reporting conventions, backup storage and recovery arrangements, and whether to retain the browser demo. Provider identity, equipment, supported interfaces, fiscal obligations and permitted outage procedures need provider and local professional input. Choose ordinary reversible implementation details without escalating them.

S-037 has been reported complete by the owner, but the board and handoff currently record outstanding desktop verification. Before using it as a dependency or changing its status, reconcile the actual PR/merge and verification evidence; do not invent a result or rerun completed work without reason. This plan does not change that status.

## First story

Start with **S-044 — JSX and local build foundation** in a new session. It introduces the build path and proves offline Electron loading with a small component before larger screen extraction. It does not change the database, business rules or financial service contracts.
