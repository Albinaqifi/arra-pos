// Use decimal text rather than floating point when constructing the printer field.
function cashMovementPayload(direction, amount) {
  if (!['in', 'out'].includes(direction) || typeof amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const normalized = whole.replace(/^0+(?=\d)/, '') + '.' + fraction.padEnd(2, '0');
  if (!/[1-9]/.test(normalized)) return null;
  const payload = (direction === 'out' ? '-' : '') + normalized;
  return Buffer.byteLength(payload, 'ascii') <= 9 ? payload : null;
}
module.exports = { cashMovementPayload };
