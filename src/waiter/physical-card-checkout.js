export function canPrepareCard(bill) {
  return bill?.fiscalMode === 'device' && bill.physicalCardControls === true &&
    bill.physicalCardAvailable === true && bill.physicalCardUnavailable !== true &&
    bill.physicalCardHold !== true && !bill.physicalCardIntent && !bill.fiscal;
}

export function cardSelectionUnavailable(bill) {
  return bill?.physicalCardUnavailable === true || (bill?.fiscalMode === 'device' && !canPrepareCard(bill));
}

export function isPhysicalCard(bill, method) {
  return !!bill?.physicalCardIntent || (bill?.fiscal?.mode === 'device' && bill.fiscal.method === 'card') ||
    (bill?.fiscalMode === 'device' && method === 'card');
}

export function matchesCardDocument(bill, expectedDocument) {
  const fiscal = bill.fiscal, receipt = fiscal?.receipt;
  return fiscal?.mode === 'device' && fiscal.method === 'card' &&
    typeof fiscal.reference === 'string' && /^[0-9]{7}$/.test(fiscal.reference) &&
    (!expectedDocument || fiscal.reference === expectedDocument) &&
    receipt?.billId === bill.id && receipt.account === 'A' && receipt.method === 'card' &&
    receipt.total === bill.total && Array.isArray(receipt.lines);
}

export function physicalCardStep(bill) {
  const intent = bill.physicalCardIntent;
  if (bill.physicalCardHold === true) return 'hold';
  if (bill.fiscal?.status === 'submitted' && matchesCardDocument(bill)) return 'settle';
  if (bill.physicalCardUnavailable === true) return 'hold';
  if (canPrepareCard(bill)) return 'prepare';
  if (bill.fiscal || bill.fiscalMode !== 'device' || bill.physicalCardControls !== true ||
      intent?.profileMatches !== true || !Number.isSafeInteger(intent.id) || intent.id <= 0) return 'hold';
  if (intent.status === 'prepared') return 'terminal';
  if (intent.status === 'approved' && intent.canDispatch === true) return 'register';
  return 'hold';
}

export function cardGuidance(step, fresh, approved) {
  if (step === 'prepare') return 'Prepare this bill before using the separate card terminal for {amount}.';
  if (step === 'terminal') return fresh
    ? 'Use the separate terminal once for {amount}. Record only a confirmed result for this amount. If it is unclear, check the original transaction without charging again.'
    : 'Check the original terminal transaction for {amount}. Do not charge the card again. Confirm only a matching approval.';
  if (step === 'register') return 'The terminal approved {amount}. Do not charge the card again. Registering the Card A sale will print a real PF700 receipt.';
  if (approved) return 'The terminal approved {amount}. Do not charge the card again.';
  return 'Check the original terminal transaction for {amount}. Do not charge the card again.';
}
