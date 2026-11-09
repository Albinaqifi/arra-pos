const fs=require('node:fs');
module.exports = () => ['Tables', 'Order', 'MoveTable', 'MoveItems'].map(name => fs.readFileSync(require.resolve('../../src/waiter/' + name + '.js'), 'utf8')).join('\n');
