# S-033 — Fiscal and printer investigation

## S-084 update: Synergy PF700, 2026-11-18

The owner identified the fiscal printer in a photograph as a Synergy PF700 and clarified that S-084's intended end result is an actual Account A fiscal daily report. The printer is on the POS PC, and the owner requested preparation without contacting it. Accent's [download page](https://www.accent.mk/%D0%BF%D0%BE%D0%B4%D0%B4%D1%80%D1%88%D0%BA%D0%B0/?lang=en) lists PF550/PF700 control codes, example input files and Windows communication tools. Its [device page](https://synergy.com.mk/?page_id=47) lists network, USB and serial connections.

### POS connection prepared for S-084

The Windows 10 POS showed the Prolific USB-to-serial adapter on **COM3**. The owner ran Arra 1.0.3's live status diagnostic on that POS and supplied the resulting screen. The PF700 answered at **9600 baud, 8 data bits, no parity, one stop bit**, with handshake disabled. Both status fields were `888080e1809a`. This verifies communication for that connection. Physical slip output and fiscal operations still need their own evidence.

In the desktop app, a Combined user with day-close permission can open **Financial information → Close Account A → PF700 fiscal printer connection**. **Run offline simulation** exercises the status request and a fixed sample reply in memory. The serial profile is separate from the Windows queue used to print the internal Account A closing report.

The Windows sample package from version 1.0.2 includes `check-pf700.ps1` alongside `electron.exe`. Calling it without arguments runs the offline check. A later, operator-authorized hardware session requires the full `-ReadDeviceStatus` option. The equivalent source entry is `node src/desktop/pf700-status-cli.js`, with `--read-device-status` reserved for that session.

Before a hardware check, confirm COM3 still belongs to the intended adapter, the port is free, and the previous POS has reconciled any sale or daily close with an unknown outcome. The printer remembers only the last command response. An intervening diagnostic could replace the response needed to resolve an earlier sale or close. The diagnostic requests immediate status once (command 74, option X), with a bounded wait. It initially selects no hardware handshake and leaves DTR and RTS off. A valid reply shows a compatible exchange. Device identity, paper output, fiscal receipts, device-day closure and reconciliation each require separate evidence.

### Paper test with no sale

Build the small add-on with `scripts/build-pf700-paper-test.ps1`. Copy `Arra-PF700-Paper-Test-v2.zip` to the Windows POS and extract the entire ZIP into its own folder. With paper loaded and the printer idle, open `PF700-Paper-Test.cmd` in that folder. The prompt identifies paper test v2. The launcher uses the existing 1.0.3 offline test runtime. Typing `PRINT` and pressing Enter requests one diagnostic slip. Enter alone cancels before opening the port.

The tool checks the device status and whether a receipt is open, then requests the printer's diagnostic slip. This prints device information without recording a sale or closing the day. Check the paper before treating the test as successful. If the outcome is uncertain, inspect the paper and the display before considering another attempt. [Accent PF550/PF700 protocol v1.40, commands 74, 76 and 71](https://www.accent.com.mk/downloads/Kontrolni_kodovi_PF550_PF700_v140.doc)

The original tool stopped before printing with `Invalid receipt-state reply`. The owner then captured the masked 17-byte command-76 reply `0,####,+#########`. The first field indicated a closed receipt at the time of the check. The sign on this printer occupies a separate byte before nine digits. Paper test v2 recognizes that format and the previous nine-byte amount field. Each attempt checks the current document state again.

For this case, build `scripts/build-pf700-paper-test.ps1 -CheckReplyOnly`, extract `Arra-PF700-Check-Reply.zip` on the POS, and open `PF700-Check-Reply.cmd`. It uses the installed 1.0.3 runtime to request only status and receipt state. Share the single `Reply format:` line so the layout can be compared with the manual. The tool masks amounts and other field values in its output.

The existing payment flow records payment and completes the order before an ordinary non-fiscal print attempt. S-084 records an internal summary for an already closed shared day. Neither registers a fiscal sale nor requests a fiscal daily report. The printer's fiscal period may differ from the shared business day, and a later B-to-A correction does not itself create a fiscal receipt. Do not assume these totals match or send an ordinary Windows print job as a fiscal command.

The integration needs durable per-sale fiscal intent and immutable line/tax/payment data, device identity and documented responses, plus a distinct fiscal-day report operation. It must explicitly represent unknown results across restart, prevent automatic duplicate sale or close commands, and reconcile device evidence before any retry. The existing card-terminal payment must not be charged again after a printer problem. Preserve the internal close and historical payments and do not treat a fiscal report as evidence of physical paper without verification.

Accent's linked [English control-code document](https://www.accent.mk/downloads/Control_codes_PF550_v136_EN.doc) was retrieved and read. It describes the PF550 protocol, linked by Accent for PF550/PF700; its applicability to this particular PF700 and firmware remains unverified. It describes serial framing, receipt commands, status bytes and daily report commands. A pure framing codec and isolated simulation are provided for development tests only; neither sends device commands or connects to payments. The manual's same-sequence retransmission applies to the immediately preceding command and must not be treated as a durable idempotency guarantee across restart or other commands.

An offline command-payload prototype covers a restricted subset of sale, total, receipt close and daily report formats. It deliberately does not open a receipt, map Arra items to tax groups or payment types, convert money, interpret status, or communicate with hardware. The manual contains differing indications about tax-group encoding; the sample ASCII letters in the prototype must not be treated as verified for this printer. Device configuration, encoding and exact command behavior remain to be established before integration.

Before enabling actual fiscal output, verify the manufacturer's applicable protocol and firmware, configured transport, tax mapping and cash/card commands, fiscal receipt and daily-close sequencing, device status and recovery behavior, and perform controlled tests against the actual device. Test multiple pending days, a device with external transactions, B-to-A corrections, printer/power/network failure and restart; keep mismatches unresolved rather than asserting reconciliation. The device's documented fiscal-day timing determines how this relates to the shared day.

Research recorded 2026-11-09. This is a preliminary source review, not legal advice, a compliance determination, or approval for live sales. The restaurant's provider, devices and tax circumstances are not identified; no provider was contacted and no model-specific documentation or hardware was supplied. Q-06 and Q-07 remain open.

## What the sources say

- The [North Macedonia Public Revenue Office (UJP) listing of the Law on Registering Cash Payments](https://ujp.gov.mk/terms-of-use/regulativa/opis/22) identifies a consolidated law with amendments through Official Gazette 37/2025. [Article 2 in UJP's text](https://www.ujp.gov.mk/files/attachment/0000/0901/______________________________________________37_od_19.02.2025.pdf) describes covered payments as those not made through banking channels and requires covered taxpayers to use approved fiscal equipment and issue fiscal receipts, subject to statutory provisions. This wording alone does not establish how this restaurant's separate card terminal is classified; obtain local advice.
- UJP's [fiscalization guide](https://ujp.gov.mk/e/vodic/category/133) describes GPRS equipment registration through the manufacturer's service centre and UJP, authorized maintenance, and conditional backup equipment or emergency paper procedures. The guide also describes receipt timing and five-year retention of the fiscal control trail. Confirm current applicability, exemptions, thresholds and permitted outage procedures with UJP and a qualified local accountant; do not treat these as an implemented workflow.
- UJP's [2025 notice](https://www.ujp.gov.mk/%3BPublic%3BPublic%20Revenue%20Office/javnost/soopstenija/pogledni/1121?print=1) emphasizes authorized servicing and accurate registered location. UJP's [fiscalization regulation index](https://ujp.gov.mk/kazak-tili/regulativa/pregled_tipovi?tip_na_danok_sifra=fis) lists technical and functional rules, receipt format, and reversal documents. Obtain current full rules and verify their application, tax rates, receipt contents, daily close, refunds, retention, and treatment of A/B with a local professional.
- UJP's [glossary](https://ujp.gov.mk/terms-of-service/recnik/poim/26) distinguishes fiscal printers and fiscal receipts from general printing. It does not establish a protocol or approval for any model here.

These are public authority findings, not confirmation of the restaurant's equipment or its obligations. Pages are in Macedonian; translations above are summaries, and current law and professional interpretation must be checked before implementation or use.

## Provider and hardware: unresolved

The owner previously said a local provider supplies terminals and printers, but its name and the models are unknown. No contact has been made. No device-specific interface, SDK, protocol, certification, supported Windows version, or test equipment has been verified; no device is recommended or presumed approved.

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
