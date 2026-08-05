You are investigating a production issue in this codebase: **Cloudflare Turnstile appears correctly integrated in some places, but fake signups are still being accepted**.

Your goal is to perform a **codebase investigation**, not to guess. You must determine whether the problem is caused by:
- missing Turnstile enforcement
- partial enforcement
- bypassable routes
- environment/config issues
- frontend/backend mismatch
- region-specific or deployment-specific gaps
- alternate signup flows not protected by Turnstile
- incorrect server-side verification logic
- missing validation of Turnstile response fields
- logic bugs that accept signup even when Turnstile fails or is absent

## Context

Observed behavior:
- Many fake signups are getting through.
- Cloudflare Turnstile analytics show only about **11 Siteverify requests / 11 valid tokens / 11 solved challenges**.
- This strongly suggests that only a small subset of signup attempts actually reached backend Turnstile verification.
- Therefore, the likely issue is **bypass or enforcement gap**, not simply “Turnstile is too weak”.

## Your task

Audit the codebase and produce a **grounded investigation report**.

Do not stop at “I found the Turnstile component”. You must trace the full flow end to end:
1. frontend rendering
2. token generation
3. request submission
4. backend receipt
5. Siteverify call
6. validation of Siteverify response
7. rejection/acceptance behavior
8. all alternative signup paths

## What to investigate

### 1. Find all signup entry points
Identify every possible signup/account-creation flow, including but not limited to:
- email/password signup
- magic link signup
- invite signup
- OAuth/social signup
- API-based signup
- regional hostnames or environments
- legacy routes
- alternate frontend forms
- mobile/client-specific flows
- admin-created users or internal provisioning paths if they could be abused externally

For each flow, identify:
- frontend page/component
- API endpoint called
- backend handler/service used
- whether Turnstile is present
- whether Turnstile is required server-side

### 2. Find all Turnstile-related code
Search for:
- Turnstile widget/component usage
- Cloudflare site key references
- secret key references
- Siteverify calls
- environment variables
- middleware or helpers
- validation wrappers
- feature flags
- region/env-specific configuration

Determine:
- where Turnstile is rendered
- where Turnstile token is attached to requests
- where the token is verified
- whether verification is centralized or duplicated
- whether some routes skip the shared validation path

### 3. Verify strict backend enforcement
Determine whether the backend rejects signup unless all of the following are true:
- Turnstile token is present
- backend calls Cloudflare Siteverify
- Siteverify returns success = true
- hostname matches expected hostname
- action matches expected action, if used
- token is associated with the expected request flow
- failure to verify causes hard rejection, not soft fallback

Explicitly check for bad patterns such as:
- missing token accepted
- verification errors logged but request still allowed
- timeout/network error treated as allow
- validation only done in frontend
- validation result ignored
- validation result stored but not enforced
- only checking HTTP 200 instead of success field
- checking success but not hostname/action
- optional feature flag defaulting to disabled
- best-effort validation instead of mandatory validation

### 4. Investigate bypasses
Find any way an attacker could create an account without passing through the protected frontend flow, for example:
- direct POST to signup API
- alternate API route
- old versioned route
- internal route exposed publicly
- OAuth callback path creating accounts without equivalent anti-abuse controls
- backend route used by another client that does not require Turnstile
- region-specific route differences between EU and US
- SSR/API route mismatch
- form action posting somewhere unexpected
- route protected in UI but not in backend

### 5. Investigate deployment/config differences
Check whether Turnstile is consistently enabled across:
- production vs staging
- EU vs US
- frontend vs backend environments
- serverless vs long-running services
- different apps or packages in the monorepo

Look for:
- missing env vars
- wrong site key/secret pair
- disabled feature flags
- hostname mismatch
- action mismatch
- secret loaded only in one deployment
- frontend pointing to one backend, backend configured for another hostname
- config drift between regions

### 6. Trace real acceptance logic
Find the exact code path where a signup is finally accepted and user creation occurs.

Answer:
- At what point is the user actually created?
- Does that path depend on successful Turnstile verification?
- Is there any code path where user creation can happen before verification?
- Is verification asynchronous or fire-and-forget?
- Is there retry/fallback logic that accidentally allows the request?

### 7. Assess observability gaps
Check whether the codebase currently logs enough to diagnose this issue.

Identify whether signup attempts log:
- route
- hostname
- region
- token present / absent
- Siteverify called / not called
- Siteverify success / failure
- action
- rejection reason
- acceptance reason

If not, propose the minimum useful logging additions.

## Required output format

Produce a report with these exact sections:

# Turnstile Investigation Report

## 1. Executive summary
A short conclusion of the most likely root cause(s), based only on evidence from the codebase.

## 2. Signup flows inventory
A table with columns:
- Flow
- Frontend entry point
- Backend endpoint
- Turnstile rendered?
- Turnstile verified server-side?
- Protected correctly?
- Notes

## 3. Turnstile implementation map
Describe all relevant files, functions, modules, services, and env vars involved in Turnstile.

## 4. Enforcement findings
List every place where enforcement is:
- correct
- missing
- partial
- ambiguous

For each finding, include:
- severity: critical / high / medium / low
- evidence: specific file(s) and function(s)
- explanation

## 5. Bypass paths
List all plausible ways an attacker could bypass Turnstile, with evidence.

## 6. Config and environment findings
List any region/env/config inconsistencies.

## 7. Acceptance-path trace
Describe the exact path from signup request to account creation, and where Turnstile should block but currently may not.

## 8. Logging and observability gaps
State what is missing and what should be added.

## 9. Most likely root cause
Give the strongest evidence-based conclusion.

## 10. Recommended fixes
Split into:
- immediate fixes
- short-term hardening
- follow-up validation steps

## 11. Evidence appendix
Include file paths, function names, relevant code excerpts, and reasoning.

## Investigation rules

- Do not assume the frontend protection is enough.
- Do not assume that because Turnstile exists, it is enforced.
- Do not stop at finding one route; enumerate all signup routes.
- Do not make claims without code evidence.
- Prefer exact file paths, function names, and request paths.
- Call out ambiguity explicitly when the code is unclear.
- Distinguish between “widget present” and “server-side enforcement”.
- Distinguish between “Siteverify called somewhere” and “signup hard-fails unless Siteverify succeeds”.
- Treat direct API access as the default attacker behavior.
- Be suspicious of optional middleware, feature flags, fallback logic, and legacy routes.

## Practical hints for searching

Search for terms like:
- turnstile
- captcha
- siteverify
- cf-turnstile-response
- cloudflare
- signup
- sign-up
- register
- registration
- create user
- create account
- invite
- oauth
- callback
- auth
- onboarding
- user creation
- feature flag names
- env vars for site key / secret key

## Final objective

At the end of the investigation, I want a concrete answer to this question:

**How can fake signups still be accepted in this codebase despite Turnstile being present, and exactly which code paths/configuration gaps make that possible?**