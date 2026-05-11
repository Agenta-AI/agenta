# PR - API Rate Limiting (Throttling)

## Executive summary

This PR introduces a Redis-based API rate limiting system with support for multiple algorithms
(TBRA and GCRA), plan-based throttle policies via the entitlements system, and middleware
integration for automatic enforcement. The implementation follows a three-layer architecture
separating Lua scripts, library API, and middleware concerns.

## Change inventory (organized by area)

### OSS backend (throttling library)

- New `throttling.py` utility with Redis Lua scripts for TBRA and GCRA algorithms.
- Layer 1: Raw script execution (`execute_tbra`, `execute_gcra`).
- Layer 2: Public API (`check_throttle`, `check_throttles`) with key building and failure handling.
- Utility functions: `peek_throttle`, `reset_throttle` for debugging/admin.

Key files:
- `api/oss/src/utils/throttling.py`

### EE backend (middleware and entitlements)

- New throttling middleware that enforces rate limits after authentication.
- Integration with entitlements system via `Tracker.THROTTLES`.
- Plan-based throttle policies for HOBBY, PRO, BUSINESS tiers.
- Category-based endpoint grouping (STANDARD, CORE_FAST, TRACING_SLOW, etc.).
- Subscription caching for plan resolution.

Key files:
- `api/ee/src/services/throttling_service.py`
- `api/ee/src/core/entitlements/types.py`

### Entitlements expansion

- New `Tracker.THROTTLES` tracker type for rate limit policies.
- New types: `Bucket`, `Throttle`, `Mode`, `Category`, `Method`.
- `ENDPOINTS` registry mapping categories to endpoint patterns.
- Throttle definitions per plan in `ENTITLEMENTS` dict.

Key files:
- `api/ee/src/core/entitlements/types.py`

### Documentation

- Design specs covering concepts, policies, algorithms, implementation, and middleware.
- QA checklist for manual testing.

Key files:
- `docs/designs/api-rate-limiting/README.md`
- `docs/designs/api-rate-limiting/throttling.*.specs.md`
- `docs/designs/api-rate-limiting/QA.md`

## Behavior and policy changes

- Authenticated requests are rate-limited based on organization's subscription plan.
- Different limits apply to different endpoint categories (STANDARD, FAST, SLOW).
- SLOW category endpoints (analytics, queries) have burst capacity but very low refill rate.
- Admin users bypass rate limiting.
- Unauthenticated requests are not rate-limited (IP-based limiting not yet implemented).
- On Redis failure, requests are allowed (fail-open).

## Rate limits by plan

| Plan | Category | Capacity | Rate/min |
|------|----------|----------|----------|
| HOBBY | STANDARD | 120 | 120 |
| HOBBY | FAST | 1,200 | 1,200 |
| HOBBY | SLOW | 120 | 1 |
| PRO | STANDARD | 360 | 360 |
| PRO | FAST | 3,600 | 3,600 |
| PRO | SLOW | 180 | 1 |
| BUSINESS | STANDARD | 3,600 | 3,600 |
| BUSINESS | FAST | 36,000 | 36,000 |
| BUSINESS | SLOW | 1,800 | 1 |

## Response format

429 responses include:
- `Retry-After` header with seconds until retry
- `X-RateLimit-Limit` header with bucket capacity
- `X-RateLimit-Remaining` header with remaining tokens
- Body: `{"detail": "rate_limit_exceeded"}`

## Risks and considerations

- Redis dependency: Rate limiting requires Redis volatile instance. Failure mode is open (allow).
- Algorithm choice: GCRA is now the default. TBRA available but not used in current policies.
- No IP limiting: Unauthenticated endpoints are unprotected. Future work needed.
- SLOW category limits: Very restrictive (1/min after burst). May need adjustment based on usage.
- Cache invalidation: Plan changes require cache expiry (TTL-based, no active invalidation).

## Suggested validation

- Follow the QA checklist in `docs/designs/api-rate-limiting/QA.md`.
- Test rate limiting for each plan tier.
- Verify 429 responses include correct headers.
- Test Redis failure behavior (should allow requests).
- Verify admin bypass works correctly.
- Load test to confirm limits are enforced accurately.
