const printing = require('./test-printing');

// The validated fiscal launcher determines which preparation adapter can run.
// The supervised one-sale trial keeps all Windows output disabled.
function selectPreparationPrinting(args, db, fiscalCheckout, windowsPrinter) {
  if (fiscalCheckout?.mode === 'simulation') {
    const outcome = db.prepare('SELECT result FROM simulated_printers WHERE destination=?');
    return {
      ...printing,
      preparationMode: 'training',
      adapter({ queue }) {
        const result = outcome.get(queue)?.result;
        if (result === 'uncertain') throw Error('Simulated preparation reply lost');
        return result === 'success' ? 'accepted' : 'failed';
      },
    };
  }
  if (!windowsPrinter) return null;
  if (fiscalCheckout?.mode === 'device' && args.includes('--pf700-routine-checkout')) {
    return { ...printing, preparationMode: 'routine', adapter: windowsPrinter };
  }
  if (!fiscalCheckout && args.some(arg => arg.startsWith('--sample-data-directory='))) {
    return { ...printing, adapter: windowsPrinter };
  }
  return null;
}

module.exports = { selectPreparationPrinting };
