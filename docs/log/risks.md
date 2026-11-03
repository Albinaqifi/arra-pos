# Risks

- **Local PC failure or theft:** App availability and local data can be lost together. Use independent protected backups and test restoring onto another machine before live use; exact mechanism remains open.
- **Fiscal/provider integration:** North Macedonian fiscal obligations and supplied hardware are not yet verified. Investigate before live operation or committing to integration behavior.
- **Payment/print disagreement:** Physical terminal or printer outcomes can be uncertain. Keep states separate, make retries safe and define staff recovery before real transactions.
- **Financial privacy:** Shared records and aggregates can leak A/B information. Enforce and test scope at the application boundary; exact grant authority is open.
- **Local security:** An unrestricted PC administrator or physical attacker may bypass application permissions. Protect the PC, database and backups and plan credential recovery.
- **Scope and solo maintenance:** Full configurable permissions, reporting and printer integration are significant work. Deliver a small working slice first and add capability incrementally.
- **Future multi-device use:** One-PC assumptions must not leak into domain rules. Future LAN access needs an application service and concurrency design; it is not implemented in v1.
