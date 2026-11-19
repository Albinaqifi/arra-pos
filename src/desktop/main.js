const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const { dataDirectory } = require('./sample-data-directory');
const { openDatabase } = require('./database');
const { registerApplicationInfo } = require('./application-info');
const { registerTables } = require('./tables');
const { registerTableConfig } = require('./table-config');
const { registerOrders } = require('./orders');
const { registerLegacyOrderAssignment } = require('./legacy-order-assignment');
const { registerBills } = require('./bills');
const { registerPayments } = require('./payments');
const { selectPf700Checkout } = require('./pf700-checkout-mode');
const { registerActivityReport } = require('./activity-report');
const { registerOperationalReports } = require('./operational-reports');
const { registerTransferCorrection } = require('./transfer-correction');
const { registerAdminSentCorrection } = require('./admin-sent-correction');
const { registerBusinessDays } = require('./business-days');
const { registerFinancialVisibility } = require('./financial-visibility');
const { registerBillHistory } = require('./bill-history');
const { registerMoveOrder } = require('./move-order');
const { registerMenuConfig } = require('./menu-config');
const { registerMenu } = require('./menu');
const { registerOrderItems } = require('./order-items');
const { registerOrderHistory } = require('./order-history');
const { registerPrintJobs } = require('./print-jobs');
const { registerSession } = require('./session');
const { registerLanguage } = require('./language');
const { registerEmployeeConfig } = require('./employee-config');
const testPrinting = require('./test-printing');
const { selectPreparationPrinting } = require('./preparation-printing');
const { printTestJob } = require('./windows-test-printer');

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
  let fiscalCheckout;
  try {
    const directory = dataDirectory(process.argv, app.getPath('userData'));
    try {
      fiscalCheckout = selectPf700Checkout(process.argv, directory);
    } catch {
      dialog.showErrorBox('PF700 checkout',
        'Arra could not start the selected PF700 mode. Check the launcher, data folder and local settings.\n\nArra nuk mund te hape menyren e zgjedhur per PF700. Kontrolloni programin nises, dosjen e te dhenave dhe cilesimet lokale.');
      app.quit();
      return;
    }
    database = openDatabase(directory);
  } catch (error) {
    dialog.showErrorBox('Database could not be opened / Baza e te dhenave nuk mund te hapet',
      'Arra POS could not initialize its local database. Check available disk space, that the application data folder is writable and that this app is not older than the database. Preserve the database and its sidecar files. Close the app and seek support if the problem continues.\n\nArra POS nuk mund te hape bazen lokale te te dhenave. Kontrolloni hapesiren e lire ne disk, qe dosja e te dhenave te lejoje shkrimin dhe qe aplikacioni te mos jete me i vjeter se baza e te dhenave. Ruani bazen e te dhenave dhe skedaret e saj ndihmes. Mbyllni aplikacionin dhe kerkoni ndihme nese problemi vazhdon.');
    app.quit();
    return;
  }
  const isAllowedSender = (event) =>
    Boolean(mainWindow && event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame);
  session = registerSession(require('electron').ipcMain, isAllowedSender, database);
  registerApplicationInfo(require('electron').ipcMain, isAllowedSender);
  registerLanguage(require('electron').ipcMain, isAllowedSender, database, session);
  registerEmployeeConfig(require('electron').ipcMain, isAllowedSender, database, session);
  registerTableConfig(require('electron').ipcMain, isAllowedSender, database, session);
  registerTables(require('electron').ipcMain, isAllowedSender, database, session);
  registerOrders(require('electron').ipcMain, isAllowedSender, database, session);
  registerLegacyOrderAssignment(require('electron').ipcMain, isAllowedSender, database, session);
  registerBills(require('electron').ipcMain, isAllowedSender, database, session, fiscalCheckout);
  const windowsPrinter = process.platform === 'win32' ? printTestJob : null;
  const preparation = selectPreparationPrinting(process.argv, database, fiscalCheckout, windowsPrinter);
  // Fiscal checkout selects only its PF700 for receipts. The preparation
  // adapter is never passed to payment, bill history or reporting.
  const localPrinter = fiscalCheckout ? null : windowsPrinter;
  registerPayments(require('electron').ipcMain, isAllowedSender, database, session, localPrinter, fiscalCheckout);
  registerTransferCorrection(require('electron').ipcMain, isAllowedSender, database, session);

  registerBusinessDays(require('electron').ipcMain, isAllowedSender, database, session,
    localPrinter || (() => 'failed'), fiscalCheckout?.dailyReport);
  registerFinancialVisibility(require('electron').ipcMain, isAllowedSender, database, session);
  registerBillHistory(require('electron').ipcMain, isAllowedSender, database, session, { saveDialog: () => dialog.showSaveDialog(mainWindow, { title: 'Export bill history', defaultPath: 'bill-history.xml', filters: [{ name: 'Excel XML workbook', extensions: ['xml'] }] }), print: localPrinter });
  registerActivityReport(require('electron').ipcMain, isAllowedSender, database, session);
  registerOperationalReports(require('electron').ipcMain, isAllowedSender, database, session);
  registerMoveOrder(require('electron').ipcMain, isAllowedSender, database, session);
  registerMenuConfig(require('electron').ipcMain, isAllowedSender, database, session);
  registerMenu(require('electron').ipcMain, isAllowedSender, database, session);
  registerAdminSentCorrection(require('electron').ipcMain, isAllowedSender, database, session, preparation);
  registerOrderItems(require('electron').ipcMain, isAllowedSender, database, session, preparation);
  registerOrderHistory(require('electron').ipcMain, isAllowedSender, database, session);
  registerPrintJobs(require('electron').ipcMain, isAllowedSender, database, session, preparation?.preparationMode);
  testPrinting.registerTestPrinting(require('electron').ipcMain, isAllowedSender, database, session,
    preparation?.adapter || localPrinter || (() => 'failed'), !!preparation || !fiscalCheckout, !preparation, preparation?.preparationMode);
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
