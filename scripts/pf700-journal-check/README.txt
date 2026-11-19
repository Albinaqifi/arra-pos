PF700 electronic journal check

This is an exploratory, read-only check for the Synergy PF700 on COM3. It does
not print, open or close a receipt, record a sale, or reconcile a payment.
Its command syntax and the installed 1.00MK firmware remain unverified.

IMPORTANT: Every inquiry can replace the printer's cached last command reply.
Do not run this check if ANY sale or fiscal report has an unresolved outcome,
including transactions outside Arra. Resolve those first with the responsible
operator or service provider. Shut down Arra and other programs using the
printer. The confirmation asks you to attest to this; the tool cannot verify it.

1. Extract the complete ZIP on the Windows POS. The existing Arra 1.0.3
   offline-test runtime must be present for this Windows account.
2. Choose an already completed, reconciled receipt that is also the last
   printed document. Have its seven-digit document number, printer case-label
   serial, and optional item, tender and amount text available locally. Do not
   run this tool to investigate an unresolved receipt.
3. Open PF700-Journal-Check.cmd. Read both prompts and type CLEAR and then READ
   only if their conditions are met; Enter at either prompt cancels. After the
   first confirmation, enter the printer serial, document number, and up to
   three optional phrases from the known receipt. Blank phrases are skipped.
4. The tool connects, checks identity and closed receipt status, checks the
   last document number, and attempts the journal read. Stop and ask for help
   if a check fails. A missing document, unsupported reply, empty result or
   absent phrase is inconclusive; it does not prove a receipt did not exist.
5. The display reports a line count, termination condition and whether each
   supplied phrase appeared. It does not display or save receipt text. You may
   share those results without sharing the serial, document number, phrases,
   receipt, or other customer and sales details. Typed input is visible on the
   local screen.

This test does not establish whether journal text is complete, whether an open
receipt can be read, or whether another payment or recovery action is safe.
