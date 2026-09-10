A1 FieldOps Mobile v22 — Customer Contact + Quote/Invoice Delivery

Changes:
- Customer cards now include Call, Text, Email, and Estimate actions.
- Estimate review adds Call, Text Quote, Email Quote, and Mark Sent.
- Invoice review adds Call, Text Invoice, Email Invoice, and Mark Sent.
- Text/email actions open the iPhone native composer with quote/invoice summary and total prefilled; nothing sends automatically.
- Approved estimate -> invoice now copies title, description, totals, and line items.
- Billing schema compatibility fixes are live in Supabase: estimate/invoice description/title, line totals/sort order, sent timestamps, invoice paid/updated timestamps, and default owner IDs for one-person FieldOps inserts.
- No paid messaging provider added.

Validation:
- Embedded JavaScript syntax checked with Node.
- Database rollback test successfully created estimate + line item + invoice + line item + payment using the same omitted-owner/default pattern used by the app, without leaving test records.
