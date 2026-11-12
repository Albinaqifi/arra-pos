# Arra POS waiter demo

This is a development demo using sample data and simulated actions. It is not a production POS and is not connected to a payment system. An isolated Windows sample database can use experimental test printing. Desktop tables, active table orders, pending items and their notes, and the sample menu persist locally. Other screen actions remain simulated.

Preparation tickets retain local simulated print jobs and attempt history. The simulation controls do not control a physical printer. Tickets created before print jobs were introduced are recorded as uncertain because no attempt result was saved at the time.

Windows sample-only printing is an experiment, not fiscal integration or permission for real sales. Launch an isolated sample database with `--sample-data-directory` as described below. The test print area shows separate kitchen, bar and bill queue names, initially `Arra Test Printer`. An authenticated sample waiter with employee-management permission can enter an exact Windows queue name and save each destination independently. Create or rename queues in Windows printer settings first; this app does not install drivers. Sending an order submits a separate ticket per destination for that round. After generating a bill, the test-bill button submits its saved lines; it never records payment or a charge. While the order remains open, the waiter can retry from the test job list. After payment, an owner with access to that payment's effective account can print or retry from its financial detail; the combined identity can also access unpaid bills.

Queue acceptance is not proof of paper output. Check the printer and paper for every job; a missing queue is shown as failed and a driver failure, interruption or unknown callback remains uncertain. Refresh the test job list, check the paper and acknowledge that a duplicate is possible before retrying. A restart never automatically resubmits an uncertain job. Retrying uses its saved snapshot and does not send the order or record a payment again. For the Birch experiment use the owner's `Arra Test Printer` queue and inspect separate mixed-order tickets and the test bill for content and readability. When additional physical printers become available, map each destination to its own Windows queue and repeat the same sample checks. This does not resolve provider, legal or fiscal verification.

Closing a system day also creates a non-fiscal turnover report and attempts to print it on Windows. An authorized combined-account day closer can set its dedicated queue in the close-day screen; it is initially copied from the bill queue and can then be changed independently. The saved report and print status remain available after closing. Refresh the status and check the paper before retrying an uncertain result. Queue acceptance does not confirm paper output. Verify this flow with sample data before relying on the printer.

## Desktop window

Install Node.js 22.12 or later and run the following once while connected to the internet, from this directory:

```sh
npm ci
npx install-electron --no
npm run build
```

After installation, launch the desktop app with:

```sh
npm run desktop
```

Run `npm run build` again after changing frontend source. The build writes local assets to `dist`; include the complete `dist` directory when packaging. Electron loads `dist/index.html` via file URLs and needs no development server. The installed Electron runtime, React and application files run locally; no internet connection or remote login is required to start or use the demo. Close the desktop window to exit. This is a development setup, not an installer for restaurant use.

On startup, the desktop app creates and migrates `arra.sqlite` in Electron's writable `userData` directory. On Windows this is normally `%APPDATA%\arra-pos-waiter-demo\arra.sqlite` (the exact location depends on the operating system and user). It is separate from the application source. Keep this file when updating the app. If initialization fails, the app displays an error and exits without deleting the database. The browser demo does not open this database. Do not use real sales or sensitive data in this development build.

Create a development-only local account before signing in, with the desktop app closed, in an interactive PowerShell terminal:

```powershell
node src/desktop/bootstrap-user.js "$env:APPDATA\arra-pos-waiter-demo"
```

Enter a sample username and a password when prompted; password entry is hidden. The command creates only the first account and refuses to overwrite an existing account. There is no default password. It is a development bootstrap, not a production recovery procedure. Credentials are stored as salted scrypt hashes locally. Signing out or closing the window clears the in-memory session.

The first account receives the available operational and employee-management permissions. To manage employees, sign in with your own administrator account, select the same name, then choose **Manage employees** on the tables screen. Create accounts with a password and optional four-digit PIN; new accounts have no grants until configured. The screen also supports account activation, credential resets and individual operational grants. Administrators may change only grants they hold and may reset credentials only for accounts whose grants they hold. At least one active account must retain both employee-management permissions. Permission changes and credential resets are recorded with actor, target and time in an append-only local audit. Financial permissions and cross-owner access cannot be configured pending Q-01. A credential reset or deactivation invalidates the affected active identity; sign in again if you reset your own credential.

After restaurant sign-in, the selected active local user supplies the operational identity. Selecting a user without a PIN cannot verify who is physically using the PC, so attribution is weaker. Four-digit PINs are guessable and have no rate limiting yet. Table, menu and employee administration additionally require the selected identity to match the password-authenticated account. The current order services do not record an audit history; action history is planned for S-016. Do not use this build for real operations.

The desktop screen requests a small application-info response through a restricted local bridge and displays its status. The renderer has no direct database or Node access; the browser demo displays its own status. Opening a desktop table creates or resumes its local active order.

For the default Windows app-data directory, create the 16 sample tables with the following command in PowerShell, with the desktop app closed:

```powershell
node src/desktop/seed-tables.js "$env:APPDATA\arra-pos-waiter-demo"
```

For a different app-data location, pass that directory instead. This setup can be repeated without duplicating tables or overwriting existing table records. A fresh database shows an empty table list until this command is run. The browser demo continues to use its in-memory sample tables.

Create the sample menu separately, with the desktop app closed:

```powershell
node src/desktop/seed-menu.js "$env:APPDATA\arra-pos-waiter-demo"
```

The seed is repeatable and does not overwrite existing records, including inactive ones. A fresh desktop menu is empty until seeded. Desktop menu prices are sample whole denar amounts; modifiers and editing are deferred. The browser demo keeps its original in-memory menu. Pending items and their notes are saved locally. Sending, moving and closing desktop orders are not yet available.

Run the database and bridge tests with `npm test` on Node.js 22.13 or later.

## Browser demo

After `npm run build`, the original browser demo remains available with:

```sh
npm start
```

Open http://localhost:3000, which serves the separate `demo.html` entry point. It shows a persistent browser-demo banner; all its data and actions are simulated and disappear on reload. The desktop entry point requires its local bridge and stops with an error if it is unavailable. Browser sign-in accepts any nonempty values and is simulated. Pick a waiter; for a waiter with a PIN, enter any four digits. Waiter selection is simulated only in the browser demo.

If port 3000 is in use, choose another available port, for example:

```sh
node server.js --port 3001
```

Then open http://localhost:3001. The desktop app does not use this server or port.

The React application is in `src/App.js` and `src/AdminShell.jsx`. The build compiles JSX with esbuild and copies locally vendored React into `dist`. The original design export is retained in `Main.dc.html`.

### Financial visibility sample setup

For an isolated sample database with separately authenticated waiter, A, B, and combined identities, run `node src/desktop/create-sample-accounts.js` in an interactive terminal. Choose four distinct sample passwords; entry is hidden. The command creates a new directory in the temporary folder, prints its path and a launch command, and never opens or modifies an existing database. Use only sample information. The waiter can operate shared orders; owners can see only their assigned paid financial records. Because shared operational records are not yet classified, owner accounts cannot browse them. Sign in as an identity and select the same name for its financial access. The newly provisioned combined sample identity also has the distinct business-day close grant; older sample databases do not receive this grant automatically. To preserve version 22, 23 or 24 sample history, close the app and run `node src/desktop/upgrade-sample-business-days.js "<absolute-path-to-sample-arra.sqlite>"`. Authenticate with the existing combined sample account. This requires the sample marker, copies and upgrades the database to a new temporary directory, grants only that account the close permission and leaves the original untouched. The manual periods are provisional, and their initial period includes pre-upgrade payments.

Upgraded accounts receive no financial scope automatically and cannot access protected operations. To recover existing sample data, use Node.js 23.8 or later and run `node src/desktop/recover-sample.js "<absolute-path-to-arra.sqlite>"` with the app closed and enter an existing sample username and password. The command takes a database-safe snapshot into a new temporary directory, migrates only that copy, and assigns only the authenticated account a waiter scope; it refuses databases containing owner scopes. The original is not modified. Use the printed launch command to open the copy. The normal development bootstrap creates a waiter-scoped account only in an empty database. This sample setup does not decide Q-01 or provide a production account recovery or cross-owner grant mechanism. Keep the existing database intact.

For sample-only transfer testing, close the app and run `node src/desktop/create-sample-transfer-manager.js "<absolute-sample-directory>"` interactively. Choose a four-digit sample PIN; it is stored hashed and is not displayed. Sign in with a sample restaurant account and select Transfer Manager at the end of the user list. This helper modifies only the marked sample database; it is not production provisioning. Reasons are optional pending Q-08, and the open manual business period is the provisional filter.

To prepare order and payment scenarios for the turnover report, first create the isolated sample accounts above and copy the displayed directory path. With the desktop app closed, run these PowerShell commands, replacing the example path with that directory:

```powershell
$sample = 'C:\path\to\arra-sample-directory'
node src/desktop/seed-tables.js $sample
node src/desktop/seed-menu.js $sample
node src/desktop/create-sample-transfer-manager.js $sample
node src/desktop/seed-sample-scenarios.js $sample
npm run build
npx electron . --sample-data-directory="$sample"
```

The scenario command requires a marked sample database with no existing orders or payments and refuses to run twice. Tables 1–4 have paid bills: cash A, cash B, card A, and cash B transferred to A. Table 5 has an unpaid bill, table 6 has an unsent order, and table 7 has a sent item cancelled through a recorded correction; the app has no cancelled-order status. The sample setup uses simulated preparation printing and does not print those tickets. If an operation fails partway through, create a fresh sample database; the command does not delete existing records.

## Backup and recovery

See [backup and recovery procedure](docs/backup-recovery.md) for the offline encrypted backup command, isolated restore, verification and limitations. Use sample data only until readiness.
