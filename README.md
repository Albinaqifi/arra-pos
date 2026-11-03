# Arra POS waiter demo

This is a development demo using sample data and simulated actions. It is not a production POS and is not connected to a database, printer or payment system. Changes reset when the page is refreshed or the app closes.

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
