# Turnstile Investigation Report

## 1. Executive Summary

**The most likely root cause is that the passwordless (Email OTP) signup flow — which is the active email auth method in production — has zero Turnstile protection.** Neither the frontend nor the backend enforces Turnstile for the OTP flow.

Production runs with `SENDGRID_API_KEY` configured, which causes `email_method` to return `"otp"` instead of `"password"`. This means the email/password recipe (which *is* protected by Turnstile) is **not even initialized**. The passwordless recipe takes its place, and it has no Turnstile checks at any layer.

An attacker can directly `POST /auth/signinup/code` with an email address to trigger OTP creation — no Turnstile token required, no widget rendered, no server-side verification. The ~11 Siteverify calls in Cloudflare analytics likely correspond to the small number of users who signed up via OAuth (third-party flow), which *is* protected.

Additionally, the server-side verification does not validate the `hostname` or `action` fields from the Siteverify response, meaning even for the protected flows, a Turnstile token from any site using the same site key would be accepted.

## 2. Signup Flows Inventory

| Flow | Frontend Entry Point | Backend Endpoint | Turnstile Rendered? | Turnstile Verified Server-Side? | Protected? | Notes |
|------|---------------------|------------------|--------------------|---------------------------------|------------|-------|
| **Email/Password signup** | `web/oss/src/components/pages/auth/EmailPasswordAuth/index.tsx` | `POST /auth/signup` (SuperTokens) | Yes | Yes (`sign_up_post` override) | Yes | **NOT initialized in production** — SendGrid present → `email_method="otp"` |
| **Email/Password signin** | `web/oss/src/components/pages/auth/EmailPasswordSignIn/index.tsx` | `POST /auth/signin` (SuperTokens) | Yes | Yes (`sign_in_post` override) | Yes | Same — not active in production |
| **Email OTP — create code** | `web/oss/src/components/pages/auth/PasswordlessAuth/index.tsx` | `POST /auth/signinup/code` (SuperTokens) | **No** | **No** — `create_code_post` not overridden | **NO** | **CRITICAL: Active in production, completely unprotected** |
| **Email OTP — consume code** | `web/oss/src/components/pages/auth/SendOTP/index.tsx` | `POST /auth/signinup/code/consume` (SuperTokens) | **No** | **No** — `consume_code_post` override exists but has no Turnstile call | **NO** | OTP itself is a factor, but create_code is the abuse vector |
| **Email OTP — resend code** | (implicit in SendOTP) | `POST /auth/signinup/code/resend` (SuperTokens) | **No** | **No** — `resend_code_post` not overridden at all | **NO** | Additional abuse vector |
| **OAuth/Social signup** | `web/oss/src/pages/auth/callback/[[...callback]].tsx` | `POST /auth/signinup` (SuperTokens thirdparty) | Yes (modal overlay) | Yes (`thirdparty_sign_in_up_post` override) | Yes | Working correctly |
| **SSO/OIDC** | SSO redirect → callback | `GET /auth/sso/callback/{org}/{provider}` → thirdparty | Yes (via callback) | Yes (via thirdparty override) | Yes | EE only |
| **Auth discover** | Auth page | `POST /auth/discover` | No | No | N/A | Read-only, no account creation |

## 3. Turnstile Implementation Map

### Backend

| File | Role | Key Functions |
|------|------|--------------|
| `api/oss/src/core/auth/turnstile.py` | Core verification | `is_turnstile_enabled()`, `verify_turnstile_or_raise()` |
| `api/oss/src/core/auth/supertokens/overrides.py` | Integration points | `verify_turnstile()` wrapper (L361-370), called in emailpassword + thirdparty API overrides |
| `api/oss/src/utils/env.py` L111-112, L254-256 | Configuration | `turnstile_site_key`, `turnstile_secret_key`, `turnstile_enabled` property |

### Frontend

| File | Role |
|------|------|
| `web/oss/src/lib/helpers/auth/turnstile.ts` | Token management, fetch patching. `TURNSTILE_AUTH_PATHS` = `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signinup` |
| `web/oss/src/components/pages/auth/Turnstile/index.tsx` | Widget component |
| `web/oss/src/components/pages/auth/EmailPasswordAuth/index.tsx` | Renders widget, validates token before submit |
| `web/oss/src/components/pages/auth/EmailPasswordSignIn/index.tsx` | Renders widget, validates token before submit |
| `web/oss/src/pages/auth/callback/[[...callback]].tsx` | Renders widget overlay for OAuth callback |
| `web/oss/src/lib/helpers/auth/AuthProvider.tsx` | Installs fetch patch at init |

### Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CLOUDFLARE_TURNSTILE_SITE_KEY` | Backend + entrypoint.sh | Public key |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Backend only | Secret for Siteverify |
| `NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY` | Frontend (injected at runtime via `__env.js`) | Widget rendering |
| `AGENTA_LICENSE` | Both | Must be `"ee"` for Turnstile to be enabled |

### Enabling Conditions
- Backend: `is_ee() and bool(site_key and secret_key)` — all three must be true
- Frontend: `isEE() and bool(site_key)` — EE license + site key present
- Entrypoint.sh: Explicit check for `AGENTA_LICENSE = "ee"` AND both keys

## 4. Enforcement Findings

### CRITICAL — Passwordless `create_code_post` not overridden

- **Severity**: Critical
- **Evidence**: `api/oss/src/core/auth/supertokens/overrides.py:470-502` — `override_passwordless_apis()` only overrides `consume_code_post`. SuperTokens' `APIInterface` exposes `create_code_post`, `resend_code_post`, and `consume_code_post` — the first two are left at their defaults with no Turnstile.
- **Explanation**: The `create_code_post` endpoint (`POST /auth/signinup/code`) accepts an email and sends an OTP. No Turnstile token is required. This is the primary abuse vector — an attacker can spray this endpoint with arbitrary emails to create accounts.

### CRITICAL — Passwordless is the active production auth method

- **Severity**: Critical
- **Evidence**: `api/oss/src/utils/env.py:126-134` — `email_method` returns `"otp"` when SendGrid is configured. `hosting/docker-compose/ee/.env.cloud.demo:102-103` confirms SendGrid is set in the production-like env.
- **Explanation**: The email/password recipe (which has Turnstile) is **never initialized** in production. Only the passwordless recipe is loaded, and it has no Turnstile.

### CRITICAL — Frontend does not render Turnstile for OTP flow

- **Severity**: Critical
- **Evidence**: `web/oss/src/components/pages/auth/PasswordlessAuth/index.tsx` — no import of `TurnstileWidget`, no `isTurnstileEnabled()`, no `setPendingTurnstileToken()`. Compare with `web/oss/src/components/pages/auth/EmailPasswordAuth/index.tsx` which has all of these.
- **Explanation**: Even if backend were fixed, the frontend wouldn't send a token for the OTP flow.

### CRITICAL — Frontend fetch patch doesn't cover OTP paths

- **Severity**: Critical
- **Evidence**: `web/oss/src/lib/helpers/auth/turnstile.ts:4` — `TURNSTILE_AUTH_PATHS` only includes `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signinup`. Missing: `/api/auth/signinup/code` and `/api/auth/signinup/code/consume`.
- **Explanation**: Even if a pending Turnstile token existed, the fetch patch would not attach it to OTP requests.

### HIGH — No hostname/action validation in Siteverify response

- **Severity**: High
- **Evidence**: `api/oss/src/core/auth/turnstile.py:56-57` — only checks `success is True`. The `hostname` and `action` fields from the response are logged on failure (L61-63) but never validated on success.
- **Explanation**: A valid Turnstile token from any site using the same site key would be accepted. This is a secondary concern since the primary bypass doesn't need a token at all.

### LOW — `resend_code_post` not overridden

- **Severity**: Low (secondary to create_code_post)
- **Evidence**: `override_passwordless_apis()` doesn't override `resend_code_post` at all.
- **Explanation**: Allows resending OTPs without Turnstile. Lower severity since `create_code_post` is the primary abuse vector.

### CORRECT — Email/Password flows

- **Evidence**: `api/oss/src/core/auth/supertokens/overrides.py:380` and `overrides.py:420`
- Both `sign_in_post` and `sign_up_post` call `verify_turnstile()` before proceeding.

### CORRECT — Third-party OAuth flow

- **Evidence**: `api/oss/src/core/auth/supertokens/overrides.py:520`
- `thirdparty_sign_in_up_post` calls `verify_turnstile_or_raise()`.

## 5. Bypass Paths

| # | Bypass | Difficulty | Evidence |
|---|--------|-----------|----------|
| 1 | **Direct POST to `/auth/signinup/code`** with any email | Trivial (curl) | No `create_code_post` override, no Turnstile anywhere in path |
| 2 | **Direct POST to `/auth/signinup/code/consume`** with valid OTP | Trivial (after #1) | `consume_code_post` override has no Turnstile call |
| 3 | **Direct POST to `/auth/signinup/code/resend`** | Trivial | Not overridden at all |
| 4 | Hostname mismatch token reuse on protected flows | Medium | No hostname validation in Siteverify response |

## 6. Config and Environment Findings

| Finding | Details |
|---------|---------|
| Production uses OTP, not password | SendGrid configured → `email_method="otp"` → email/password recipe not initialized → its Turnstile protection irrelevant |
| Turnstile enabled in production | `.env.cloud.demo` has real Turnstile keys and `AGENTA_LICENSE=ee` |
| No region-specific config gaps | Same Turnstile keys used across all deployments |
| OSS mode has no Turnstile | By design — `is_ee()` gate. Not a bug. |

## 7. Acceptance-Path Trace

**The actual production signup path (OTP):**

1. User enters email on `/auth` page
2. Frontend calls `createCode({email})` → SuperTokens SDK → `POST /auth/signinup/code`
3. SuperTokens middleware receives request → calls `create_code_post` (DEFAULT implementation, no override)
4. **No Turnstile token checked. No Turnstile token even sent by frontend.**
5. OTP sent to email via SendGrid
6. User enters OTP → `consumeCode()` → `POST /auth/signinup/code/consume`
7. `consume_code_post` override runs — **no Turnstile check** — calls original implementation
8. SuperTokens creates user → `override_passwordless_functions.consume_code` → calls `_create_account()`
9. Account created

**The attacker path is identical but automated**: A script can POST to `/auth/signinup/code` with disposable email addresses. No Turnstile, no CAPTCHA, no rate-limiting at the application layer.

## 8. Logging and Observability Gaps

### Currently logged
- Turnstile verification failures: error codes, hostname, action (`api/oss/src/core/auth/turnstile.py:59-64`)
- Account creation: email, uid (`api/oss/src/core/auth/supertokens/overrides.py:150`)

### Missing
- **No log when Turnstile is skipped** because `is_turnstile_enabled()` returns False
- **No log when Turnstile is skipped** because the flow doesn't call `verify_turnstile_or_raise` at all (passwordless)
- **No log of which auth recipe handled the request** (password vs OTP vs thirdparty)
- No log of `create_code_post` calls (email, IP, user-agent)
- No metrics on OTP creation rate per IP or email domain
- No structured log tying Siteverify result to the specific signup attempt

### Recommended additions
- Log at `verify_turnstile_or_raise` entry when Turnstile is disabled (with reason: "not EE" vs "keys missing")
- Log at each recipe's API override entry point with auth method identifier
- Log `create_code_post` calls with email domain and client IP
- Add rate metrics for OTP creation per IP

## 9. Most Likely Root Cause

**The passwordless (OTP) signup flow is the production email auth method, and it has zero Turnstile protection — no frontend widget, no token attachment, no backend verification.**

The evidence is unambiguous:
1. Production has SendGrid → `email_method = "otp"` → email/password recipe not initialized
2. `override_passwordless_apis()` doesn't override `create_code_post` (the endpoint that initiates signup)
3. `consume_code_post` is overridden but has no Turnstile call
4. `resend_code_post` is not overridden at all
5. Frontend `PasswordlessAuth` component has no `TurnstileWidget`
6. Frontend `TURNSTILE_AUTH_PATHS` doesn't include `/api/auth/signinup/code`

The Cloudflare dashboard showing ~11 Siteverify requests aligns perfectly: those ~11 are likely OAuth/social signups going through `thirdparty_sign_in_up_post`, which *is* protected.

## 10. Recommended Fixes

### Immediate Fixes

1. **Override `create_code_post` in `override_passwordless_apis()`** and call `verify_turnstile_or_raise(request=api_options.request)` before calling the original implementation. This is the highest-impact single fix.

2. **Add Turnstile call to `consume_code_post`** override for defense-in-depth.

3. **Override `resend_code_post`** and add Turnstile verification there too.

4. **Add `TurnstileWidget` to `PasswordlessAuth` component** and wire up `setPendingTurnstileToken()` before calling `createCode()`.

5. **Add `/api/auth/signinup/code` and `/api/auth/signinup/code/consume`** to `TURNSTILE_AUTH_PATHS` in `web/oss/src/lib/helpers/auth/turnstile.ts:4`.

### Short-Term Hardening

6. **Validate `hostname`** in the Siteverify response against expected production domains (`api/oss/src/core/auth/turnstile.py:56`).

7. **Add rate limiting** on `create_code_post` per IP (independent of Turnstile, as defense-in-depth).

8. **Add structured logging** for all signup attempts with auth method, IP, email domain, and Turnstile status.

### Follow-Up Validation

9. After deploying fixes, monitor Cloudflare Turnstile analytics — Siteverify call count should increase dramatically to match total signup volume.

10. Audit SuperTokens `APIInterface` for any other unoverridden methods that could be abused (`email_exists_get`, `phone_number_exists_get`).

## 11. Evidence Appendix

### Key code excerpts

**Production uses OTP** — `api/oss/src/utils/env.py:126-134`:
```python
sendgrid_enabled = bool(
    os.getenv("SENDGRID_API_KEY")
    and (os.getenv("SENDGRID_FROM_ADDRESS") or ...)
)
return "otp" if sendgrid_enabled else "password"
```

**OTP recipe init (no Turnstile in override)** — `api/oss/src/core/auth/supertokens/config.py:312-324`:
```python
if env.auth.email_method == "otp":
    recipe_list.append(
        passwordless.init(
            flow_type="USER_INPUT_CODE",
            contact_config=ContactEmailOnlyConfig(),
            override=PasswordlessInputOverrideConfig(
                apis=override_passwordless_apis,        # ← no create_code_post override
                functions=override_passwordless_functions,
            ),
        )
    )
```

**Passwordless API override — missing `create_code_post`** — `api/oss/src/core/auth/supertokens/overrides.py:470-502`:
```python
def override_passwordless_apis(original_implementation):
    original_consume_code_post = original_implementation.consume_code_post
    # ← create_code_post NOT overridden
    # ← resend_code_post NOT overridden

    async def consume_code_post(...):
        # ← NO verify_turnstile_or_raise() call
        response = await original_consume_code_post(...)
        return response

    original_implementation.consume_code_post = consume_code_post
    return original_implementation
```

**Frontend OTP component — no Turnstile widget** — `web/oss/src/components/pages/auth/PasswordlessAuth/index.tsx`:
```tsx
// No import of TurnstileWidget, isTurnstileEnabled, setPendingTurnstileToken
const sendOTP = async (values) => {
    const response = await createCode({email: values.email})  // ← no token
    ...
}
```

**Frontend fetch patch — OTP paths not included** — `web/oss/src/lib/helpers/auth/turnstile.ts:4`:
```typescript
const TURNSTILE_AUTH_PATHS = new Set([
    "/api/auth/signin",
    "/api/auth/signup",
    "/api/auth/signinup"
    // Missing: "/api/auth/signinup/code", "/api/auth/signinup/code/consume"
])
```

**SuperTokens passwordless APIInterface methods** (confirmed via runtime inspection):
```
['consume_code_post', 'create_code_post', 'email_exists_get', 'phone_number_exists_get', 'resend_code_post']
```
