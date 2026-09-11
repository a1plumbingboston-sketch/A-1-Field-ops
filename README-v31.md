# v31.6 customer history and field tools

Customer History includes previous and archived jobs, job photos, quotes and invoices. Private job photos are compressed to JPEG (maximum 1 MB each) and stored in Supabase; removal hides them from the app while preserving records. Price book services can be saved, searched, edited, archived, and copied into new quotes. Email activity records new sends and refreshes the most recent five statuses from Resend; older sends are not backfilled. No additional keys are required.

Apply `supabase/migrations/20260911044830_field_tools.sql` before deploying this release. The three new tables are server-only with RLS and no anonymous/authenticated grants. Existing access-key authorization protects all new routes.

# v31.5 selectable AI quote items and live totals

AI suggestions stay separate until selected and applied. Selected line totals and revised quote/invoice totals recalculate immediately. Signed document edits continue to create change orders.

# v31.4 reliable quotes and scheduling

- Quote header and line items save in one transaction. A persistent request ID makes retries return the original saved quote; a changed request is rejected instead of creating a duplicate. Client/job ownership and active-job checks run inside the transaction. Line totals are rounded consistently.
- Approved quotes create or open a job without modifying the quote. The link is stored on the job so signed snapshots and source fields remain unchanged. Job completion finds the approved source and bills the approved amount. Repeated scheduling/completion returns existing records.
- Unfinished quote scope, prices, estimator inputs and request identity are saved locally on this device. Restore Draft recovers after reload; a successful save clears the recovery copy. Offline notices explain that database saves and sending require internet. This is recovery, not offline synchronization.
- Apply `20260911022416_reliable_quotes_and_scheduling.sql` before deploying. New RPCs are SECURITY INVOKER and use existing table grants and RLS/access-key checks; they do not bypass policies. The current production completion function was reviewed before preparing its replacement.
- Validation: 27 automated tests and workflow smoke checks passed. Tests inject an item-write failure and confirm full rollback, retry saves/scheduling/completion, reject unauthorized invocation, and prove signed snapshots unchanged. Live rollback rehearsal passed with synthetic records; all test changes rolled back. Browser verified draft recovery, approved quote → job → appointment → completion → correctly priced $295 invoice, and recovery at 390×844 without overflow.
- The production migration was applied after explicit approval. Post-application rollback verification passed without retaining test data. Shared Vercel variables were rechecked: only five non-secret settings exist, so secret-key setup and real email/AI verification remain pending.

# v31.3 client and job management

- Edit Client changes contact details in place while retaining ownership and previously generated document snapshots.
- New Job is available from Customers and Jobs. It selects clients by name, fills the service address, and supports an optional appointment and internal job notes.
- Schedule / Edit preserves a job's original client, completed records, and in-progress status. Conditional updates reject stale edits when a job has been completed elsewhere.
- Unscheduled jobs appear under My Jobs; Today uses the appointment date rather than the creation timestamp. Cancelled/completed jobs are excluded from quote job choices.
- Create Quote on an active job carries the client, job and title into the estimator. Internal job notes are not copied into customer-facing scope. Job cards display the client name and can use the client's phone.
- Validation: all 26 automated tests and workflow smoke checks passed. Browser checks verified client email editing, new unscheduled job, Today filtering, scheduling, mobile job editing at 390×844 without overflow/errors, job → quote → approved $275 estimate → completed job → $275 invoice in Money to Collect. All records were synthetic. No schema migration is needed; required fields and statuses were checked against the live schema.
- Production delivery and AI remain dependent on the outstanding secret-key configuration described below.

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
- `pnpm test:browser`: Playwright desktop/mobile workflow test; requires a working Chromium installation (`pnpm exec playwright install chromium`). This Mac sandbox blocks Chromium process launch; built-in browser checks are performed separately.
- `pnpm dev`: isolated in-memory test server at `http://127.0.0.1:4173`; login `test-key`. Never deploy this test server. Production entry points remain the static files and Vercel API handlers.

Release validation on September 10, 2026: all 17 automated tests and existing smoke checks passed. Built-in browser checks covered desktop/mobile documents, markup controls, job completion, blank-signature validation, Clear/Redo, successful synthetic signing and the preserved mobile signed copy with no overflow or browser errors. The live-database rollback rehearsal passed, and the migration was applied successfully. Public access to the new records and signing functions is denied. Existing auth/key-function advisor warnings remain unchanged; the new server-only tables intentionally have no client policies. Email delivery and billable AI-provider calls were simulated in tests. GitHub/Vercel deployment status is verified separately after publishing.

## Twilio inbound webhook (prepared; not live yet)

Endpoint: POST `https://a-1-field-ops.vercel.app/api/documents?webhook=twilio-sms`. Do not configure Twilio to send traffic here until deployment and credential checks pass.

Required server environment: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164), and `TWILIO_SMS_WEBHOOK_URL` (the exact URL above). Apply `20260911052145_twilio_inbound.sql` before activation. This migration is separate from the already-applied field-tools migration.

Incoming form requests must have a valid Twilio signature, matching account and recipient. Message SIDs prevent duplicate storage. Failed storage returns 503 instead of falsely acknowledging a message. The response sends no automatic text. Media metadata is preserved; media downloading, the customer conversation interface, outbound texting and AI reply options remain to be implemented before the number transfer.

Job photo viewers include Download photo for manual upload to Metricool or another approved destination. Downloads use the resized JPEG stored by FieldOps. No automatic social publishing or marketing permission is implied.

## v31.6 release validation (September 11, 2026)

All 30 automated API/database/UI-binding tests and workflow smoke checks passed. Manual built-in browser checks covered mobile and desktop layouts, price-book insertion, actual photo upload/view/download link, customer history, simulated quote/invoice delivery, delivery-status refresh, customer signing, separate change-order creation, job completion, payment recording, receipt and updated collection totals. Fixed the payment form passing incorrect arguments and the email-activity dialog appearing behind document dialogs. The standalone Playwright runner remains blocked by this Mac sandbox; these browser checks were manual against the isolated test server. No real customer email or card charge was sent.
