'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { createBill2JournalRecovery } = require('../../src/desktop/pf700-bill2-journal');
const { openIncidentProfile, registerRecoveryServices } = require('./services');

let profile;
let window;
app.whenReady().then(() => {
  try {
    profile = openIncidentProfile(process.env.APPDATA);
    const evidence = path.join(process.env.LOCALAPPDATA, 'Arra POS', 'PF700 commissioning');
    // The build embeds the digest independently supplied from the POS.
    const journalRecovery = createBill2JournalRecovery(evidence, APPROVED_JOURNAL_SHA256);
    const sender = event => !!window && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame;
    const session = registerRecoveryServices(ipcMain, sender, profile, journalRecovery);
    window = new BrowserWindow({width:1280, height:900, title:'Arra POS • Bill #2 recovery',
      autoHideMenuBar:true, webPreferences:{nodeIntegration:false, contextIsolation:true,
        sandbox:true, preload:path.join(__dirname, 'preload.js')}});
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('page-title-updated', event => event.preventDefault());
    window.on('closed', () => { session.signOut(); window = null; });
    return window.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } catch {
    dialog.showErrorBox('Arra POS • Bill #2 recovery',
      'Could not open the enrolled kit 1.0.10 database for bill #2. Keep the original files and report this message.');
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => profile?.close());
