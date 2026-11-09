# S-033 — Fiscal and printer investigation

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
