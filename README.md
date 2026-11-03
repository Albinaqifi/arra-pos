# Arra POS waiter demo

This is a development demo using sample data and simulated actions. It is not a production POS and is not connected to a printer or payment system. Screen changes reset when the page is refreshed or the app closes; the new local database is a foundation and is not yet connected to the demo screens.

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
