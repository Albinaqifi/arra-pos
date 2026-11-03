# Story workflow

The goal is one useful, verified story per session, with a lighter process than Chairside. The coordinator handles role handoffs; the user should not have to relay messages. `docs/stories/backlog.md` contains scope and acceptance; `docs/progress/board.md` is the single source of story status.

## Ready

Before building, check that the story exists, dependencies are done, acceptance criteria can be checked and its scope fits one session. Inspect the current code, not just the plan. Split an oversized story or record a genuinely blocking question. Small choices are for the team to make; never guess a business decision or turn a minor UI detail into a blocker.

## Pipeline

1. **Coordinator:** identify one story, check the worktree and dependencies, assign a builder with `agents/builder.md` and update the board. Do not overwrite unrelated work.
2. **Builder:** implement the story and appropriate tests; run relevant checks; write a concise handoff with the exact result.
3. **Reviewer:** in a fresh context, review the actual change against the story and project rules; identify actionable defects. Read-only product-code review.
4. **Tester:** in a separate fresh context, verify each acceptance criterion and relevant failure cases. Add tests if appropriate, but do not fix product code. Avoid rerunning an unchanged expensive suite already verified unless needed for confidence.
5. **Fix:** builder corrects required findings. Tester rechecks affected behavior; reviewer reviews changed code. Repeat as needed; if a fix reveals major scope or an unresolved owner decision, explain the blocker rather than looping indefinitely.
6. **Finish:** verify final changes have been reviewed and relevant checks passed. Coordinator records the result and stops. Mark Done when the agreed review and tests pass; if a PR workflow is in use, mark Done after merge. Otherwise use Blocked or In progress and state why. Do not assume a PR, merge or external action occurred.

Stories touching payment classification, access control, financial history, migrations, backups or restore get stronger tests for invalid input, direct requests, retries and failure recovery as applicable. A second independent review is recommended for consequential changes when available, not mandatory for every story. For ordinary work, one review and one focused test pass are enough. Do not add procedural gates, mandatory browser matrices or automatic full-suite reruns without a concrete reason.

## Git and handoffs

When Git exists, preserve unrelated work, record the base and final revisions, and use a story branch when appropriate. A diff must include all story changes; reviewer/tester must know if work is uncommitted. The owner authorizes agents to commit verified story changes, push a story branch, and open a PR when repository access permits. Do not merge or rewrite history without explicit authorization. A missing remote, CI or PR is not by itself a reason to stop local development. When CI exists, report its actual result; do not invent checks that have not been set up.

Each story has `docs/progress/handoffs/S-xxx.md`: story and state; what changed; acceptance evidence and commands; reviewer findings and resolution; tester results; outstanding issues and next action. Keep it brief and do not include secrets. If independent roles are unavailable, document that limitation and do not mark the independent step as passed.

## Story states

- **Todo:** not started or not ready.
- **In progress:** building, reviewing, testing or fixing.
- **Blocked:** cannot proceed safely; record why and the next action.
- **Done:** acceptance criteria and required review/testing passed; if using a PR, it is merged.

The board tracks state only. The backlog keeps story details. The decisions log is append-only; `docs/intent.md` is approved and immutable.
