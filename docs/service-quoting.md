# Separate service quoting and fixed-total allocation

In Estimates → New Estimate, choose the quoting method:

- **Service quote** uses the dedicated service handler behind `/api/estimate-assist` with `estimator_mode: service`. AI checks scope, asks essential questions, and proposes task-specific labor person-hours and raw material costs. Follow-up answers are saved with the quote's private estimator context. Unknown costs or unresolved questions block applying a price. The owner reviews the scope, hours, materials, allowance and exclusions before applying the full quote.
- **Set my total** uses the existing `/api/estimate-assist` allocation path. The entered subtotal is authoritative; cent reconciliation keeps the complete line-item sum exact. One $75 truck fee is added after allocation. The labor/material calculator remains available when no subtotal is entered. Existing construction allocation remains unchanged.

The service calculator owns arithmetic: labor person-hours × entered selling rate, raw material costs × material allowance × markup, and one truck fee. It never calculates labor cost or profit margin from the customer selling rate. The material allowance is baked into task prices; use zero when fittings are included in costs. No contingency line is produced.

Provider outputs use strict Responses JSON schemas and receive independent server validation. Duplicate task names, extra automatic fee tasks, invalid amounts and invalid inputs are rejected. A supplier URL is displayed only when it also appears in provider search sources or citations; this establishes a retrieved reference, not verified quantities, availability or quote accuracy. Material allowances remain subject to owner verification. Source text and job notes are treated as data in the prompt. No AI result is automatically saved or sent. Editing scope or pricing invalidates the previous recommendation. Requests support cancellation and deadlines without paid automatic retries.

Production requires the existing `OPENAI_API_KEY`; the server's `OPENAI_ESTIMATE_MODEL` override is optional. Quote saving continues to require `SUPABASE_SERVICE_ROLE_KEY`. No new database migration is needed on a database that already has the full-estimate-editor migration.

Verification includes server validation/calculation tests, quote editing/recovery tests, and a phone browser flow through questions → review → apply → save to an isolated database. Browser AI results are simulated. A successful real provider call in the authenticated production app remains a separate live check; configured credentials alone do not establish account quota or model access.

Both paths share the existing Vercel function to stay within the Hobby plan’s 12-function limit.
