A-1 FieldOps v21 — AI Approval Controls
Completed:
- Adds persistent Approve/Hold controls to AI lead replies.
- Shows routine vs approval-required state directly in the mobile lead card.
- Approved state clears the approval flag; Hold keeps the reply gated.
- Uses the existing protected FieldOps REST path; no service-role credential is exposed to the browser.
- Preserves AI safety restrictions and does not auto-send social messages without an authorized outbound channel.
Remaining:
- Connect Facebook/Instagram/WhatsApp outbound messaging.
- Replace shared access key with per-user Supabase Auth/RBAC.
- Add durable server-side audit events for every AI generation/approval/send.
