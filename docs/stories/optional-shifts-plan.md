# Optional shifts in Arra POS

An owner who never uses shifts should be able to run a whole service exactly as they do today. A shift is a restaurant-wide reporting period inside the existing business day. Staff can take orders as soon as service begins. The owner only visits **Close shift** if they want to mark a handover or see that shift's figures.

## Walk through one service

| Moment | What the operator does | What Arra records or shows |
| --- | --- | --- |
| 09:00, first order | A waiter adds an item to table 5. | The first shift begins in the background. Opening the POS or browsing the floor does not start the clock. |
| A day with no handover | The owner skips Close shift and later uses **Close current day**. | For a day with activity, one shift covers the service. The normal day close takes the same number of operator steps and sends the restaurant day report. |
| 16:00, optional handover | In **Financial information → Close shift**, the owner reviews the opening time, payments, cash and card, then confirms. | The saved report identifies the period ending at 16:00. The business day stays open. The next shift begins automatically at the handover boundary. **Done** is primary and **Print shift report** is optional. |
| 16:10, table 5 pays | The waiter completes the existing order. | The payment belongs once to the second shift and once to its business day. The table, order, bill and sent items retain their identities. |
| Later correction | The transfer manager corrects eligible cash from B to A while the business day is open. | The original shift report is the record at close. The day report uses the effective account at day close. The restaurant-wide cash, card and overall paid amounts still reconcile. |
| 00:00, restaurant closes | The owner chooses **Close current day** once. | The evening shift and day close together. Shift history shows both dates across midnight. The day report prints automatically. The evening shift report is available on request. If service never resumed after the handover, there is no extra empty shift report. |
| Later, Account A | Combined opens **Close Account A** when ready. | The eligible unit is the closed business day, containing all its shifts. Its existing internal report and the planned fiscal-device operation are distinct. Shift and day actions send no fiscal commands. |

## Delivery plan

Use the entries in [the development backlog](backlog.md#optional-shift-reporting) for acceptance and checks. Deliver one story per session. The two routes worth testing throughout are a full day that ignores shifts and a day with a handover while a table stays open.

| Story | Independently demonstrable result | Base |
| --- | --- | --- |
| S-088 | Optional shifts are recorded locally. Payments, corrections, retries and a day close can be verified with sample data. | Existing payment/day services, including the S-087 day-close changes where integrated. |
| S-089 | From Financial information, an owner can review a shift, close it and return to work. Day-only operators see no added steps. | S-088 and the S-087 renderer. |
| S-090 | An owner can find a saved shift, print it on request, or recover a failed print. | S-088 and S-089. |
| S-091 | Separately, streamline the existing Account A screen around the selected closed day and its report status. | Existing S-084 internal close and S-087 design. This follow-up can be delivered independently of shifts. |

S-087 has its own branch and verification history. Start implementation from a revision containing the applicable S-087 work. Coordinate changes to its day-close files with that work. The previous click-throughs illustrate the visual style. Their mandatory start, per-shift Account A selection and immediate fiscal handoff screens are superseded by the flow above.

## Design brief for every visible change

- Match the **current shipped or reviewed Arra UI**. Start from [Financial information](../../src/admin/FinancialVisibility.js), [Close current day](../../src/admin/BusinessDays.js) and the [shared stylesheet](../../src/styles.css). Use the existing navigation tile, back navigation, type sizes, spacing, summary panel, primary/secondary buttons, warnings and completion treatment. A bare HTML form, unstyled list or debug-style dump is unfinished.
- Let the shell supply the page title. Give each screen one primary action. On review, group the payment count and total with cash and card in MKD using the established finance formatting. Use local date and time for both boundaries, including the second date when a shift crosses midnight. Keep printer settings, attempts and archive details out of the ordinary handover.
- Keep one period in focus. Confirmation names the period being closed and the consequence. Completion names that same period and offers **Done**. Put a paper problem beside its report and show exactly one appropriate recovery action. A warning about an open table should say when its later payment will count.
- The handoff should include evidence from the rendered app with sample data. Show review, confirmation, completion and any touched error or empty state. Exercise keyboard focus, Albanian and English, and a narrower supported window with long translated labels. Screenshots or a recorded walkthrough can carry the visual evidence. Record any desktop, offline or paper checks that remain unverified. Follow the [renderer ownership contract](../architecture/renderer-ownership.md).

## Proposed defaults for the builders

1. Automatic handover and optional shift paper are the planning defaults. There is no setup switch or required Start shift action. The owner can use or ignore Close shift independently each day.
2. For the first release, use the existing shared-day close authority and financial visibility rules for the new shared-shift action. Combined is the usual operator. Preserve restricted totals, details and paper for each identity. Only Combined can operate Close Account A. A future narrower shift permission is a separate product choice.
3. On upgrade, start full shift tracking with the next business day if the open day already has activity. Keep the current day's ordinary service and close available, with a short explanation in the shift view. A fresh installation or a demonstrably unused open day can start with its first activity. Older records retain their original dates, day membership and reports.
4. A manual handover sets the next opening time immediately. The next shift becomes reportable only after actual service resumes. A shift with orders but zero payments is a real shift with a zero paid total. No empty placeholder shifts need closing or printing.
