# Audit evidence — 27 October 2026

Initial Manager checkout: `60396f3934a4ceff6e652eee3dbb41afe7aee523`, README only. During implementation, independent changes appeared on remote main, including `66ca7d015c33be3cf70bff0647b23ebe0befe8c5` and `39753c74b41717170a785921adf5dd36c412423f`. They were preserved. This service uses another directory, CI file and private schema; no automatic conversion of existing state is attempted.

Read current files through the connected GitHub service:

| System | Evidence read | Consequence |
|---|---|---|
| Marketing | `backend/src/index.js`, routes `content.js`, `crm.js`, `orchestrator.js`, `products.js`, `autoPosting.js`, `scheduler.js` | Authenticated portfolio/content/CRM/campaign and auto-post APIs exist. Native portfolio reader implemented. Machine credentials, entitlement and durable dispatch/result adapters still need qualification. A campaign draft does not establish publication. |
| AppForge | `Anselm04/AppForge.` metadata; `src/routes/agents.ts`; route search in `build.ts`, checkout and project routers | Accessible repo has trailing dot. Legacy agents/build returns 410. Real path is projects.create plus build SSE. No safe durable Manager build/deploy adapter established. |
| Website | README/index excerpts and `workers/course-gate.js` | Existing product payment links and Stripe entitlement gate exist. This is not proof that Manager ingress or delivery is connected. |
| Secure | `Anselm04/TrillionOS-Security/README.md` | Pinned seL4 foundation is described; no operational Manager security API is established. No assurance/production claim inferred. |
| Education | Website course gate and Marketing course-factory route registrations | Course-related code exists. Full course quality, entitlements, membership and delivery remain unqualified. |
| Supabase | Connected project list | `yihcwxmcvmcquvsulqkv` active, existing AppForge-associated project; `cnniffhhvekeuryzzdqo` inactive. Neither modified or repurposed. A Manager DB/runtime login is still needed. |

No live checkout, customer email, campaign, payment, deployment, production migration or financial mutation was performed. Interactive ChatGPT connections do not supply deployable runtime credentials. Code inspection is a limited integration audit, not full audits of the other repositories.

Reference checked: Stripe webhook documentation (raw-body signatures, duplicate/out-of-order event handling) and Supabase RLS/connection documentation. Requests for the Supabase changelog markdown failed in the browsing service; no Supabase SDK-specific behavior is assumed by the PostgreSQL schema.
