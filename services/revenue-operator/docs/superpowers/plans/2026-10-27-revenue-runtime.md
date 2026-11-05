# Revenue operator implementation plan
Goal: continuously orchestrate existing services toward legitimate revenue.
Architecture: PostgreSQL durable queue and event ledger; bounded deterministic decision policy; adapter contracts; Flutter owner control. Owner's supplied mission is the specification and authorization to implement directly.

1. Test then implement revenue policy: no selling without evidence, higher-risk operations require single-task approval, live paid orders trigger delivery, support precedes acquisition.
2. Test then implement persistence: atomic queue claim, lease recovery, idempotency, bounded retries, audit and observation memory.
3. Test then implement signed Stripe payment ingestion, immutable order mapping, asynchronous delivery and verification, refunds/subscription state, currency-separated metrics.
4. Test then implement API authentication, lead capture through authenticated website integration, owner controls, adapters with verification and timeout, persistent scheduling.
5. Implement Flutter owner console, CI, deployment recipe and configuration; run backend builds and PostgreSQL integration tests; run Flutter checks when SDK available.
6. Commit logical increments, push, read back remote commit. No claim of a live customer or production deployment without evidence.

Review focus: concurrent workers; webhook duplicates/out-of-order events; crash between remote effect and queue acknowledgement; untrusted leads/provider output; unknown credentials and missing delivery adapters. Never treat a dispatch acceptance as completed delivery.
