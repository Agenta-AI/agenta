# Realm Discovery & Login Flow Behaviors

This document defines how login behavior is determined in a multi-tenant, multi-realm architecture.
The flow is driven by three factors:

- The **host** (mapping to `{tier, region, account}` → realm),
- The **email entered during login**, and
- The **organization-level authentication policy**.

---

## 1. Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Host (`tier.region.account.agenta.ai`) | URL | Determines realm (DB) + SuperTokens tenant |
| Email (optional step) | User action | Used to discover organization membership and allowed auth paths |
| Authentication method | User or enforcement | OTP, Social, or SSO (OIDC) |

---

## 2. Landing Experience

The user navigates to a realm-bound URL, e.g.:

```
https://shared.eu.cloud.agenta.ai/
```

The system identifies the **realm** (`(account=cloud, region=eu, tier=shared)`) and loads configuration.

The login page allows (depending on realm policy):

```
------------------------------------
|  Continue with Google             |
|  Continue with GitHub             |
------------------------------------
                OR
 Email:
 [______________] [ Continue ]
```

> `/` is the web UI entry point — no `/app` prefix.

---

## 3. Email-Based Discovery (`POST /auth/discover`)

After the user enters an email and clicks Continue, the frontend calls a **discovery endpoint**:

```http
POST /auth/discover
{
  "email": "user@example.com"
}
```

Backend determines:

- Whether a user with this email exists in this realm,
- Whether the user belongs to 0, 1, or many organizations,
- Which authentication methods are valid based on org policies.

⚠️ This endpoint **must not reveal organization names** to avoid enumeration attacks.

### Response Structure

```json
{
  "exists": true,
  "email": {
    "enabled": true,
    "methods": ["otp", "password"]
  },
  "social": {
    "enabled": true,
    "providers": ["google", "github"]
  },
  "sso": {
    "enabled": false,
    "required": false,
    "providers": []
  }
}
```

### Example: User exists & must use SSO

```json
{
  "exists": true,
  "email": { "enabled": false, "methods": [] },
  "social": { "enabled": false, "providers": [] },
  "sso": {
    "enabled": true,
    "required": true,
    "providers": [
      { "slug": "okta", "name": "Okta", "organization_slug": "acme" }
    ]
  }
}
```

### Example: New user, realm allows OTP signup

```json
{
  "exists": false,
  "email": { "enabled": true, "methods": ["otp"] },
  "social": { "enabled": true, "providers": ["google", "github"] },
  "sso": { "enabled": false, "required": false, "providers": [] }
}
```

### Example: Multiple orgs with different rules

When a user belongs to multiple organizations with varying policies, discovery aggregates the **union** of all allowed methods:

```json
{
  "exists": true,
  "email": { "enabled": true, "methods": ["otp"] },
  "social": { "enabled": true, "providers": ["google"] },
  "sso": {
    "enabled": true,
    "required": false,
    "providers": [
      { "slug": "okta", "name": "Okta", "organization_slug": "acme" }
    ]
  }
}
```

---

## 4. Policy Enforcement

Policies are defined at the **organization level** via `organizations.flags`.

The login method must satisfy the org's allowed methods.

| Flag Configuration | Result |
|-------------------|--------|
| `allow_sso=true`, `allow_email=false`, `allow_social=false` | SSO only |
| `allow_sso=true`, `allow_email=true` | Allow either |
| `allow_social=true`, `allow_email=false` | Only social providers shown |
| `domains_only=true` | Only emails from verified domains allowed |
| `allow_root=true` | Owner bypasses all restrictions |

### Error Responses

| Error Code | Trigger | Frontend Action |
|------------|---------|-----------------|
| `AUTH_UPGRADE_REQUIRED` | Auth method not in allowed list | Redirect to /auth with required methods |
| `AUTH_SSO_DENIED` | SSO disabled or provider inactive | Sign out, redirect to /auth |
| `AUTH_DOMAIN_DENIED` | Email domain not in verified list | Sign out, redirect to /auth |

---

## 5. Authentication Execution Paths

Once method is known:

| Method | Flow |
|--------|------|
| **OTP** | Email → code/link → SuperTokens session created |
| **Social (Google, GitHub, etc.)** | OAuth → callback → session created |
| **SSO (OIDC)** | Redirect → IdP login → subject resolved → session created |

After session creation, the backend:

1. Records the identity in `session.identities` (e.g., `["email:otp"]`)
2. Executes post-auth policies (auto-join if `auto_join=true`)
3. Returns success

---

## 6. Post-Login: Organization Selection

After successful authentication, the frontend calls:

```
GET /api/me/organizations
```

This endpoint returns **all organizations this identity is a member of in this realm**.

Example response:

```json
{
  "organizations": [
    { "id": "uuid-1", "slug": "acme", "name": "ACME Corp" },
    { "id": "uuid-2", "slug": "devgroup", "name": "Dev Group" },
    { "id": "uuid-3", "slug": "sandbox", "name": "Sandbox" }
  ]
}
```

### Routing After Login

- If **one** org → redirect:

  ```
  /o/{org_slug}
  ```

- If **multiple** orgs → show selector:

  ```
  /o
  ```

Selecting an org sets:

```
session.active_org_id = <organization_id>
```

---

## 7. Switching Organizations Later

Users may switch context via UI.

When switching to a different organization:

1. Frontend requests access validation
2. Backend checks `organizations.flags` against `session.identities`
3. If session satisfies policy → switch immediately
4. If not → return appropriate error:

```json
{
  "error": "AUTH_UPGRADE_REQUIRED",
  "message": "Additional authentication required",
  "required_methods": ["sso:*"],
  "sso_providers": [{ "slug": "okta", "name": "Okta" }]
}
```

Or if SSO is disabled/mismatched:

```json
{
  "error": "AUTH_SSO_DENIED",
  "message": "SSO is not enabled for this organization"
}
```

Or if domain restricted:

```json
{
  "error": "AUTH_DOMAIN_DENIED",
  "message": "Your email domain 'gmail.com' is not allowed for this organization"
}
```

After completing required auth, the session gains the new identity and switching completes.

---

## 8. Frontend Error Handling

When receiving auth errors (403 status):

| Error | Frontend Action |
|-------|-----------------|
| `AUTH_UPGRADE_REQUIRED` | Redirect to `/auth?auth_error=upgrade_required&auth_message=...` |
| `AUTH_SSO_DENIED` | Sign out, redirect to `/auth?auth_error=sso_denied&auth_message=...` |
| `AUTH_DOMAIN_DENIED` | Sign out, redirect to `/auth?auth_error=domain_denied&auth_message=...` |

The auth page displays the error message and available authentication options.

---

## One-Sentence Summary

> Realm determines infrastructure scope, email determines organization and auth rules via discovery, the session accumulates identity proofs, and org flags control whether access is allowed — with `AUTH_UPGRADE_REQUIRED`, `AUTH_SSO_DENIED`, and `AUTH_DOMAIN_DENIED` errors guiding users to re-authenticate when policies aren't satisfied.
