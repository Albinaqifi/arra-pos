# S-033 — Fiscal and printer investigation

## S-084 update: Synergy PF700, 2026-11-18

For the latest physical checkout evidence, the 1.0.7 daily report and the remaining Windows release work, see the [PF700 release handoff](progress/handoffs/S-084.md#pf700-release-handoff).

The owner identified the fiscal printer in a photograph as a Synergy PF700 and clarified that S-084's intended end result is an actual Account A fiscal daily report. The printer is on the POS PC, and the owner requested preparation without contacting it. Accent's [download page](https://www.accent.mk/%D0%BF%D0%BE%D0%B4%D0%B4%D1%80%D1%88%D0%BA%D0%B0/?lang=en) lists PF550/PF700 control codes, example input files and Windows communication tools. Its [device page](https://synergy.com.mk/?page_id=47) lists network, USB and serial connections.

### POS connection prepared for S-084

The Windows 10 POS showed the Prolific USB-to-serial adapter on **COM3**. The owner ran Arra 1.0.3's live status diagnostic on that POS and supplied the resulting screen. The PF700 answered at **9600 baud, 8 data bits, no parity, one stop bit**, with handshake disabled. Both status fields were `888080e1809a`. The owner subsequently ran paper test v2 on that POS and confirmed the PF700 printed the diagnostic slip.

The resulting diagnostic slip identifies the printer as **SYNERGY FP-700CRX**, with firmware **1.00MK** dated **23 October 2014**, and lists **RS232 at 9600 bps**. The slip does not identify the tax group assigned to coffee in the restaurant's menu.

The operator ran the read-only VAT checker on the POS and reported **В (V) = 10%** and **А = 18%**. On 19 November 2026 the owner confirmed how Arra should classify dine-in sales. Food and nonalcoholic drinks, including espresso, use **В (10%)**. Alcoholic drinks use **А (18%)**. The supplied workbook lists these rates on its `Shitja ne lokal` sheet. Its purchase-rate column applies to supplier invoices. [VAT Act, Articles 29 and 30-а](https://ujp.gov.mk/files/attachment/0000/0986/______________________________________.____________267____30.12.2025.pdf#page=18) · [Fiscal equipment rulebook, Article 26](https://www.ujp.gov.mk/files/attachment/0000/1323/___________________________14_03_2022____________60-22.pdf#page=13)

In the packaged 105-item Arra menu this rule maps 89 items to В and 16 alcoholic drinks to А. The latter comprise 2 beers, 8 wines, 2 rakis and 4 other spirits. The product's stored group now follows the item into the bill, even if the menu changes before payment.

### Checkout and the 1.0.5 identity check

On site, command 90 with option 0 returned a valid frame on COM3 with six comma-separated fields, of lengths 11, 19, 4, 8, 1 and 11. The published v1.40 command description has five fields. The separate 1.0.4 comparison tool confirmed that only the sixth field exactly matches the case label and that the firmware and date agree with the diagnostic slip. Version 1.0.5 recognizes this layout in the same identity check used before checkout.

The operator ran **PF700-Check-Identity.cmd** from the 1.0.5 package and confirmed that the PF700 on COM3 matched the serial on the case.

Extract the complete offline ZIP and run `test-arra.cmd`. Its version-specific training database starts with the restaurant menu, 16 available tables and zero sales. Use the ordinary waiter checkout. Cash A and Card A use a simulated PF700 and show a receipt prefixed `SIM-`. Cash B follows the existing local payment path. The versioned launcher uses no serial or Windows print transport. A separate card terminal remains responsible for collecting card payments.

The 1.0.5 supervised Cash A trial is complete. An espresso priced at 70 MKD reached the printer in group В. Checkout stopped with the receipt open. Commands 76/T and 103 reported one item, zero tender and `+000007000` in the receipt amount and group В. This firmware reports hundredths of a denar in those fields. Version 1.0.5 compared them to whole MKD. The original exchange did not capture the first failing command.

The operator matched the open receipt to the saved bill, tendered its full balance in cash and closed it once. The recovery checked the amount paid, closed state and next document number. Arra acknowledged the receipt and recorded the original payment. The operator subsequently confirmed that paper feeds correctly. The existing trial has been used. Keep its database under `%APPDATA%\Arra POS PF700 Commissioning` and its device marker intact.

Physical card checkout and retroactively registering an earlier B sale still require work. From 1.0.7 the fiscal profile supports a separately confirmed Z report under **Close Account A**. The ordinary bill-list printer continues to print an internal summary. [1.0.7 daily report](progress/handoffs/S-084.md#107-daily-report) · [Accent PF550/PF700 protocol v1.40](https://www.accent.com.mk/downloads/Kontrolni_kodovi_PF550_PF700_v140.doc)

In the desktop app, a Combined user with day-close permission can open **Financial information → Close Account A → PF700 fiscal printer connection**. **Run offline simulation** exercises the status request and a fixed sample reply in memory. The serial profile is separate from the Windows queue used to print the internal Account A closing report.

The Windows sample package from version 1.0.2 includes `check-pf700.ps1` alongside `electron.exe`. Calling it without arguments runs the offline check. A later, operator-authorized hardware session requires the full `-ReadDeviceStatus` option. The equivalent source entry is `node src/desktop/pf700-status-cli.js`, with `--read-device-status` reserved for that session.

Before a hardware check, confirm COM3 still belongs to the intended adapter, the port is free, and the previous POS has reconciled any sale or daily close with an unknown outcome. The printer remembers only the last command response. An intervening diagnostic could replace the response needed to resolve an earlier sale or close. The diagnostic requests immediate status once (command 74, option X), with a bounded wait. It initially selects no hardware handshake and leaves DTR and RTS off. A valid reply shows a compatible exchange. Device identity, paper output, fiscal receipts, device-day closure and reconciliation each require separate evidence.

### Paper test with no sale

Build the small add-on with `scripts/build-pf700-paper-test.ps1`. Copy `Arra-PF700-Paper-Test-v2.zip` to the Windows POS and extract the entire ZIP into its own folder. With paper loaded and the printer idle, open `PF700-Paper-Test.cmd` in that folder. The prompt identifies paper test v2. The launcher uses the existing 1.0.3 offline test runtime. Typing `PRINT` and pressing Enter requests one diagnostic slip. Enter alone cancels before opening the port.

The tool checks the device status and whether a receipt is open, then requests the printer's diagnostic slip. This prints device information without recording a sale or closing the day. Check the paper before treating the test as successful. If the outcome is uncertain, inspect the paper and the display before considering another attempt. [Accent PF550/PF700 protocol v1.40, commands 74, 76 and 71](https://www.accent.com.mk/downloads/Kontrolni_kodovi_PF550_PF700_v140.doc)

The original tool stopped before printing with `Invalid receipt-state reply`. The owner then captured the masked 17-byte command-76 reply `0,####,+#########`. The first field indicated a closed receipt at the time of the check. The sign on this printer occupies a separate byte before nine digits. Paper test v2 recognizes that format and the previous nine-byte amount field. Each attempt checks the current document state again.

For this case, build `scripts/build-pf700-paper-test.ps1 -CheckReplyOnly`, extract `Arra-PF700-Check-Reply.zip` on the POS, and open `PF700-Check-Reply.cmd`. It uses the installed 1.0.3 runtime to request only status and receipt state. Share the single `Reply format:` line so the layout can be compared with the manual. The tool masks amounts and other field values in its output.

### Read the programmed VAT rates

Accent documents command 97 as a read of the four current tax rates in **А, Б, В, Г** order. The third value corresponds to **В** (Ve). The reply reports configured percentages. It has no separate field indicating which groups are enabled. [Accent PF550/PF700 protocol v1.40, command 97](https://www.accent.com.mk/downloads/Kontrolni_kodovi_PF550_PF700_v140.doc)

Build the add-on with `scripts/build-pf700-paper-test.ps1 -CheckVatRates`. On the Windows 10 POS with the offline Arra 1.0.3 runtime installed, extract `Arra-PF700-Check-VAT.zip` and open `PF700-Check-VAT.cmd` when the printer is idle. The checker reads status and then the rates on COM3. Read the line for **group V** on screen. An unexpected reply leaves the configured percentage unconfirmed.

### Earlier prototype and daily-report requirements

The original payment flow completed orders locally before attempting an ordinary print job. Version 1.0.4 adds the fiscal checkout modes described above. The Account A close summarizes an already closed shared day. The printer can have a different fiscal-day boundary, and a later B-to-A bookkeeping correction does not itself create a fiscal receipt.

Checkout records the bill and VAT snapshot before submitting a sale. It stores verified device evidence separately from the payment, so a local payment can be completed after a restart. The daily report uses a separate journal for the close attempt, the printer's fiscal record and any read-only recovery.

The original investigation used Accent's English v1.36 document for framing and status. The checkout integration uses the manufacturer's PF550/PF700 v1.40 document. The printer retains its response to the most recent command. Arra therefore preserves uncertainty across a restart and requires evidence for the original bill. [English v1.36 control codes](https://www.accent.mk/downloads/Control_codes_PF550_v136_EN.doc) · [PF550/PF700 v1.40](https://www.accent.com.mk/downloads/Kontrolni_kodovi_PF550_PF700_v140.doc)

The earlier payload prototype remains an isolated example. Checkout uses the dedicated executor and the configured Cyrillic group bytes. Receipt labels use a Latin transliteration of the stored menu name for this trial.

Before enabling actual fiscal output, verify the manufacturer's applicable protocol and firmware, configured transport, tax mapping and cash/card commands, fiscal receipt and daily-close sequencing, device status and recovery behavior, and perform controlled tests against the actual device. Test multiple pending days, a device with external transactions, B-to-A corrections, printer/power/network failure and restart; keep mismatches unresolved rather than asserting reconciliation. The device's documented fiscal-day timing determines how this relates to the shared day.

Research recorded 2026-11-09. This is a preliminary source review, not legal advice, a compliance determination, or approval for live sales. The restaurant's provider, devices and tax circumstances are not identified; no provider was contacted and no model-specific documentation or hardware was supplied. Q-06 and Q-07 remain open.

## What the sources say

- The [North Macedonia Public Revenue Office (UJP) listing of the Law on Registering Cash Payments](https://ujp.gov.mk/terms-of-use/regulativa/opis/22) identifies a consolidated law with amendments through Official Gazette 37/2025. [Article 2 in UJP's text](https://www.ujp.gov.mk/files/attachment/0000/0901/______________________________________________37_od_19.02.2025.pdf) describes covered payments as those not made through banking channels and requires covered taxpayers to use approved fiscal equipment and issue fiscal receipts, subject to statutory provisions. This wording alone does not establish how this restaurant's separate card terminal is classified; obtain local advice.
- UJP's [fiscalization guide](https://ujp.gov.mk/e/vodic/category/133) describes GPRS equipment registration through the manufacturer's service centre and UJP, authorized maintenance, and conditional backup equipment or emergency paper procedures. The guide also describes receipt timing and five-year retention of the fiscal control trail. Confirm current applicability, exemptions, thresholds and permitted outage procedures with UJP and a qualified local accountant; do not treat these as an implemented workflow.
- UJP's [2025 notice](https://www.ujp.gov.mk/%3BPublic%3BPublic%20Revenue%20Office/javnost/soopstenija/pogledni/1121?print=1) emphasizes authorized servicing and accurate registered location. UJP's [fiscalization regulation index](https://ujp.gov.mk/kazak-tili/regulativa/pregled_tipovi?tip_na_danok_sifra=fis) lists technical and functional rules, receipt format, and reversal documents. Obtain current full rules and verify their application, tax rates, receipt contents, daily close, refunds, retention, and treatment of A/B with a local professional.
- UJP's [glossary](https://ujp.gov.mk/terms-of-service/recnik/poim/26) distinguishes fiscal printers and fiscal receipts from general printing. It does not establish a protocol or approval for any model here.

These are public authority findings, not confirmation of the restaurant's equipment or its obligations. Pages are in Macedonian; translations above are summaries, and current law and professional interpretation must be checked before implementation or use.

## Provider and hardware questions from the initial investigation

At the initial investigation on 9 November 2026 the owner had identified a local supplier but had not yet supplied the device model or interface. The later S-084 work above identifies the fiscal printer, firmware, protocol and Windows connection. The following questions record the original scope for the supplier and the other restaurant devices.

Request from the provider or authorized service centre:

1. Manufacturer, model, firmware, approval/registration status and purpose of each fiscal, kitchen, bar and customer-output device; who owns, installs and services it.
2. Current integration manual and supported Windows driver/SDK, versions, transport (USB, serial, LAN or other), encoding and receipt commands; licensing and test/sandbox access. Confirm whether third-party POS software needs separate approval.
3. Fiscal sale, tax rates and rounding, cash versus separate-terminal card, reversals/refunds, daily reports and closing, receipt IDs, and whether owner A/B affects fiscal routing. Confirm these with the accountant/UJP too; A/B labels alone do not establish legal entities or fund flows.
4. Connection loss, GPRS/internet outage and power failure behavior; permitted offline operation and recovery; backup device and emergency paper rules. Internet-independent core operations do not establish permission to issue fiscal receipts offline.
5. How to determine whether a timed-out command was accepted or a receipt physically produced, query prior results, correlate a request to fiscal receipt, safely reconcile and avoid duplicate fiscal transactions. Ask about paper-out, duplicate/reprint markings and service escalation.
6. Preparation-printer routing, status/acknowledgement limitations, paper-out, retry and backup behavior, and a supported test on actual hardware. Clarify whether the customer bill, fiscal receipt and terminal slip are separate outputs.

## Recommended approach [P]

Keep the local order and payment records, preparation output and fiscal output distinct. Existing preparation tickets and attempts are explicitly simulated (`src/desktop/order-items.js`, `src/desktop/print-jobs.js`); simulated success is not evidence of paper output. Preserve stable job and attempt history, surface failed and uncertain results, and require an operator reconciliation procedure for uncertain physical output rather than blindly repeating it. A retry must not create another sale or charge.

After the provider answers, design separate local adapters for preparation devices and approved fiscal equipment around documented supported interfaces. Persist correlation and device responses when actually supported; do not assume a device offers idempotency or a reliable status query. Keep the existing separate card-terminal workflow and trusted A/B classification (card A); neither a bill nor a terminal slip is presumed to be a fiscal receipt. Test failures, crash recovery and reconciliation with the real supported devices before S-034/S-035. No integration or live-payment capability is delivered by this investigation.

## Next action

Obtain the provider identity, models and documentation and arrange a provider/authorized service consultation and local fiscal review. Record dated answers and evidence; resolve Q-06/Q-07 before deciding the real integration and before live use. Earlier independent stories remain unblocked.
