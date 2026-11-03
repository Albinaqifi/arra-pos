const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const { openDatabase } = require('./database');
const { registerApplicationInfo } = require('./application-info');
const { registerTables } = require('./tables');
const { registerOrders } = require('./orders');
const { registerMenu } = require('./menu');
const { registerOrderItems } = require('./order-items');
const { registerSession } = require('./session');

let database;
let mainWindow;
let session;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = window;
  window.on('closed', () => { if (mainWindow === window) { mainWindow = undefined; if (session) session.signOut(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(path.join(__dirname, '../../index.html'));
}

app.whenReady().then(() => {
  try {
    database = openDatabase(app.getPath('userData'));
  } catch (error) {
    dialog.showErrorBox('Database could not be opened',
      'Arra POS could not initialize its local database. Check that the application data folder is writable and that this app is not older than the database. Your existing data has not been deleted. Close the app and seek support if the problem continues.');
    app.quit();
    return;
  }
  const isAllowedSender = (event) =>
    Boolean(mainWindow && event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame);
  session = registerSession(require('electron').ipcMain, isAllowedSender, database);
  registerApplicationInfo(require('electron').ipcMain, isAllowedSender);
  registerTables(require('electron').ipcMain, isAllowedSender, database);
  registerOrders(require('electron').ipcMain, isAllowedSender, database);
  registerMenu(require('electron').ipcMain, isAllowedSender, database);
  registerOrderItems(require('electron').ipcMain, isAllowedSender, database);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  if (database) database.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
