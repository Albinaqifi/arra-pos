const path = require('node:path');

function isS096TrainingDirectory(directory, appData = process.env.APPDATA) {
  if (!directory || !appData || !path.isAbsolute(directory) || !path.isAbsolute(appData)) return false;
  const resolved = path.resolve(directory);
  const root = path.join(path.resolve(appData), 'Arra POS S096 Simulated Training');
  return /^[a-f0-9]{32}$/.test(path.basename(resolved)) && path.dirname(resolved).toLowerCase() === root.toLowerCase();
}

module.exports = { isS096TrainingDirectory };
