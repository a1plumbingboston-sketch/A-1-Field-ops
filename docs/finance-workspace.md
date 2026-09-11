# Finance workspace — 31.8.3

Owner-only workspace available under Invoices → Finance & hourly cost calculator.

Includes deterministic hourly break-even, margin-based selling rate and separate debt-principal cash coverage. Every assumption must be entered; no fabricated defaults or automatic quote price changes. The high-reasoning finance assistant uses OPENAI_FINANCE_MODEL, then OPENAI_BUSINESS_MODEL, then the existing gpt-6-astra default. It receives aggregate ledger totals and calculator assumptions, not payees or receipt notes. Reviews are on demand.

Spending, unpaid bills, loan proceeds/principal, owner contributions/draws, major equipment and tax payments are separate records. Entries are idempotent by UUID. Corrections preserve a void reason rather than deleting records. CSV contains payment status and void status. Customer collections come from successful payment records including negative refunds. Failed or pending payments are excluded from collection totals.

Historical charts use Boston payment dates, omit future months, and distinguish cumulative recorded movement from a bank balance. Twelve-month scenarios are explicitly modeled assumptions, not actual cash forecasts. Paid spending must be entered manually; job-material cost entries are not assumed paid or counted automatically. Bank feeds, reconciliation, receipt-file storage, payroll filing, depreciation, tax calculations, filing and lender-account synchronization are not implemented by this release. Supporting receipts should be retained separately and referenced in entries. The IRS recordkeeping link and preparation checklist describe necessary supporting records.

Database: fieldops_cost_profile and fieldops_finance_entries have RLS enabled and no public policies; anon/authenticated/PUBLIC privileges revoked. Access is through existing owner-key authorization and the server service role. No existing records changed.

Validation: 15 focused finance/payment/field-tool/business-review tests passed; additional final finance tests passed after including correction history. Covered margin math, billable capacity, missing inputs, refunds, nonrevenue funding, authentication, private table privileges, invalid dates, duplicate saves, 501-row pagination and minimal AI payloads. Browser checked sample calculator save and simulated AI review. No real financial entries or card charges created during testing.

Initial setup still needs the owner's real costs, records and accountant review. This release is a finance workspace, not a completed tax return or certified set of reconciled books.
