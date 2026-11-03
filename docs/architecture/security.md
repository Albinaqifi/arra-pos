# Security

Status: initial policy and implementation direction, not a final access matrix. `[P]` marks proposals. Q-01 in `../log/open-questions.md` remains open on who may grant cross-account financial access. Requirements specify server-side enforcement; in this local desktop design the equivalent trusted application service enforces it, never the screen alone.

## Roles and permissions

| Role | Allowed starting scope | Restrictions |
| --- | --- | --- |
| Waiter | [P] Access tables, enter and send items, move orders/items and record payments as permitted. | No editing or removing sent items; no admin or transfer action by default. Optional PIN means attribution may be weaker. |
| Owner A administrator | Assigned admin actions and A financial information. | No B financial information under the current requirements. |
| Owner B administrator | Assigned admin actions and B financial information. | No A financial information under the current requirements. |
| Combined administrator | Assigned actions and A, B and combined financial information. | Only granted actions; separately authenticated. |
| Transfer manager | Inspect eligible history and correct eligible cash B to A before day close. | No ordinary ordering, admin, card-to-B, A-to-B or post-close correction. |

[P] Grant viewing and changing separately, with configurable roles and individual permissions, and a simple authorized management screen. Enforce financial scope on every request, search, aggregate, report, export and audit view. Shared operational visibility and authority to modify access remain unresolved; default to the documented owner restrictions. Never assume a UI control is a security boundary.

## Authentication and local protection

[P] Authenticate locally; use unique admin identities and securely hashed passwords/PINs with a suitable password-hashing algorithm and per-credential salts. Rate-limit failed attempts, support deactivation, session lock and controlled recovery. Exact policies can be refined. Do not depend on internet or a cloud login. Protect the desktop bridge, validate requests and expose no direct database or unrestricted system access to the UI. Protect the local database and backups with operating-system access controls; [P] evaluate encryption and key recovery before deployment. Anyone with unrestricted operating-system or physical access may bypass application controls; secure the PC and backups accordingly.

## Audit and sensitive data

Record material actions, actor, time, affected record and relevant reason/context, including permission changes, payments, voids, refunds and corrections. Audit events are append-only in ordinary application workflows; restrict who can view them and avoid exposing another owner's data. Do not log passwords, PINs, credential hashes, session secrets or payment-card details. Avoid unnecessary personal data and item notes in logs. Never store card details merely to record a terminal payment.

Retention, export and deletion requirements are not decided. Preserve records until a policy is verified for North Macedonia; do not assume indefinite retention is compliant. Backup copies require the same protection and an eventual retention policy. Before live use, verify fiscal, tax, employee-data and retention obligations with appropriate local expertise.
