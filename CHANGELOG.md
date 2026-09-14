# Changelog

Consolidated from the individual `README-vNN.txt` files that previously lived in
the repo root. Each entry is what that release actually changed, kept for
history — it does not describe the current state of the app (see `README.md`
for that).

## v31.x — Customer history, field tools, pricing fixes
- Customer History: previous/archived jobs, job photos, quotes, invoices.
- Price Book: save, search, edit, archive, and copy services into new quotes.
- Reliable quote saves: one transaction, idempotent request IDs, no duplicate
  saves on retry.
- Approved quotes create/open a job without modifying the quote; repeated
  scheduling/completion returns the existing records.
- Client and job management: edit in place, new job from Customers/Jobs,
  conditional updates reject stale edits.
- Twilio inbound SMS webhook (signature-verified, idempotent by message SID).
- Fixed a button-ID/handler collision in AI line-item selection; normalized
  the $75 truck fee to one line when applying AI suggestions or converting
  quote → invoice.
- Confirmed lead deletion (customer/job/document records preserved).

## v29 — Automatic markup, completion billing, customer e-sign
- Job Materials auto-calculates customer price from cost × markup.
- Completing a job auto-creates/opens the invoice.
- Owner-side invoice editor; editing a signed invoice supersedes it and
  requires a new signature.
- Customer e-signature flow: signed PDF emailed to both parties, immutable
  signed snapshot preserved even through later edits.

## v28 — Customer PDF delivery
- Send Quote / Send Invoice emails the branded document as a PDF attachment
  (previously only opened a manual email draft).

## v25 — Branded documents
- Professional PDF templates for estimate, invoice, completion, receipt,
  generated from live FieldOps records — no invented prices/totals/data.

## v22–v24 — Workflow hardening
- Customer contact actions (call/text/email) on estimates and invoices.
- Tax/bookkeeping panel with year selector and CSV export.
- AI Invoice Writer (wording only — cannot change price/quantity/tax/total).
- Various data-consistency fixes (lead status filter, job ownership, overpayment
  rejection, Money Today balance calculation).

## v17–v21 — Social lead intake and AI reply pipeline
- `/api/social-lead` intake endpoint (Instagram/Facebook/TikTok/WhatsApp).
- AI-drafted lead replies with escalation rules for safety-sensitive messages
  (gas/flood/fire/CO). Routine vs. approval-required classification.
- Automatic outbound sending intentionally never enabled — no outbound social
  provider was ever connected.

## v16 — Session hardening
- Access key moved from `localStorage` to `sessionStorage` with a 30-minute
  inactivity auto-lock.
- Noted even then: *"Remaining priority: replace shared access-key
  architecture with real per-user Supabase Auth + role claims."* This is
  still true as of this writing — see the audit log work in
  `supabase/migrations/20260914120000_audit_log.sql` for the first concrete
  step toward it.

## v13–v15 — Foundation
- Leads, Customers, Jobs, Estimates, Invoices, Payments.
- Installable PWA shell.
- Per-job materials tracking.
- AI Estimate Assist with market-pricing guidance.
