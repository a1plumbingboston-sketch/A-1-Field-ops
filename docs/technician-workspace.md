# Employee workspace · v31.8.0

Manager: Jobs → Team & Schedule → Employees. Create an employee using their name, existing company/work email, and calendar color. Copy the one-time-displayed sign-in details and share them privately. This does not provision an email mailbox or send an email invitation.

Employee: open `/employee` in Safari on the iPad. Sign in with the personal code, then choose Share → Add to Home Screen. The browser stores the credential in an HttpOnly cookie; the server stores only its digest. Disable an employee or rotate their code to revoke existing access. The current owner access key remains the manager credential. This installation supports one business.

Schedule appointments and assignments inside FieldOps. Existing Google appointments are not automatically imported: reconcile them before rebooking. Employee scope/access instructions are entered by the manager. Keep these consistent with the approved quote; employee updates cannot alter signed documents.

Employees see assigned appointments only, add job messages and compressed photos, and submit completed work for review. Managers reply in the same conversation and approve field completion. This never creates or sends an invoice automatically. All updates carry the server-verified actor and time. Reassigned employees lose access immediately.

The schedule refreshes while open; conversations have a Refresh conversation button. Internet is required. There are no background push notifications, automatic AI booking, or offline upload queues in this first release. The installation is a Home Screen web app, not an App Store binary. Business calling remains disabled until the Twilio port and routing are verified.

Database migration: `20260911211117_technician_workspace.sql`. Adds three isolated tables and a service-role-only invoker RPC. Existing records and permissions are unchanged. Never grant public access to these tables or RPC. Database migration must be applied before publishing the employee UI.

Validation: SQL authorization/assignment, disabled accounts, forbidden owner actions, attributed messages/photos, idempotent retries, overlap and stale-revision checks, email uniqueness, and end-to-end HTTP authentication. Browser pilot covers sign-in, job update, image upload, work review, and responsive layouts using synthetic records. A physical employee iPad pilot is still required before relying on camera or installed-app behavior in the field.
