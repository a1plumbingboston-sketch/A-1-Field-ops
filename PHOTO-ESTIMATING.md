# Service photo estimating

Inspired by SimplyWise's photo/notes → questions → itemized estimate → quote workflow:
https://www.simplywise.com/blog/simplywise-construction-cost-estimator/

Service quotes now accept up to three JPEG/PNG/WebP job photos. The browser compresses each to JPEG with a longest side of 1280 pixels and caps its encoded size. Images stay in session memory, clear when changing customers/jobs or estimates, and are sent only with an explicit AI estimate request. They are not stored with quotes or added to customer documents. Phone keyboard dictation remains available for spoken scope notes.

The existing authenticated estimate endpoint sends photos as image inputs. AI must ask clarifying questions before pricing when important scope facts are unknown; the server strips all speculative pricing from clarification responses and the UI shows questions instead of an Apply button. Users append answers to the scope and run the estimate again. The configured labor rate, price-book references, material-only markup, and single truck fee remain authoritative. Review and quote editing remain required. Remodel/new-construction owner-price allocation stays separate.

Not included: LiDAR, blueprint measurement extraction, renderings, supplier-feed integration, dedicated audio recording/transcription, or guaranteed photo diagnosis.

Validation: all 186 automated tests and all 6 browser tests pass. The mobile service flow verifies photo preparation, clarification without an Apply button, answering scope questions, real authenticated API handling with a synthetic AI provider, reviewed item selection, exact saved total, one truck fee, and photo exclusion from customer data. Existing remodel allocation and quote → signature → change order → completion → payment → receipt browser flows pass. The previous client-quote failure was an outdated test harness and synthetic database missing the existing estimate-editor migration; those fixtures are now current.

Live setup: the user's active deployment is a-1-field-ops.vercel.app. Its production configuration lists neither OPENAI_API_KEY nor SUPABASE_SERVICE_ROLE_KEY. The older mobile deployment contains both, but they are write-only sensitive secrets and cannot be copied through the connected Vercel tools. Both credentials must be entered in the active project's production settings and a fresh production deployment created before live AI can be verified. Preview environments have no AI/database credentials; preview build success does not prove live AI availability. No real customer data, emails, signatures or payments were used in testing.
