# Session Model & Multi-Org Identity Accumulation

This document defines how authentication state is represented in sessions and how it interacts with organizations and policies in a multi-tenant environment.

Authentication proves **how** the user authenticated.  
Authorization and organization context determine **what** they can access.

---

## 1. Separation of Concerns

| Concern | Where it lives | Notes |
|--------|----------------|-------|
| Authentication (identity & methods) | SuperTokens session payload | “Who is this user and how did they prove it?” |
| Organization memberships | Application database | “Which orgs does this user belong to in this realm?” |
| Active organization / UI context | Application state (front-end + API) | “Which org am I currently working in?” |

The login system **does not** track the active organization; that is purely app/UI state.

---

## 2. Session Payload Structure

Sessions store **only** what has been explicitly authenticated.

```json
{
  "user_id": "u_12345",
  "identities": [
    "email:otp",
    "social:google",
    "sso:acme"
  ]
}
```

### `identities` rules

- It is a **set of verified methods**, not a log or history.
- Methods are added **only when the user actually completes that flow**.
- Methods are **never added just because the user is entitled to use them**.
- Methods may be removed if:
  - Credentials are revoked,
  - An SSO link is broken,
  - The session is reset or fully logged out.

Examples:

- User logs in with OTP:

  ```json
  { "identities": ["email:otp"] }
  ```

- Later, the same user logs in via Google (same realm):

  ```json
  { "identities": ["email:otp", "social:google"] }
  ```

- Later still, user accesses ACME which requires SSO and completes SSO:

  ```json
  { "identities": ["email:otp", "social:google", "sso:acme"] }
  ```

At no point do we add `sso:acme` **until** the ACME SSO flow has been completed.

---

## 3. Organization Access Using `identities`

Organization policies (from `organization_policies`) define which methods are acceptable.

Conceptually:

```text
allowed = is_policy_satisfied(
    org_policies[organization_id],
    session.identities
)
```

If `allowed` is false when the user tries to access `/o/{org_slug}`:

1. Determine which method is missing (e.g., `sso:acme`),
2. Trigger the corresponding auth flow (OIDC redirect, etc.),
3. On success, append the new method to `identities`,
4. Retry org access.

There is **no extra `requires_strong_reauth` flag** in the session; the need for additional auth is derived **purely** from:

- Org policy, and  
- Current `identities` set.

---

## 4. Multi-Org Behavior

### 4.1 Memberships

Memberships are stored in the DB, e.g.:

```sql
SELECT o.*
FROM organizations o
JOIN organization_memberships m ON m.organization_id = o.id
WHERE m.user_id = :user_id;
```

This returns **all** orgs the user belongs to in the current realm, regardless of how they authenticated.

The API endpoint might be:

```http
GET /api/me/organizations
```

And returns e.g.:

```json
{
  "organizations": [
    { "slug": "acme" },
    { "slug": "devgroup" },
    { "slug": "sandbox" }
  ]
}
```

### 4.2 Active Organization

The active org is **not** stored in the authentication session. It’s handled by the app:

- Selected in the UI,
- Stored in front-end state and/or a cookie / header,
- Sent to the backend (e.g., `X-Org-Id` or via `/o/{slug}` in the path).

Example navigation:

- After login:
  - If one org → redirect to `/o/{org_slug}`.
  - If multiple orgs → show org picker at `/o` and then redirect to `/o/{org_slug}`.

---

## 5. Upgrading Authentication When Switching Orgs

When the user switches to (or attempts to access) a different organization:

1. Backend resolves the target org (e.g. from `/o/{slug}`).
2. Fetch policies for that org.
3. Check whether `session.identities` satisfies the policy.
4. If not satisfied:
   - Determine required method (e.g., `sso:acme`),
   - Trigger that flow (e.g., redirect to OIDC),
   - On success, update `identities` and allow access.

The rule is:

> **Session identities reflect only what the user has actually done, not what they’re allowed to do.**

---

## One-Sentence Summary

> The session holds only the `user_id` and the list of explicitly verified authentication methods (e.g., `email:otp`, `social:google`, `sso:acme`), while organization memberships and active org selection live in the app, and org policies decide when additional methods must be added to `identities` via new authentication flows.
