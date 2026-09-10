A-1 FieldOps v29 - Automatic Markup + Completion Billing + Customer E-Sign

What changed
- Job Materials now calculates customer price automatically from Our Cost x Markup %.
- Default material markup is remembered on the device.
- A small No markup action sits directly below the markup field.
- Completing a job now automatically creates/opens the invoice in Money to Collect.
- Approved-estimate line items are copied into the invoice when available; otherwise billable job materials are used.
- Owner-side invoice editor added. Customers cannot edit invoices.
- If an already-signed invoice is edited, the signed revision is archived/superseded and the new invoice must be signed again.
- Send for E-Signature emails a secure customer link.
- Signature pad works with finger/stylus on mobile/tablet and mouse/trackpad on desktop.
- Customer can Clear / Redo, then Sign & Accept.
- Completion acknowledgment is small print directly under the signature area; there is no acknowledgment checkbox.
- Signing captures the drawn signature, printed name, revision and timestamp against an immutable snapshot of what the customer reviewed.
- After signing, a signed PDF is emailed separately to the customer and A-1 so both keep a copy.
- FieldOps shows Not Signed / Awaiting Signature / Signed status and can reopen the preserved signed copy.

ONE-TIME DATABASE SETUP
1. Open Supabase SQL Editor.
2. Run supabase-v29-esign.sql once.
This creates invoice_signatures. Browser access is intentionally blocked; customer signing is handled by secure server endpoints and unguessable tokens.

Vercel environment variables
Required for current email/PDF delivery:
- SUPABASE_SERVICE_ROLE_KEY
- RESEND_API_KEY
- FIELDOPS_FROM_EMAIL

Recommended:
- FIELDOPS_PUBLIC_URL=https://your-fieldops-domain.example (used to build signing links)
- FIELDOPS_OWNER_EMAIL=a1plumbingboston@gmail.com (signed copy sent here; falls back to FIELDOPS_REPLY_TO)
- FIELDOPS_REPLY_TO=a1plumbingboston@gmail.com

Important version rule
A customer signature is never copied onto a changed invoice. Each signature stays attached to the exact snapshot/revision the customer saw. Editing a signed invoice preserves the prior signed revision and requires a new signature on the next revision.
