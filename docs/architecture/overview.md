# Architecture overview

Status: initial architecture based on approved intent and accepted recommendations. `[P]` marks implementation detail to validate; open business and integration details remain in `../log/open-questions.md`.

## Stack and deployment

- React screens, TypeScript [P], and Node.js business logic in one local desktop application. [P] Use Electron for the desktop shell, subject to a small installation and security proof of concept. The restaurant PC runs the app and stores its SQLite database locally. Internet is not needed for core service.
- SQLite provides transactional local storage. [P] Use a maintained SQLite driver and versioned schema migrations. All database access goes through application code, not React screens.
- The same application contains waiter and admin screens, sharing the same rules and data. A restricted transfer-manager view uses the same permission checks.
- No separate server, cloud service, job broker or database server is required for the first release. [P] A local background task inside the app handles backup and, later, printer work. A failed task is visible and does not silently change financial state.
- Keep printer and fiscal integrations behind interfaces; actual provider requirements and hardware are deferred. In-app notices first. Store any necessary attachments locally [P]; none are required for the initial foundation.

## Processes and modules

The desktop shell starts the app and provides a narrow, validated bridge from the screen to local application services. Services authenticate the session, check permission and scope, validate rules, and use the database. [P] Place database access and sensitive operations in a privileged local process; do not expose Node or raw database access to the screen. React is for display and input, not the authority for permissions or money.

Suggested structure [P]:

```text
src/
  ui/              waiter, admin and shared screens
  application/     use cases, authorization and business rules
  domain/          concepts, validation and calculations
  infrastructure/  SQLite, backups, printer adapters
  desktop/         desktop startup and restricted bridge
  shared/          request/response types
migrations/        versioned database changes
tests/             rule, integration and key workflow tests
```

## Example request

A waiter selects **Send Order** → React sends an authenticated request through the local bridge → the application checks identity, permission and order state → one database transaction records the send round and ticket/job records → the response updates the screen → a local task attempts printing when an integration exists. A retry refers to the same job and never adds sale items. An uncertain physical print is shown as uncertain.

## Admin changes

An authorized admin edits a product or permission → the application validates the change and records it → the database saves the new configuration and audit event → screens read the updated configuration. Existing orders retain their historical item and price details. Authorization is rechecked on each protected request.

## Delivery and verification

[P] Start with local startup, migrations, accounts and a small vertical slice of tables/orders, using sample data and no real payments. Add workflows in increments. Automated tests cover business rules, permissions, transactions and a few complete flows; manual checks cover usability and actual printers. [P] CI runs tests and build checks on code changes. Real fiscal/payment integration and live operation require separate provider and local legal verification.

SQLite is suitable for this local low-concurrency model. If future devices are added, they should call an application service on the machine holding the database, not directly open the SQLite file on a network share. Multiple active devices, LAN service design and migration to another database remain future work.
