# Turnstile Fix — Task Breakdown

Source: [turnstile-investigation-report.md](./turnstile-investigation-report.md)

---

## Task 1: Backend — Add Turnstile to passwordless `create_code_post`

**Priority**: P0 — This is the primary abuse vector.
**Status**: Completed.

### What

Override `create_code_post` inside `override_passwordless_apis()` in `api/oss/src/core/auth/supertokens/overrides.py`. Call `verify_turnstile_or_raise(request=api_options.request)` before delegating to the original implementation.

### Where

- `api/oss/src/core/auth/supertokens/overrides.py` — `override_passwordless_apis()` (L470-502)

### Implementation notes

- Follow the same pattern used in `override_emailpassword_apis()` (L355-467):
  - Define a local `verify_turnstile()` helper or reuse the one from the emailpassword override
  - Extract `api_options` and `user_context` from the function signature
  - Call `verify_turnstile_or_raise(request=api_options.request)` before `original_create_code_post(...)`
- SuperTokens `create_code_post` signature can be found from the `PasswordlessRecipeInterface` (or inspected at runtime). Ensure the override signature matches exactly.

### Definition of done

- [ ] `create_code_post` is overridden in `override_passwordless_apis()`
- [ ] `verify_turnstile_or_raise()` is called before the original implementation
- [ ] If Turnstile verification fails, the request is rejected with `UnauthorizedException` (no OTP sent)
- [ ] If Turnstile is disabled (`is_turnstile_enabled() == False`), the flow proceeds as before (no regression for OSS)

### Review objectives

- Verify the override signature matches SuperTokens' `APIInterface.create_code_post` exactly
- Verify Turnstile check happens **before** `original_create_code_post` (not after)
- Verify no exception is swallowed — failure must hard-reject
- Confirm OSS (non-EE) still works with Turnstile disabled

### Testing objectives

- Manual: With Turnstile enabled, POST `/auth/signinup/code` without `x-turnstile-token` header → expect 401
- Manual: With Turnstile enabled, POST `/auth/signinup/code` with invalid token → expect 401
- Manual: With Turnstile enabled, POST `/auth/signinup/code` with valid token → expect OTP sent
- Manual: With Turnstile disabled (OSS mode), POST `/auth/signinup/code` without token → expect OTP sent (no regression)

---

## Task 2: Backend — Add Turnstile to passwordless `consume_code_post`

**Priority**: P0 — Defense-in-depth on the code consumption step.
**Status**: Completed.

### What

Add `verify_turnstile_or_raise(request=api_options.request)` to the existing `consume_code_post` override.

### Where

- `api/oss/src/core/auth/supertokens/overrides.py` — `consume_code_post()` inside `override_passwordless_apis()` (L475-499)

### Implementation notes

- The override already exists but does nothing beyond calling the original. Add the Turnstile call at the top, before `original_consume_code_post(...)`.

### Definition of done

- [ ] `verify_turnstile_or_raise()` is called at the top of `consume_code_post`
- [ ] Rejection behavior matches other protected flows (401 with "Security check failed" message)

### Review objectives

- Verify the call is placed before `original_consume_code_post`, not after
- Verify `api_options` is correctly referenced (it's already in the signature)

### Testing objectives

- Manual: POST `/auth/signinup/code/consume` without token → expect 401
- Manual: POST `/auth/signinup/code/consume` with valid token + valid OTP → expect success

---

## Task 3: Backend — Add Turnstile to passwordless `resend_code_post`

**Priority**: P1 — Secondary abuse vector.
**Status**: Completed.

### What

Override `resend_code_post` inside `override_passwordless_apis()` and call `verify_turnstile_or_raise()`.

### Where

- `api/oss/src/core/auth/supertokens/overrides.py` — `override_passwordless_apis()` (L470-502)

### Implementation notes

- `resend_code_post` is currently not overridden at all. Add a new override following the same pattern as `create_code_post`.
- Check the SuperTokens `APIInterface` for the exact signature of `resend_code_post`.

### Definition of done

- [ ] `resend_code_post` is overridden in `override_passwordless_apis()`
- [ ] `verify_turnstile_or_raise()` is called before the original implementation
- [ ] Rejection behavior matches other protected flows

### Review objectives

- Verify override signature matches SuperTokens' `APIInterface.resend_code_post`
- Confirm it follows the same pattern as `create_code_post` override

### Testing objectives

- Manual: POST `/auth/signinup/code/resend` without token → expect 401

---

## Task 4: Frontend — Add Turnstile widget to `PasswordlessAuth` component

**Priority**: P0 — Without this, the frontend never generates or sends a token for OTP flow.
**Status**: Completed.

### What

Add `TurnstileWidget` rendering and token management to the `PasswordlessAuth` component, matching the pattern used in `EmailPasswordAuth`.

### Where

- `web/oss/src/components/pages/auth/PasswordlessAuth/index.tsx`

### Implementation notes

Follow the pattern from `web/oss/src/components/pages/auth/EmailPasswordAuth/index.tsx`:
1. Import `TurnstileWidget` from `@/oss/components/pages/auth/Turnstile`
2. Import `isTurnstileEnabled`, `setPendingTurnstileToken` from `@/oss/lib/helpers/auth/turnstile`
3. Add a ref for the Turnstile widget handle
4. Add a state variable to track the current token
5. Implement `ensureTurnstileToken()` that returns a promise resolving when a valid token is available
6. In `sendOTP`, call `ensureTurnstileToken()` and `setPendingTurnstileToken(token)` before `createCode()`
7. Render `<TurnstileWidget>` conditionally when `isTurnstileEnabled()` is true
8. Reset widget on error

### Definition of done

- [ ] `TurnstileWidget` renders below the email input when Turnstile is enabled
- [ ] Token is obtained before `createCode()` is called
- [ ] `setPendingTurnstileToken()` is called with the token before the fetch fires
- [ ] Widget resets on error so user can retry
- [ ] Component renders without widget when Turnstile is disabled (no regression)

### Review objectives

- Verify the widget is rendered conditionally on `isTurnstileEnabled()`
- Verify `setPendingTurnstileToken()` is called **before** `createCode()`, not after
- Verify error handling resets the widget
- Verify no UX regression when Turnstile is disabled
- Run `pnpm lint-fix` in web folder

### Testing objectives

- Visual: Load `/auth` in EE mode with Turnstile keys → Turnstile widget appears on OTP form
- Visual: Load `/auth` in OSS mode → no Turnstile widget (no regression)
- E2E: Submit OTP form → token attached to request → OTP sent successfully
- E2E: Submit OTP form with expired/invalid token → error shown, widget resets

---

## Task 5: Frontend — Add OTP paths to `TURNSTILE_AUTH_PATHS`

**Priority**: P0 — Without this, the fetch patch won't attach the token to OTP requests even if the widget generates one.
**Status**: Completed.

### What

Add `/api/auth/signinup/code`, `/api/auth/signinup/code/consume`, and `/api/auth/signinup/code/resend` to the `TURNSTILE_AUTH_PATHS` set.

### Where

- `web/oss/src/lib/helpers/auth/turnstile.ts` — line 4

### Implementation notes

Change:
```typescript
const TURNSTILE_AUTH_PATHS = new Set(["/api/auth/signin", "/api/auth/signup", "/api/auth/signinup"])
```
To:
```typescript
const TURNSTILE_AUTH_PATHS = new Set([
    "/api/auth/signin",
    "/api/auth/signup",
    "/api/auth/signinup",
    "/api/auth/signinup/code",
    "/api/auth/signinup/code/consume",
    "/api/auth/signinup/code/resend",
])
```

### Definition of done

- [ ] All three new paths are in `TURNSTILE_AUTH_PATHS`
- [ ] `shouldAttachTurnstileHeader()` returns true for OTP API calls

### Review objectives

- Verify exact path strings match what SuperTokens SDK actually calls (check network tab)
- Verify the trailing-slash normalization on L30 still works correctly
- Run `pnpm lint-fix` in web folder

### Testing objectives

- Unit/manual: Confirm `shouldAttachTurnstileHeader(new Request("/api/auth/signinup/code"))` returns true
- E2E: Inspect network tab during OTP flow → `x-turnstile-token` header is present on the request

---

## Task 6: Frontend — Add Turnstile widget to `SendOTP` component

**Priority**: P1 — Defense-in-depth for the code consumption step.
**Status**: Completed.

### What

Add Turnstile token management to the `SendOTP` component so that `consumeCode()` also carries a valid token.

### Where

- `web/oss/src/components/pages/auth/SendOTP/index.tsx`

### Implementation notes

- The `SendOTP` component handles OTP input and submission via `consumeCode()`.
- Add `setPendingTurnstileToken()` call before `consumeCode()`.
- The token can be passed down from the parent (which already has the widget from Task 4), or the widget can be rendered independently in `SendOTP`. Decide based on UX — having the widget in the parent and passing the token ref is likely cleaner, since the user already solved Turnstile on the previous step.
- If reusing the parent's token: the token may have expired (5 min). Consider refreshing it before `consumeCode()`.

### Definition of done

- [ ] `consumeCode()` call is preceded by `setPendingTurnstileToken()`
- [ ] Token is valid (not expired) at the time of submission
- [ ] If token expired, widget refreshes and user gets a new one before retry

### Review objectives

- Verify token freshness strategy — is the token from `create_code_post` still valid when `consume_code_post` fires?
- If a new widget is rendered, verify it doesn't create a confusing double-widget UX

### Testing objectives

- E2E: Enter OTP after Turnstile → `x-turnstile-token` header present on consume request
- E2E: Wait >5 minutes after getting OTP, then submit → token refresh occurs, submission succeeds

---

## Task 7: Backend — Validate hostname in Siteverify response

**Priority**: P2 — Hardening for all protected flows.
**Status**: Completed.

### What

After Siteverify returns `success: true`, also validate that the `hostname` field matches one of the expected production domains.

### Where

- `api/oss/src/core/auth/turnstile.py` — `verify_turnstile_or_raise()` (L56-57)

### Implementation notes

- The Siteverify response includes a `hostname` field indicating where the widget was rendered.
- Add a new env var (or derive from `env.agenta.web_url`) for expected hostnames.
- After `success is True`, check `verification_result.get("hostname")` against allowed hostnames.
- If hostname doesn't match, log a warning and reject.
- Consider making hostname validation opt-in via config to avoid breaking dev/staging environments with different hostnames.

### Definition of done

- [ ] Hostname is validated on successful Siteverify response
- [ ] Mismatch is logged and causes hard rejection
- [ ] Expected hostnames are configurable (env var or derived from existing config)
- [ ] Dev/staging environments are not broken (either by config or by opt-in flag)

### Review objectives

- Verify the hostname list covers all production domains (EU, US, staging)
- Verify the validation doesn't break localhost/dev flows
- Verify the log message includes the actual vs expected hostname for debugging

### Testing objectives

- Manual: In production, verify hostname matches and requests succeed
- Manual: Forge a request with a token from a different hostname → expect rejection

---

## Task 8: Backend — Add structured logging for all signup attempts

**Priority**: P2 — Observability for ongoing monitoring.
**Status**: Completed.

### What

Add structured log lines at key points in the signup flow to enable diagnosis of future abuse.

### Where

- `api/oss/src/core/auth/turnstile.py` — `verify_turnstile_or_raise()` entry point
- `api/oss/src/core/auth/supertokens/overrides.py` — each API override entry point

### Implementation notes

Log the following at each signup API override entry:
- Auth method (emailpassword / passwordless / thirdparty)
- Email domain (not full email for privacy)
- Client IP
- Turnstile token present (yes/no)
- Turnstile verification result (success/failure/skipped)

At `verify_turnstile_or_raise` entry when disabled:
- Log reason: "not EE" vs "keys missing"
- Log once at startup rather than per-request to avoid noise

### Definition of done

- [ ] Each API override logs auth method + email domain + client IP at entry
- [ ] Turnstile skip reason is logged (at startup or first call)
- [ ] Successful Turnstile verification logs the hostname from the response
- [ ] No PII (full email) in logs — only domain

### Review objectives

- Verify no PII leakage in log messages
- Verify log levels are appropriate (info for normal flow, warning for skips, error for failures)
- Verify log volume is acceptable (not per-request noise for disabled state)

### Testing objectives

- Manual: Trigger each signup flow and verify log output contains expected fields

---

## Task 9: Backend — Add rate limiting on `create_code_post` per IP

**Priority**: P2 — Defense-in-depth independent of Turnstile.
**Status**: For later.

### What

Add application-level rate limiting on the OTP creation endpoint to prevent email spray attacks even if Turnstile is bypassed or disabled.

### Where

- `api/oss/src/core/auth/supertokens/overrides.py` — `create_code_post` override (after Task 1)
- Potentially a new rate-limiting utility if one doesn't exist

### Implementation notes

- Check if SuperTokens has built-in rate limiting for `create_code_post` (it may already limit per device/session).
- If not, implement a simple in-memory or Redis-backed rate limiter:
  - Key: client IP (extracted via `_extract_client_ip` from turnstile.py)
  - Limit: e.g., 5 OTP requests per IP per 5 minutes
  - Response: 429 Too Many Requests
- Consider also rate limiting per email to prevent targeted abuse.

### Definition of done

- [ ] OTP creation is rate-limited per IP
- [ ] Exceeding the limit returns 429
- [ ] Rate limit is configurable via env var
- [ ] Rate limiter state is shared across workers (if using multi-process deployment)

### Review objectives

- Verify rate limit values are reasonable (not too strict for legitimate use)
- Verify the rate limiter handles concurrent requests correctly
- Verify it doesn't break tests or dev environments

### Testing objectives

- Manual: Send 6+ rapid OTP requests from same IP → expect 429 after threshold
- Manual: Send requests from different IPs → each gets their own quota

---

## Task 10: Validation — Post-deployment Turnstile analytics check

**Priority**: P1 — Confirms fixes are working.
**Status**: Pending post-deploy validation.

### What

After deploying Tasks 1-6, monitor Cloudflare Turnstile analytics to verify Siteverify call volume increases to match total signup volume.

### Where

- Cloudflare dashboard → Turnstile analytics

### Definition of done

- [ ] Siteverify request count matches (approximately) total signup attempts
- [ ] Valid token count is close to Siteverify request count (low failure rate)
- [ ] No spike in 401 errors from legitimate users (no false positives)
- [ ] Fake signup rate drops significantly

### Review objectives

- Compare pre-fix and post-fix Siteverify volumes
- Check for any auth flow that still shows zero Siteverify calls

---

## Task 11: Audit — Review remaining SuperTokens API surface

**Priority**: P2 — Proactive hardening.
**Status**: Pending.

### What

Audit all SuperTokens `APIInterface` methods across all recipes to identify any other endpoints that could be abused without going through an override.

### Where

- SuperTokens `emailpassword`, `passwordless`, `thirdparty`, `session` recipe interfaces

### Implementation notes

Confirmed passwordless `APIInterface` methods:
- `create_code_post` — **now overridden (Task 1)**
- `consume_code_post` — **now overridden (Task 2)**
- `resend_code_post` — **now overridden (Task 3)**
- `email_exists_get` — check if this leaks user enumeration
- `phone_number_exists_get` — check if this is exposed (app is email-only)

Check emailpassword and thirdparty interfaces similarly for any unoverridden methods.

### Definition of done

- [ ] All publicly-reachable SuperTokens API methods are documented
- [ ] Each is assessed for abuse potential
- [ ] Any requiring protection are filed as follow-up tasks

### Review objectives

- Verify completeness — no API method is missed
- Assess `email_exists_get` for user enumeration risk

---

## Execution Order

| Phase | Tasks | Rationale |
|-------|-------|-----------|
| **Phase 1 — Stop the bleeding** | Task 1, Task 4, Task 5 | These three together close the primary bypass: backend rejects, frontend sends token, fetch patch attaches it |
| **Phase 2 — Defense-in-depth** | Task 2, Task 3, Task 6 | Protect consume and resend paths |
| **Phase 3 — Validate** | Task 10 | Confirm fix effectiveness via Cloudflare analytics |
| **Phase 4 — Harden** | Task 7, Task 8, Task 9, Task 11 | Hostname validation, logging, rate limiting, full audit |

Tasks within a phase can be parallelized. Phase 1 tasks should ship together in a single deployment — deploying backend without frontend (or vice versa) would cause auth failures for legitimate users.
