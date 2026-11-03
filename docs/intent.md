# Product intent

Status: draft for owner approval. `[P]` marks proposed detail; it is not yet an approved decision.

## In one sentence
Build a restaurant point-of-sale system that helps staff manage table orders and payments on a shared PC, including when the internet is unavailable.

## The problem
Staff need a reliable, straightforward way to enter orders, communicate with preparation staff, record bills and payments, and keep a traceable history without losing information when a printer or connection fails.

## Who uses it and what they need

- **Waiters:** Quickly select a table, enter items and notes, send orders to preparation, move items when needed, and record a completed bill.
- **Owners and authorized administrators:** Configure the restaurant and accounts, control what each account can see and do, review activity and financial information, and correct mistakes with a record.
- **Transfer manager:** Correct eligible cash payments from Account B to Account A before the business day is closed, without access to ordinary waiter or admin actions.
- **Kitchen and bar staff:** Receive preparation instructions for the items sent to them.

## Goals for version 1

- Deliver the system in practical increments, starting with a real working foundation rather than waiting for every operational detail.
- Support one restaurant and one shared PC, with simple table and order workflows.
- Work without internet access. [P] Keep core records on systems available locally; the exact approach is an architecture decision.
- Keep orders, bills, recorded payments and preparation printing distinct, and preserve a history of important changes.
- Provide configurable accounts and permissions, with the documented owner financial separation as the starting rule.
- Protect data with persistent storage, backups and a tested recovery process before real operations depend on it.
- Support the confirmed A/B payment rules and separate card terminal, with fiscal and hardware integration investigated when needed.

## Constraints

- One developer is building the product with AI assistance; favor understandable, common technology and few moving parts.
- The restaurant is in North Macedonia. Provider-supplied terminals and printers and applicable fiscal requirements need investigation before real payment or fiscal integration and live use.
- [P] Do not make printer model selection or final business-day details a prerequisite for the first database and early development.
- Keep future multiple-device use possible without making it a version 1 requirement.

## Non-goals

- Multiple active devices, tablet apps or synchronization in the first release.
- Split bills, partial payments or multiple payment methods for one bill in version 1.
- Processing card payments directly through the POS; the card terminal operates separately.
- Designing every screen, operational rule and printer integration before building the foundation.

## When things conflict

[P] Proposed order for your approval:

1. Don't lose or corrupt orders and payment records.
2. Keep the POS working without internet.
3. Enforce the agreed payment and access rules.
4. Make everyday work quick and clear for staff.
5. Keep the system simple enough for you to build and maintain.
6. Add flexibility for future features when it doesn't make the current system unnecessarily complicated.
