# FieldOps improvement priorities — September 11, 2026

Reviewed the current app source and official competitor feature descriptions. Feature presence is not a claim that every production workflow has been tested.

| Area | FieldOps today | Useful next improvement |
|---|---|---|
| Quotes | AI task pricing, editable line items, 25% material markup, $75 truck fee, signatures and change orders | Customer-selectable quote packages and optional add-ons |
| Payments | Square integration, partial invoice payment links, Apple Pay support, payment/refund records | Finish real-device checkout validation; improve link creation usability |
| Customer records | Internal customer history, previous jobs and photos | A secure customer portal for quotes, invoices and service requests |
| Scheduling | Appointment dates, Today/My Jobs, schedule/edit controls | A weekly calendar and conflict warnings before adding multi-technician dispatch |
| Follow-up | Email delivery activity, outstanding work dashboard; phone port pending | Reviewable reminder queue, followed by consent-aware automation |
| Profitability | Materials, invoice/payment records, bookkeeping CSV | Estimated versus actual labor/material costs per job |

## Benchmarks

- Jobber: client hub for quote approval and invoice payments; a useful reference for customer self-service. https://www.getjobber.com/features/client-hub/
- Housecall Pro: scheduling, dispatching, recurring jobs, price book and job costing. https://www.housecallpro.com/features/
- ServiceTitan: price book tracks material/labor costs with margin insights. Official prospectus: https://investors.servicetitan.com/static-files/4c943907-eb22-498e-bbf6-f21302460544

## This release

Payment collection now uses an inline amount field prefilled with the balance, supports smaller amounts, explains that link creation does not send or charge, disables repeated requests, adds copy-link access, and hides collection for zero-balance or void invoices. No real customer charges or messages were sent during verification.

Recommended next batch: weekly scheduling view and a manual follow-up queue. Customer portal and recurring automation require additional access-control and delivery design before release.
