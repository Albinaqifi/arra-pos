# Arra POS project instructions

Read `docs/intent.md`, `docs/process/workflow.md`, `docs/progress/board.md`, and the requested story in `docs/stories/backlog.md`. Read the relevant role instructions in `docs/process/agents/` and only the architecture or requirements sections needed for the story. The user approved the intent: do not edit `docs/intent.md`.

## Working rules

- One requested story per session, including the fixes needed to finish it. Do not automatically start the next story. Record unrelated findings briefly in `docs/progress/discovered.md`.
- Work incrementally. Make routine, reversible implementation choices yourself. Ask the user only when an unresolved high-impact product choice or missing authorization actually blocks the work.
- Work offline: core restaurant operations must not require internet. Use local data and sample identities for development; no real sales or sensitive customer data before readiness.
- Enforce permissions and financial rules in trusted application code, not only the interface. Card belongs to A; never duplicate a payment on retry. Preserve sent-item, payment and correction history. The admin requirements override conflicting waiter wording.
- Preserve user data, existing work and historical migrations. Do not weaken a test just to pass. Do not put credentials, PINs or personal data in logs, tests, handoffs or commits.
- Run checks appropriate to the change, report exactly what ran and its result. Give financial, authorization, migration and recovery changes stronger tests and review. Avoid repeatedly running the same full suite without a reason.
- Keep the code simple and compatible with Windows. The existing React demo is a reference and starting point; it is not a production system.
- Update the board and one concise handoff for the story. Never claim a review, test, CI run or merge occurred when it did not. Do not claim an agent is independent if it shares the builder's context.

## Running a story

When the user asks to run a story with agents, follow `docs/process/workflow.md`: coordinator → builder → independent reviewer → independent tester; pass findings back for correction. Fresh subagents or fresh sessions are preferred. If independent agents are unavailable, say so and offer or perform the available checks without misrepresenting them. The owner authorizes agents to commit verified story changes, push a story branch, and open a PR when repository access permits. Do not merge without explicit authorization. Respect the user's instructions and session permissions.
