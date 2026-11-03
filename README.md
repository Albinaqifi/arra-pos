# Arra POS waiter demo

This is a development demo using sample data and simulated actions. It is not a production POS and is not connected to a printer or payment system. Desktop table identities and the sample menu persist locally; demo orders and other screen changes reset when the page is refreshed or the app closes.

## Desktop window

Install Node.js 22.12 or later and run the following once while connected to the internet, from this directory:

```sh
npm ci
npx install-electron --no
```

After installation, launch the desktop app with:

```sh
npm run desktop
```

The installed Electron runtime, React and application files run locally; no internet connection or remote login is required to start or use the demo. Close the desktop window to exit. This is a development setup, not an installer for restaurant use.

On startup, the desktop app creates and migrates `arra.sqlite` in Electron's writable `userData` directory. On Windows this is normally `%APPDATA%\arra-pos-waiter-demo\arra.sqlite` (the exact location depends on the operating system and user). It is separate from the application source. Keep this file when updating the app. If initialization fails, the app displays an error and exits without deleting the database. The browser demo does not open this database. Do not use real sales or sensitive data in this development build.

The desktop screen requests a small application-info response through a restricted local bridge and displays its status. The renderer has no direct database or Node access; the browser demo displays its own status. This connection does not persist the demo orders yet.

For the default Windows app-data directory, create the 16 sample tables with the following command in PowerShell, with the desktop app closed:

```powershell
node src/desktop/seed-tables.js "$env:APPDATA\arra-pos-waiter-demo"
```

For a different app-data location, pass that directory instead. This setup can be repeated without duplicating tables or overwriting existing table records. A fresh database shows an empty table list until this command is run. The browser demo continues to use its in-memory sample tables.

Create the sample menu separately, with the desktop app closed:

```powershell
node src/desktop/seed-menu.js "$env:APPDATA\arra-pos-waiter-demo"
```

The seed is repeatable and does not overwrite existing records, including inactive ones. A fresh desktop menu is empty until seeded. Desktop menu prices are sample whole denar amounts; modifiers and editing are deferred. The browser demo keeps its original in-memory menu. Orders and the other actions remain simulated.

Run the database and bridge tests with `npm test` on Node.js 22.13 or later.

## Browser demo

The original browser demo remains available with:

```sh
npm start
```

Open http://localhost:3000. In either version the restaurant sign-in fields are prefilled. Pick a waiter; for a waiter with a PIN, enter any four digits. These are simulated demo interactions, not authentication.

If port 3000 is in use, choose another available port, for example:

```sh
node server.js --port 3001
```

Then open http://localhost:3001. The desktop app does not use this server or port.

The React application is in `src/App.js`. React is included locally in `vendor`. The original design export is retained in `Main.dc.html`.
