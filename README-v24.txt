A-1 FieldOps v24 — End-to-End Workflow Hardening

Focus: make the real one-person workflow reliable from lead intake through bookkeeping.

Fixes:
- Lead status filter now matches the database ('won' shown as Converted).
- AI lead reply now passes the lead id and can persist its draft metadata.
- Fixed broken AI reply approval references (wrong Supabase constants + nonexistent loadLeads()).
- Jobs view now loads all jobs owned by the FieldOps owner, not only pre-assigned jobs.
- Estimate/Invoice tabs preload customers so Call/Text/Email actions resolve consistently.
- Saved estimates now persist subtotal and tax=0 alongside total.
- AI Estimate Assist now requires the FieldOps access key, preventing an open paid-AI endpoint.
- Money Today uses remaining invoice balances instead of counting paid portions as open A/R.
- Payments reject overpayment, update invoice.amount_paid, set partial/paid status, update paid_at, and refresh bookkeeping.
- PWA cache bumped to v24.

Backend migration:
- jobs.updated_at added.
- new lead conversions assign the generated job to the owner.
- existing unassigned jobs assigned to their owner for the one-person workflow.

No external messages are sent automatically. SMS/email actions still open the iPhone composer for review.
