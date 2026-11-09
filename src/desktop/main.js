const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const { dataDirectory } = require('./sample-data-directory');
const { openDatabase } = require('./database');
const { registerApplicationInfo } = require('./application-info');
const { registerTables } = require('./tables');
const { registerTableConfig } = require('./table-config');
const { registerOrders } = require('./orders');
const { registerBills } = require('./bills');
const { registerPayments } = require('./payments');
const { registerOperationalReports } = require('./operational-reports');
const { registerTransferCorrection } = require('./transfer-correction');
const { registerBusinessDays } = require('./business-days');
const { registerFinancialVisibility } = require('./financial-visibility');
const { registerMoveOrder } = require('./move-order');
const { registerMenuConfig } = require('./menu-config');
const { registerMenu } = require('./menu');
const { registerOrderItems } = require('./order-items');
const { registerOrderHistory } = require('./order-history');
const { registerPrintJobs } = require('./print-jobs');
const { registerSession } = require('./session');
const { registerEmployeeConfig } = require('./employee-config');

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
  window.loadFile(path.join(__dirname, '../../dist/index.html'));
}

app.whenReady().then(() => {
  try {
    database = openDatabase(dataDirectory(process.argv, app.getPath('userData')));
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
  registerEmployeeConfig(require('electron').ipcMain, isAllowedSender, database, session);
  registerTableConfig(require('electron').ipcMain, isAllowedSender, database, session);
  registerTables(require('electron').ipcMain, isAllowedSender, database, session);
  registerOrders(require('electron').ipcMain, isAllowedSender, database, session);
  registerBills(require('electron').ipcMain, isAllowedSender, database, session);
  registerPayments(require('electron').ipcMain, isAllowedSender, database, session);
  registerTransferCorrection(require('electron').ipcMain, isAllowedSender, database, session);
  registerBusinessDays(require('electron').ipcMain, isAllowedSender, database, session);
  registerFinancialVisibility(require('electron').ipcMain, isAllowedSender, database, session);
  registerOperationalReports(require('electron').ipcMain, isAllowedSender, database, session);
  registerMoveOrder(require('electron').ipcMain, isAllowedSender, database, session);
  registerMenuConfig(require('electron').ipcMain, isAllowedSender, database, session);
  registerMenu(require('electron').ipcMain, isAllowedSender, database, session);
  registerOrderItems(require('electron').ipcMain, isAllowedSender, database, session);
  registerOrderHistory(require('electron').ipcMain, isAllowedSender, database, session);
  registerPrintJobs(require('electron').ipcMain, isAllowedSender, database, session);
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
