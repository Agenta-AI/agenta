# API Rate Limiting QA

Manual QA checklist for rate limiting functionality. Use alongside the specs in this folder.

---

## Basic Rate Limiting

### Single request within limit
- Preconditions: Fresh bucket, authenticated user.
- Steps: Make single API request.
- Expected: Request succeeds, no rate limit headers on success.

### Exceed rate limit
- Preconditions: Fresh bucket with known capacity.
- Steps: Make requests exceeding capacity in quick succession.
- Expected: 429 response with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers.

### Wait and retry
- Preconditions: Rate limited (received 429).
- Steps: Wait for `Retry-After` seconds, retry request.
- Expected: Request succeeds.

---

## Plan-Based Limits

### HOBBY tier limits
- Preconditions: Organization on HOBBY plan.
- Steps: Test STANDARD, FAST, and SLOW category endpoints.
- Expected: Limits match HOBBY tier (120/120, 1200/1200, 120/1).

### PRO tier limits
- Preconditions: Organization on PRO plan.
- Steps: Test STANDARD, FAST, and SLOW category endpoints.
- Expected: Limits match PRO tier (360/360, 3600/3600, 180/1).

### BUSINESS tier limits
- Preconditions: Organization on BUSINESS plan.
- Steps: Test STANDARD, FAST, and SLOW category endpoints.
- Expected: Limits match BUSINESS tier (3600/3600, 36000/36000, 1800/1).

### Plan upgrade reflects in limits
- Preconditions: Organization on HOBBY, then upgraded to PRO.
- Steps: Exhaust HOBBY limit, upgrade plan, wait for cache expiry, retry.
- Expected: New PRO limits apply after cache refresh.

---

## Category-Based Limits

### STANDARD category
- Preconditions: Authenticated user.
- Steps: Call any non-categorized endpoint.
- Expected: STANDARD limits apply.

### FAST category (CORE_FAST, TRACING_FAST, SERVICES_FAST)
- Preconditions: Authenticated user.
- Steps: Call categorized endpoints (e.g., `POST */retrieve`, `POST /otlp/v1/traces`).
- Expected: FAST limits apply (higher than STANDARD).

### SLOW category (CORE_SLOW, TRACING_SLOW, SERVICES_SLOW)
- Preconditions: Authenticated user.
- Steps: Call slow endpoints (e.g., `POST /tracing/*/query`, `POST /tracing/spans/analytics`).
- Expected: SLOW limits apply (burst capacity, then 1/min refill).

### Multiple categories isolated
- Preconditions: Authenticated user.
- Steps: Exhaust STANDARD limit, then call FAST endpoint.
- Expected: FAST endpoint succeeds (separate bucket).

---

## Bypass and Edge Cases

### Admin bypass
- Preconditions: Admin user.
- Steps: Make requests exceeding normal limits.
- Expected: All requests succeed, no rate limiting.

### Unauthenticated requests
- Preconditions: No authentication.
- Steps: Call public endpoints.
- Expected: Requests not rate-limited (IP limiting not implemented).

### Missing organization
- Preconditions: Request without organization context.
- Steps: Make API request.
- Expected: Request not rate-limited, passes through.

---

## Redis Failure Modes

### Redis unavailable
- Preconditions: Redis down or unreachable.
- Steps: Make API requests.
- Expected: Requests succeed (fail-open mode).

### Redis timeout
- Preconditions: Redis slow (>100ms response).
- Steps: Make API requests.
- Expected: Requests succeed after timeout, logged warning.

### Redis recovers
- Preconditions: Redis was down, now recovered.
- Steps: Make API requests.
- Expected: Rate limiting resumes, buckets start fresh.

---

## Response Validation

### 429 response format
- Preconditions: Rate limited.
- Steps: Examine 429 response.
- Expected:
  - Status: 429
  - Body: `{"detail": "rate_limit_exceeded"}`
  - Header: `Retry-After: <seconds>`
  - Header: `X-RateLimit-Limit: <capacity>`
  - Header: `X-RateLimit-Remaining: 0`

### Retry-After accuracy
- Preconditions: Rate limited with known refill rate.
- Steps: Note `Retry-After` value, wait that duration, retry.
- Expected: Request succeeds within 1-2 seconds of indicated time.

---

## Bucket Key Isolation

### Different organizations isolated
- Preconditions: Two organizations, same plan.
- Steps: Exhaust limit for org A, make request for org B.
- Expected: Org B request succeeds (separate bucket).

### Same organization, different categories isolated
- Preconditions: Single organization.
- Steps: Exhaust STANDARD limit, call FAST endpoint.
- Expected: FAST request succeeds (separate bucket).

### Plan change creates new bucket
- Preconditions: Organization changes plan.
- Steps: Exhaust limit on old plan, upgrade, wait for cache, retry.
- Expected: New bucket with new plan limits.

---

## Algorithm Behavior (GCRA)

### Smooth scheduling
- Preconditions: Fresh bucket.
- Steps: Make requests at steady rate just below limit.
- Expected: All requests succeed, no bursts of 429s.

### Burst then throttle
- Preconditions: Fresh bucket with burst capacity.
- Steps: Make burst of requests, then continue at rate.
- Expected: Burst succeeds, then smoothly throttled to rate.

### Remaining tokens accuracy
- Preconditions: Fresh bucket.
- Steps: Make N requests, check `X-RateLimit-Remaining` on 429.
- Expected: Remaining decreases predictably.

---

## Notes

- SLOW category has very restrictive refill (1/min). Test burst exhaustion carefully.
- Cache TTL for subscription data affects plan change propagation.
- Use Redis CLI (`redis-cli KEYS "throttle:*"`) to inspect bucket state.
- Use `peek_throttle` utility for debugging bucket state without consuming tokens.
