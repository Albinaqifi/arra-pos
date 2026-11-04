const fs = require('node:fs');
const path = require('node:path');
function dataDirectory(args, defaultDirectory) {
  const prefix = '--sample-data-directory=';
  const matches = args.filter(arg => arg.startsWith(prefix));
  if (matches.length === 0) return defaultDirectory;
  if (matches.length !== 1) throw new Error('Invalid sample directory');
  const directory = matches[0].slice(prefix.length);
  if (!directory || !path.isAbsolute(directory) || !fs.statSync(path.join(directory, 'SAMPLE-DATA-ONLY')).isFile()) throw new Error('Invalid sample directory');
  return directory;
}
module.exports = { dataDirectory };
