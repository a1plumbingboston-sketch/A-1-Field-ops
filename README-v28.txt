A-1 FieldOps v28 - Customer PDF Delivery

- Adds Send Quote and Send Invoice buttons.
- Sends the full customer document by email instead of only opening a text email draft.
- Customer receives a branded HTML email plus a PDF attachment generated from the live FieldOps record.
- Uses actual customer, line-item, total, payment and balance data from Supabase.
- Marks the estimate/invoice sent only after the email provider accepts the message.
- Keeps Email Draft as a fallback for opening iPhone Mail manually.
- Requires two Vercel environment variables for live sending:
  RESEND_API_KEY
  FIELDOPS_FROM_EMAIL (example: A-1 Plumbing & Heating <quotes@a1plumbing.boston>)
- Optional: FIELDOPS_REPLY_TO (defaults to a1plumbingboston@gmail.com)
- Sender domain must be verified with the email provider before sending to customers.
