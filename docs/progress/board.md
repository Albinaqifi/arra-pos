# Story board

The backlog is in `../stories/backlog.md`; this board is the source of status. When a story starts, add or update its row. Unlisted stories are **Todo**. One story runs per session.

| Story | Status | Note |
| --- | --- | --- |
| S-099 | Todo | [Install and upgrade the live Windows POS](../stories/backlog.md#s-099--install-and-upgrade-the-live-windows-pos) |
| S-098 | In progress | Offline preparation printing during PF700 checkout passed independent review and testing. PR merge and same-order restaurant paper check remain open. [Handoff](handoffs/S-098.md) |
| S-097 | In progress | Simulated Card A approval, durable hold and training receipt recovery reviewed and tested. Physical Card A remains disabled pending S-096. [Handoff](handoffs/S-097.md) |
| S-096 | Blocked | The item, total and cash lines matched on one reconciled PF700 receipt. The real printer evidence needed to finish an interrupted checkout remains outstanding. [Handoff](handoffs/S-096.md) |
| S-095 | In progress | Routine Cash A checkout reviewed and automated tests passed; offline desktop and physical PF700 checks remain. [Handoff](handoffs/S-095.md) |
| S-093 | In progress | Original story merged in PR #136; table PIN auto-submit follow-up reviewed and tested, PR pending. Owner-requested assigned waiter names added to entry grid; verification and delivery in progress. |
| S-092 | Done | PR #132 merged as `f38e174`; review, full suite and sample desktop checks passed. Owner deferred full host-offline verification; it does not block other stories. |
| S-090 | In progress | PR #130 merged as `0ba16b2`; independent review and focused tests passed; baseline full-suite failures, desktop, offline and physical-paper verification outstanding. |
| S-089 | In progress | PR #128 merged as `e64d17b`; independent review and focused tests passed. Desktop, offline and full-suite verification outstanding. |
| S-088 | Done | Independent review and focused tests passed; PR #126 merged as `c607388`. Concurrent-payment startup race recorded separately. |
| S-087 | In progress | Three-stage close implemented; independent review and focused tests passed. Desktop, offline and printer verification and PR merge outstanding. |
| S-086 | In progress | Print an Account A bill list and sum without closing; independent printer selection. |
| S-085 | In progress | PR #122 merged; independent review and focused tests passed; desktop verification outstanding. |
| S-084 | In progress | PF700 daily Z integration merged in PR #142. On-site register, paper and reset checks remain open. [Release handoff](handoffs/S-084.md#pf700-release-handoff) · [Go-live stories](../stories/backlog.md#pf700-restaurant-go-live) |
| S-083 | In progress | Independent review and focused tests passed; desktop, offline and physical paper verification outstanding. |

| S-082 | Done | Independent review and automated tests passed; owner reports all checks passed; PR #119 merged as `9cb9f72`. |
| S-081 | In progress | Independent review and focused tests passed; desktop verification and PR merge outstanding. |
| S-080 | In progress | Independent code review and automated tests passed; desktop and physical printer verification outstanding. |
| S-001 | Done | Acceptance and review passed; PR #1 merged. |
| S-002 | Done | Acceptance, review and testing passed; PR #2 merged. |
| S-003 | Done | Acceptance, review and testing passed; PR #3 merged. |
| S-004 | Done | PR #4 merged. |
| S-005 | Done | PR #5 merged. |
| S-006 | Done | PR #6 merged. |
| S-007 | Done | Review and focused tests passed; PR #7 merged. |
| S-008 | Done | Review and testing passed; PR #8 merged. |
| S-009 | Done | Review and testing passed; PR #9 merged. |
| S-010 | Done | Review and testing passed; PR #10 merged. |
| S-011 | Done | Review and testing passed; PR #12 merged. |
| S-012 | Done | Review and testing passed; PR #14 merged. |
| S-013 | Done | Review and focused testing passed; PR #16 merged. |
| S-014 | Done | Review and focused testing passed; PR #18 merged. |
| S-015 | Done | Review and focused testing passed; PR #20 merged. |
| S-016 | Done | Review and focused testing passed; PR #22 merged. |
| S-017 | Done | Review and focused testing passed; PR #24 merged. |
| S-018 | Done | Review and focused testing passed; PR #26 merged. |
| S-019 | Done | PR #28 merged as `a4f0e19`. |
| S-020 | Done | PR #29 merged as `b74ef47`. |
| S-021 | Done | PR #30 merged as `93b2d7a`. |
| S-022 | Done | PR #31 merged as `24b3833`. |
| S-023 | Done | PR #32 merged as `0b20266`. |
| S-024 | Done | PR #33 merged as `a479ffd`. |
| S-025 | Done | PR #34 merged as `2bde866`. |
| S-026 | Done | PR #37 merged as `6e6fd63`. |
| S-027 | Done | PR #38 merged as `facea2f`. |
| S-028 | Done | PR #39 merged as `f6db7ec`. |
| S-030 | Done | PR #40 merged as `19ccc65`; refunds deferred. |
| S-031 | Done | PR #36 merged as `55e6f50`. |
| S-032 | In progress | Local recovery worked; separate protected copy and other-machine test deferred until storage is available. |
| S-033 | Blocked | Public-source investigation recorded; provider identity, equipment and fiscal clarification outstanding. |
| S-037 | Blocked | Electron navigation, identity switching, denied access, resize and keyboard verification outstanding; owner authorized S-041–S-043 to proceed. |
| S-038 | Done | Review and sample desktop verification passed; PR #56 merged as `561efa6`. |
| S-039 | Done | Independent review, focused tests and owner-reported desktop checks passed; PR #58 merged as `44e8044`. |
| S-040 | Done | Independent review, focused tests and owner-reported sample Electron checks passed; PR #60 merged as `7a2e5db`. |
| S-041 | Done | Independent review, focused tests and owner-reported sample Electron checks passed. PR #63 merged as `6e04096`. |
| S-042 | Done | Independent review, focused tests and sample desktop checks passed; PR #65 merged as `a57e2b4`. |
| S-043 | Done | Independent review, focused tests and sample desktop checks passed; PR #67 merged as `d26294e`. |
| S-044 | Done | PR #43 merged as `5c361df`; final independent review and offline Electron smoke passed. |
| S-045 | Done | Independent review and focused testing passed; PR #45 merged as `fbbb6cb`. |
| S-046 | Done | Independent review and focused testing passed; PR #47 merged as `f1bc24d`. |
| S-047 | Done | Independent review and focused testing passed; PR #49 merged as `4b8ad6c`. |
| S-048 | Done | Independent review and focused testing passed; PR #51 merged as `9e148f4`. |
| S-049 | Done | Independent review, focused tests and sample desktop checks passed; PR #53 merged as `4ad6604`. |
| S-051 | Done | Independent review and focused recovery tests passed; PR #108 merged as `e624366`. Packaged release upgrade and physical failure evidence outstanding. |
| S-052 | Done | Owner-reported local backup and GUI restore, independent review and focused tests passed; PR #104 merged as `b2285fb`. |
| S-053 | Done | Independent review and focused tests passed; PR #69 merged as `116759f`. |
| S-054 | Done | Independent review and focused checks passed; PR #71 merged as `ad6c827`. |
| S-055 | Done | Independent review and focused tests passed; PR #74 merged as `f41a24f`. |
| S-056 | Done | Marked complete by owner; PR #76 merged. Paper and offline desktop verification remain outstanding. |
| S-057 | Done | Review and focused tests passed; PR #75 merged as `d0759ee`. |
| S-058 | In progress | Report-recovery UX follow-up reviewed and focused tests passed; owner reports earlier offline check passed. Updated desktop and physical printer verification outstanding. |
| S-059 | Done | Shared unpaid-bill slice reviewed and focused tests passed; PR #81 merged as `9af9306`. |
| S-060 | In progress | Independent review and focused tests passed; PR pending. Unmarked legacy test databases unsupported. |
| S-061 | In progress | Independent review, focused tests and owner-reported desktop and printer checks passed; PR awaiting merge. |
| S-062 | In progress | Independent review and focused tests passed; desktop and offline printer verification outstanding. |
| S-063 | Done | Independent review, focused tests and owner-reported desktop, restart and offline checks passed; PR #85 merged as 27613f4. |
| S-064 | Done | Independent review and focused tests passed; owner reports desktop checks worked; PR #86 merged as c47ad18. |
| S-065 | Done | Independent review and focused tests passed; owner reports desktop and offline checks passed; PR #88 merged as `26f15ee`. |

| S-066 | Done | Review and focused tests passed; owner reports desktop and offline checks worked; PR #90 merged as `e1cbf62`. Fluent review unconfirmed. |

## Current

S-052's local recovery exercise is complete. The owner cannot test on another machine now. S-032's separate protected copy and separate-device recovery remain unverified and a prerequisite for S-036 and live use, but do not hold up S-041–S-043 or S-037. S-037 remains blocked pending its own desktop verification on the available machine; the owner authorized S-041–S-043 to proceed and will finish S-037 later. Do not mark S-037 Done without its required evidence and workflow completion.

| S-067 | In progress | PR #92 merged as 1abb638; rendered visual review and desktop verification outstanding. |

| S-068 | In progress | PR #92 merged as 1abb638; owner reports desktop redesign works. Detailed keyboard, resizing and offline evidence outstanding. |

| S-069 | Done | Code review and focused tests passed; owner reports desktop works; PR #93 merged as `d3513ba`. |
| S-070 | Done | Code review and focused tests passed; owner reports everything works; PR #94 merged as `b8cb605`. |
| S-071 | Done | Independent review and focused tests passed; owner reports desktop, language, restart and offline checks work; PR #96 merged as `cce3cee`. |
| S-072 | Done | Independent review and focused tests passed; owner reports desktop and offline checks worked; PR #98 merged as `5875b4d`. |

| S-073 | Done | Independent review and testing passed; PR #100 merged as `b96c239`. Sample Electron offline/restart and browser-demo flows passed; physical printing remains unverified. |
| S-074 | In progress | Independent review and focused tests passed; owner reports English, offline, physical ticket and three-beep checks work; PR pending. |

| S-075 | In progress | PR #102 merged into S-074 branch as 0f08803; not yet on main. Owner reports printer flow works; detailed physical/offline checks and prerequisite verification outstanding. |
| S-076 | Done | Independent review and tests passed; owner confirmed setup, restart, offline workflows and upgrade data; PR #106 merged as `851ce22`. |

| S-077 | In progress | PR #110 merged as `e963ab6`; independent review, full-suite completion and target-machine verification outstanding. |
| S-078 | In progress | PR #112 merged; independent code review and focused tests found no defects, but rendered review and desktop verification remain outstanding. |

| S-079 | Done | PR #114 merged as `e7f382c`; independent review and tests passed; owner reports all detailed checks passed. |
