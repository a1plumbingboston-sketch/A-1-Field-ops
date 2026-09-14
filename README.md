# A-1 FieldOps

A field-service operations app for A-1 Plumbing & Heating: leads through
payment, in one place. Static frontend + Vercel serverless API + Supabase
(Postgres/Auth/Storage). See `CHANGELOG.md` for release history.

## What's here today

- **Leads** — intake (including social/webhook sources), AI-drafted replies
  with safety escalation, conversion to customer + job.
- **Customers & Jobs** — history, archive/restore, scheduling.
- **Estimates & Invoices** — AI-assisted scope writing and pricing guidance,
  branded PDF generation, email delivery, e-signature with an immutable
  signed snapshot, change orders for post-signature edits.
- **Remodel Quoter** — a separate AI-assisted flow for multi-phase remodel
  pricing (`remodel-quoter.js` / `lib/remodel-assist.js`).
- **Payments** — manual recording, Square online payment links, receipts.
- **Technician workspace** — per-employee access codes, appointment status,
  job photos, messages (`employee.html`).
- **Finance** — expense/loan/draw tracking, breakeven hourly-rate calculator,
  AI-assisted business review of receivables/quotes/uninvoiced jobs.
- **Field tools** — price book, material cost tracking, calendar (.ics) export.
- **Audit log** — who (owner or, when identifiable, which employee) recorded
  a payment, sent a document, edited an invoice, completed a job, or
  converted a lead. See `supabase/migrations/20260914120000_audit_log.sql`.

## Known limitation, by design for now

Authorization is a single shared "office key" (`x-fieldops-key`), not
per-employee login, for most actions — only the technician workspace has
real per-employee identity. The audit log above records who's identifiable,
it does not restrict who can act. Replacing this with real per-user auth is
the top item on the roadmap.

## Environment variables

**Required for the app to function at all:**
- `SUPABASE_SERVICE_ROLE_KEY` — server-side database access.
- `SUPABASE_URL` — defaults to the production project if unset.

**AI features** (each degrades gracefully to "AI unavailable" if unset):
- `OPENAI_API_KEY` — required for any AI feature.
- `OPENAI_ESTIMATE_MODEL`, `OPENAI_REMODEL_MODEL`, `OPENAI_INVOICE_MODEL`,
  `OPENAI_REPLY_MODEL`, `OPENAI_BUSINESS_MODEL`, `OPENAI_FINANCE_MODEL` —
  per-feature model overrides; each falls back to a built-in default.
- `AI_AUTO_DRAFTS` — set to `off` to disable automatic AI reply drafting on
  new social leads.

**Email delivery** (required to send quotes/invoices/receipts to customers):
- `RESEND_API_KEY`, `FIELDOPS_FROM_EMAIL`
- Optional: `FIELDOPS_REPLY_TO`, `FIELDOPS_OWNER_EMAIL` (signed-copy
  recipient), `FIELDOPS_PUBLIC_URL` (canonical signing-link domain)

**Lead conversion:**
- `FIELDOPS_OWNER_ID` — only required if the Supabase project has more than
  one Auth user; otherwise the sole user is resolved automatically.

**Square payments** (optional — online payment links won't offer if unset):
- `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_APPLICATION_ID`,
  `SQUARE_ENVIRONMENT` (`sandbox` or unset for production),
  `SQUARE_WEBHOOK_SIGNATURE_KEY`

**Twilio inbound SMS** (optional):
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`,
  `TWILIO_SMS_ENABLED`

**Social lead webhook** (optional):
- `SOCIAL_LEAD_WEBHOOK_SECRET` (or `SOCIAL_WEBHOOK_SECRET`)

## Development

```
pnpm install
npm test          # full test suite (PGlite in-memory Postgres + mocked network)
npm run smoke      # static syntax/reference smoke checks
npm run dev        # isolated local server at http://127.0.0.1:4173, login "test-key"
```

`.github/workflows/test.yml` runs `npm test` and `npm run smoke` on every
push and pull request against `main`.

Never deploy the `npm run dev` server or use its `test-key` login in
production — it's an isolated in-memory database for local iteration only.

## Deployment

Push to `main` → Vercel deploys automatically. Apply any new files under
`supabase/migrations/` to the Supabase project's SQL Editor before or
immediately after deploying code that depends on them — migrations are not
run automatically.
