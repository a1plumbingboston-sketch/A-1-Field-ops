# Service photo estimating

Inspired by SimplyWise's photo/notes → questions → itemized estimate → quote workflow:
https://www.simplywise.com/blog/simplywise-construction-cost-estimator/

Service quotes now accept up to three JPEG/PNG/WebP job photos. The browser compresses each to JPEG with a longest side of 1280 pixels and caps its encoded size. Images stay in session memory, clear when changing customers/jobs or estimates, and are sent only with an explicit AI estimate request. They are not stored with quotes or added to customer documents. Phone keyboard dictation remains available for spoken scope notes.

The existing authenticated estimate endpoint sends photos as image inputs. AI must ask clarifying questions before pricing when important scope facts are unknown; the server strips all speculative pricing from clarification responses and the UI shows questions instead of an Apply button. Users append answers to the scope and run the estimate again. The configured labor rate, price-book references, material-only markup, and single truck fee remain authoritative. Review and quote editing remain required. Remodel/new-construction owner-price allocation stays separate.

Not included: LiDAR, blueprint measurement extraction, renderings, supplier-feed integration, dedicated audio recording/transcription, or guaranteed photo diagnosis.

Validation: new API/validation/UI-gate tests and existing estimator tests pass. Full suite: 184/185 passed before the last UI-gate test was added; the remaining client-quote test fails with estimateHydrating undefined on unchanged main as well. Browser test added for compression and cross-customer clearing; local Chromium launch is blocked by this environment's socket restrictions, so it remains unverified. Live AI behavior and production credentials have not been tested.
