PF700 v5 | Compare one closed cash receipt with its electronic journal

Start with the paper from the reconciled cash sale. Confirm it is still the
last document the printer printed, including reports. If it is unavailable,
another document followed it, or any sale or fiscal report is unresolved,
stop here. Creating a new receipt is outside this check.

Each inquiry can replace the printer's last saved command reply. This program
relies on you to know that every sale and fiscal report is resolved, including
those made outside Arra. An unresolved printer needs its existing evidence.

When ready to run the check on the 64-bit Windows POS

1. Close Arra and every other program using the PF700 on COM3. Keep the
   printer idle throughout. Leave its serial driver and connection in place.
2. Extract the complete ZIP into a new folder. Arra-S096-USB-Test-v5.zip
   includes the offline runtime. The smaller Arra-PF700-Journal-Check-v5.zip
   uses the existing Arra 1.0.3 offline-test runtime. Both use built-in
   Windows PowerShell. Open PF700-Journal-Check.cmd from the extracted folder.
3. Read the first prompt. Enter alone cancels. Type CLEAR only after confirming
   that every transaction and fiscal report is resolved and the printer is idle.
4. Enter the intended printer's 11-character case serial and the paper's
   seven-digit last document number locally. Copy these three complete lines
   from the paper, preserving case, spelling, currency signs and punctuation:

   - The line containing the item name.
   - The line containing the total label and the receipt total.
   - The line containing the Cyrillic cash label and the cash amount.

   Then enter the complete amount exactly as printed on both money lines.
   You can type one space for alignment padding. If either money label and
   amount appear on separate lines, the two amounts are printed differently,
   a line includes personal details, or you cannot enter the exact Cyrillic
   text, close the window before connecting. Report only the layout limitation.
5. The final prompt asks for READ to connect and allows Enter alone to cancel.
   The program checks the case serial, observed 1.00MK firmware layout,
   closed status and the exact last document
   number before reading that document's journal, up to 300 text lines.
6. Report only the single line starting with "Lines=" or the error message.
   Your typed entries are visible locally. Keep the paper, serial number,
   document number, item text, amounts and any photos on the POS side.

The item, total and cash counts indicate how many journal lines exactly
matched each complete paper line after folding ASCII spaces. The document
count indicates how many lines contained the entered number as a separate
token, which can also occur in an unrelated field. An absent line, duplicate
or end-of-data is inconclusive. Only a document separator marked the end in
the earlier 32-line check. A different count can occur on other receipts.

These observations describe one already reconciled document. The program
uses read commands, holds receipt text only in memory, and never accesses
Arra's database or changes its payments. Recovery of an open or uncertain
receipt requires separate evidence.
