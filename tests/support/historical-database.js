const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Construct a real historical schema using exactly the migrations through the
// requested version. Later migrations must not run while seeding the fixture.
function historicalDatabase(version) {
  const filename = require.resolve('../../src/desktop/database');
  const source = fs.readFileSync(filename, 'utf8');
  const firstLaterMigration = source.indexOf(`  { version: ${version + 1},`);
  const end = source.indexOf('\n];', firstLaterMigration);
  if (firstLaterMigration < 0 || end < 0) throw new Error('Historical migration boundary not found');
  const historical = source.slice(0, firstLaterMigration) + source.slice(end);
  const module = { exports: {} };
  const databaseRequire = createRequire(filename);
  vm.runInNewContext(`(function(require,module,exports){${historical}\n})`)(databaseRequire, module, module.exports);
  return module.exports;
}

module.exports = { historicalDatabase };
