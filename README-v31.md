# v31.2 client creation and document delivery

- Customers → New Client → Save Client & Create Quote captures contact details and supplies the required owner. Quotes use client names and optional job selections instead of raw IDs. Changing clients clears the previous job; only that client's active jobs are offered and the selected job is checked again on save.
- New quotes open for review after saving. Quote creation does not require a scheduled job. Existing Auto Markup, AI assist, conversion, signature and payment paths remain.
- Send Invoice has a consistent label. Repeated clicks are blocked while sending. Confirmation stays visible above the review dialog, and the displayed status/signature state refreshes.
- Missing email configuration or an invalid customer email is rejected before creating a signing session. Provider rejection, uncertain confirmation, and an accepted email followed by a failed status update have distinct messages. A paid invoice stays paid when a copy is sent.
- Validation: 25 automated tests plus workflow smoke checks passed. Built-in browser verified desktop new client → quote without job → simulated quote email → invoice → simulated invoice email; mobile new client → quote → simulated email at 390×844, no horizontal overflow or browser errors. Client switching cleared the other client's job. Standalone Playwright could not run because its Chromium executable is not installed; the built-in browser supplied visual workflow coverage.
- A regression test executes the actual browser form handlers against the test database: required owner, new client, wrong-client job rejection, quote without a job, saved line items, correct PDF email recipient, and sent status.
- No live customer was created or emailed. Production email delivery remains blocked until the server database key, Resend key and verified sender are configured and deployed. OpenAI's key is also still needed for production AI features. No database migration is required for this release.

# v31.1 follow-up fixes

- AI Approve/Hold use the actual live lead columns and retain edited reply text. Failed draft saves no longer report success.
- Quote allowance uses “Misc fittings” with the existing percentage calculation and prices.
- Completed jobs have Remove from page and an Archived view with Restore job. Invoices, payments and signed records remain available.
- Conversion uses the lead owner or the single established business owner instead of counting auth users. Conflicting or ambiguous ownership fails safely. Repeated conversion returns the existing customer/job.
- Converted leads include the database’s `won` status in the Converted view.
- Before deploying this follow-up, apply `20260910232443_job_archive_owner_resolution.sql`. Its live rollback rehearsal passed. Browser checks verified conversion, completion, archive/restore and AI Approve/Hold using synthetic records.

# A-1 FieldOps v31

Built from `main` at `629d2c90103837250ba08f8f771bf30307ae239e` (v30 branding, v29 service-worker cache). The app and cache now identify v31; package version is 31.0.0.

## Customer documents

Estimate, Change Order, Invoice, Completion/Acceptance, and Receipt share the existing `a1-logo.png`, a compact white/red/black layout, itemized prices, scope, totals, two-column printed terms, and bottom authorization. Phone layouts use readable single-column terms without hiding quantities. The current company wording is Plumbing & HVAC, 24/7 Emergency Service, and 12 Years of Experience; the legal company name and exact logo remain A-1 Plumbing & Heating.

The approved Photos & Documentation clause does not imply marketing consent. Terms preserve statutory rights and do not invent license numbers, warranty durations, or additional fees. Job-specific permits, warranty terms, exclusions, payment schedules, and any legally applicable notices still need to be supplied for the actual work; this template is not a claim of universal legal compliance.

Routine examples fit one US Letter page. Long documents paginate rather than omit items or shrink terms. Browser previews and PDFs use shared content. Signing stores the reviewed HTML/CSS/logo and the signed PDF plus a SHA-256 checksum. Signed copies remain available after link expiry. Database triggers reject modifications/deletion of signed snapshots and signed scope/items.

Editing a signed estimate or invoice creates a separate change order using the revised full scope/prices. It shows the previous approved total, the adjustment, and the new total. One pending change order is permitted per source. Signing creates a separate adjustment invoice once; reductions create credit records and apply credit to the original invoice without changing its signed price. Subsequent edits load the latest approved scope.

## Existing workflows

Auto Markup, No Markup, Customer Intake, lead conversion, AI tools, customer lists, jobs, invoice editing, payment recording, tax summaries, and CSV export remain. API handlers are now under `api/`, matching the existing `/api/...` URLs and Vercel conventions. Complete Job and estimate-to-invoice conversion use one database transaction; repeated calls return the existing base invoice. Jobs without priced items still produce the existing zero-price draft for review. Payment requests are atomic and idempotent. Sending copies does not reset paid/approved statuses. The service worker never substitutes app HTML for an API or signing request.

## Database and deployment

Before deploying the new code, apply `supabase/migrations/20260910151939_compact_documents.sql` to the A1 FieldOps project. It adds two RLS-protected, server-only tables, credit/request columns, triggers, and server-only transaction functions. It was written for the actual live schema, where the v29 `invoice_signatures` table was absent. Do not run it against a different database with legacy signatures without a separate migration review.

Required existing Vercel environment variables:

- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY` and `FIELDOPS_FROM_EMAIL` for email delivery
- `FIELDOPS_PUBLIC_URL` for canonical signing links
- `FIELDOPS_OWNER_ID` for existing lead conversion when multiple owners exist
- Optional `FIELDOPS_OWNER_EMAIL` and `FIELDOPS_REPLY_TO`

Deploy through the existing GitHub → Vercel integration after tests and the database update. No separate site or deployment provider is introduced. The Vercel connector in this session could not inspect the project's environment settings, so production configuration and delivery must be verified after release. Tests do not send real email or invoke billable AI services.

## Validation

- `pnpm test`: PostgreSQL/PGlite database, PDF, and real API-handler integration tests against synthetic data. No production writes or external email.
- `pnpm smoke`: existing workflow reference tests and JavaScript syntax checks, updated for v31 and actual API locations.
- `pnpm test:browser`: Playwright desktop/mobile workflow test; requires a working Chromium installation (`pnpm exec playwright install chromium`). This Mac sandbox blocks Chromium process launch; built-in browser checks are being performed separately.
- `pnpm dev`: isolated in-memory test server at `http://127.0.0.1:4173`; login `test-key`. Never deploy this test server. Production entry points remain the static files and Vercel API handlers.

Release validation on September 10, 2026: all 17 automated tests and existing smoke checks passed. Built-in browser checks covered desktop/mobile documents, markup controls, job completion, blank-signature validation, Clear/Redo, successful synthetic signing and the preserved mobile signed copy with no overflow or browser errors. The live-database rollback rehearsal passed, and the migration was applied successfully. Public access to the new records and signing functions is denied. Existing auth/key-function advisor warnings remain unchanged; the new server-only tables intentionally have no client policies. Email delivery and billable AI-provider calls were simulated in tests. GitHub/Vercel deployment status is verified separately after publishing.
