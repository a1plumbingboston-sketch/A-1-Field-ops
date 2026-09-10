A-1 FieldOps Mobile v18 — Lead Conversion Repair

Completed:
- Fixed Lead → Customer + Job conversion for the current shared FieldOps access-key architecture.
- Browser no longer calls the auth.uid()-dependent conversion RPC directly.
- Added /api/convert-lead server route that validates the existing x-fieldops-key first.
- Conversion then runs server-side using SUPABASE_SERVICE_ROLE_KEY.
- Added atomic database RPC public.convert_lead_service, executable by service_role only.
- If the Supabase project has exactly one Auth user, the server resolves that user as owner automatically.
- If there are multiple Auth users, set FIELDOPS_OWNER_ID in Vercel to the intended owner's auth user UUID.
- No service-role credential is exposed to the browser.

Security note:
This repairs the conversion bug without weakening database access. The next major security upgrade is still true per-user Supabase Auth + roles instead of a shared FieldOps key.
