A-1 FieldOps v20 — AI Reply Queue

Completed:
- Added persistent AI reply state to the live Supabase leads table.
- New social leads can automatically receive an AI-generated reply draft when AI_AUTO_DRAFTS is not set to off.
- Drafts are classified as routine, approval, urgent, or emergency.
- Pricing, scheduling, sensitive complaints, and safety-related messages are held for approval.
- Routine messages are marked draft_ready but are still not automatically sent until an outbound social channel is connected.
- Lead Inbox shows saved AI drafts and the reason for escalation.
- Manual AI Reply regenerates and saves the draft to the lead.
- Uses gpt-5.6-luna by default for cost-sensitive high-volume reply drafting; override with OPENAI_REPLY_MODEL.

Important:
- Automatic outbound social sending is intentionally not active yet because no Facebook/Instagram/WhatsApp messaging app is connected to the current Mailopoly account.
- This build makes the AI drafting/approval pipeline ready for that connection.
- OPENAI API usage is metered whenever a draft is generated.

Next:
- Connect authorized Facebook/Instagram/WhatsApp business messaging to the outbound provider.
- Add provider message/thread IDs to incoming webhooks.
- Enable safe_auto_send only for routine categories after end-to-end test.
- Replace shared FieldOps key with per-user Supabase Auth/RBAC.
