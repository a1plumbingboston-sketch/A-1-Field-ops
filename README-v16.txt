A-1 FieldOps Mobile v16 — Device Session Hardening
- Access key is no longer persisted in localStorage across browser restarts.
- Key is stored only in sessionStorage for the current browser/tab session.
- Adds automatic lock after 30 minutes of inactivity.
- Sign out clears the session credential and in-memory credential.
- Builds on the latest Money Today + Smart Estimator package.
Remaining priority: replace shared access-key architecture with real per-user Supabase Auth + role claims, server-side authorization, durable audit events, and production payment processing.
