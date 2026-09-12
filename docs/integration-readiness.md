# Integration readiness — no services enrolled

The owner has deferred new subscriptions and accounting-provider selection. Do not create accounts, connect banks, subscribe, change the phone provider or enable automatic synchronization without a later request.

## Current preparation

Finance CSV exports now include stable FieldOps record IDs, invoice IDs, explicit USD amounts, status, processor and processor reference. Keep IDs intact when importing: a repeated export is not new revenue. Voided ledger entries remain labeled for correction review. Pending/failed payments must not be imported as collected sales. No CSV is assumed directly compatible with a particular vendor; map and validate it first.

The customer signing endpoint exposes a minimal, read-only current payment summary separately from the preserved signed agreement. It only reads the invoice attached to the validated session. No signed records are rewritten. FieldOps is the authoritative schedule; AI instructions now agree with that policy.

## Provider boundaries for future implementation

- FieldOps owns customers, jobs, work reports, quote scope, assignments and appointment edits.
- Square owns processor payment/refund outcomes. Match processor references and invoice IDs; reconcile fees, refunds and deposits rather than treating deposits as another sale.
- A selected accounting provider will own reconciled books and tax classifications. Start with a reviewed import; then consider one-way, idempotent synchronization. Do not send the same invoice from both systems.
- Twilio owns SMS transport. Current inbound webhook validates signatures and deduplicates message IDs. Some outgoing actions still launch device composers; a unified outbox and delivery-status connection remain future work. Preserve phone numbers in international format and provider message IDs. Opt-out state must be checked before any future automated send.
- Any Google Calendar integration should mirror FieldOps appointments with a saved event mapping. Do not enable competing edits until conflict rules are agreed.
- Employee access codes are the current login method. Managed sign-in is a future migration, not installed by this release. Keep existing staff IDs so job history survives.

## Conditions before enabling any connector

Choose a provider and confirm plan/API access; securely authorize a limited connection; map existing IDs and categories; test a small sample; prove retries do not duplicate records; review errors and reconciliation; agree which system may edit each field; then enable only the approved direction. Failed events need a visible retry queue and history. These connectors and queues are not implemented yet.

Do not estimate taxes, assert reconciliation or claim automatic bank tracking from the current ledger alone. Preserve receipts, payroll reports, loan statements and bank records for later bookkeeping review.

## Google Calendar and Gmail readiness

Deferred until requested. FieldOps keeps the appointment ID, start/end time, assigned technician and status. A future calendar adapter should map each appointment ID to one Google calendar ID and event ID, store the last synchronized revision, and update that event rather than creating duplicates. Define technician colors and consistent labels from FieldOps. Cancellations must update the mapped event. Begin with one-way FieldOps-to-Google synchronization; do not accept competing Google edits silently.

Gmail delivery is separate from calendar synchronization. Existing email delivery remains in place. Do not send duplicate invitations from Gmail and the current email provider. Connecting Google later requires explicit account authorization and a selected shared calendar. Use limited permissions, server-side token storage, visible connection status and a disconnect option. None of these Google connections are activated by this preparation.
