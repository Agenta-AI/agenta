# SSO Providers & Configuration

This document describes SSO provider configuration, lifecycle, and enforcement.

For organization flags, see [auth.flags.specs.md](auth.flags.specs.md).
For domain verification, see [auth.domains.specs.md](auth.domains.specs.md).

---

## 1. Overview

Organizations progress through a predictable SSO evolution:

| Phase | Description |
|-------|------------|
| **0 — No SSO** | Users authenticate through OTP or social login |
| **1 — SSO Configured** | SSO is available but optional |
| **2 — Gradual Adoption** | UI encourages SSO usage |
| **3 — SSO Required** | Organization policy enforces SSO-only access |
| **4 — Rotation/Change** | Provider can be disabled, rotated, or replaced |

---

## 2. Schema

### `organization_providers`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `organization_id` | UUID FK | Owning organization |
| `slug` | TEXT | Unique identifier per org (e.g., `okta`) |
| `name` | TEXT | User-facing label |
| `type` | TEXT | Provider type (e.g., `oidc`) |
| `flags` | JSONB | Contains `is_active`, `is_valid` |
| `secret_id` | UUID FK | Encrypted configuration in `secrets` table |
| `created_by_id` | UUID FK | User who created |
| `updated_by_id` | UUID FK | User who last updated |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### Provider Flags

| Flag | Type | Purpose |
|------|------|---------|
| `is_active` | boolean | Provider is enabled for use |
| `is_valid` | boolean | Configuration has been tested successfully |

### Secrets

Provider configuration (issuer URL, client ID, client secret, scopes) is stored encrypted via `secret_id`. The application treats this as an opaque reference.

---

## 3. Lifecycle

### Phase 0 — No SSO (Default)

- `organization_providers` empty
- `allow_sso=false` in org flags
- Users authenticate with email/social

### Phase 1 — SSO Configured

1. Admin creates provider:

```http
POST /api/organizations/{org_id}/security/providers
{
  "slug": "okta",
  "name": "Okta",
  "type": "oidc",
  "config": {
    "issuer_url": "https://acme.okta.com",
    "client_id": "abc123",
    "client_secret": "secret",
    "scopes": ["openid", "email", "profile"]
  }
}
```

2. Test provider connection:

```http
POST /api/organizations/{org_id}/security/providers/{id}/test
```

If successful, sets `is_valid=true`. If failed, sets `is_valid=false`, `is_active=false`.

3. Enable provider (set `is_active=true`)

4. Enable SSO in org flags: `allow_sso=true`

### Phase 2 — Gradual Adoption

- No flag changes required
- UI prioritizes SSO option
- Discovery may recommend SSO based on email domain

### Phase 3 — SSO Required

Admin updates org flags:

```json
{
  "allow_email": false,
  "allow_social": false,
  "allow_sso": true,
  "allow_root": true
}
```

> **Important:** Enable `allow_root` to prevent owner lockout.

### Phase 4 — Rotation/Replacement

- Disable provider: `is_active=false`
- Update secrets (credential rotation)
- Replace configuration
- Revert to earlier policy if needed

---

## 4. Authentication Flow

### Session Identity Format

SSO identities are stored as:

```
sso:{org_slug}:{provider_slug}
```

Example: `sso:acme:okta`

### OIDC Flow

1. User selects SSO provider
2. Redirect to IdP (e.g., Okta)
3. User authenticates at IdP
4. IdP redirects back with authorization code
5. Backend exchanges code for tokens
6. Backend validates tokens, extracts subject
7. Session updated with `sso:acme:okta` identity

---

## 5. Enforcement

### Checking SSO Access

```python
if allow_sso and "sso:*" in session.identities:
    # User has valid SSO identity
    pass
elif not allow_sso and identity.startswith("sso:"):
    # SSO used but not allowed for this org
    return AUTH_SSO_DENIED
```

### Provider Validation

When user authenticates via SSO:

1. Extract org slug and provider slug from identity
2. Check provider exists and `is_active=true`
3. If provider inactive → `AUTH_SSO_DENIED`

### Error Responses

| Error | Condition |
|-------|-----------|
| `AUTH_UPGRADE_REQUIRED` | SSO required but session lacks SSO identity |
| `AUTH_SSO_DENIED` | SSO disabled, provider inactive, or provider mismatched |

---

## 6. Safety Mechanisms

### Provider Modification Guard

When modifying SSO providers, if SSO is the only allowed method:

```python
if not allow_email and not allow_social and not allow_root:
    return Error("Enable email, social, or root access before modifying providers")
```

This prevents accidental lockout.

### SSO Validation

Cannot enable `allow_sso=true` without at least one provider where:
- `is_active=true`
- `is_valid=true`

### Lockout Prevention

When all auth methods disabled, system auto-enables `allow_root=true`:
- Organization owner retains access
- Can reconfigure SSO or re-enable other methods

---

## 7. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/security/providers` | Create SSO provider |
| `GET` | `/security/providers` | List all providers |
| `PATCH` | `/security/providers/{id}` | Update provider |
| `POST` | `/security/providers/{id}/test` | Test provider connection |
| `DELETE` | `/security/providers/{id}` | Delete provider |

---

## 8. Discovery Integration

When a user enters their email, discovery checks:

1. Does user belong to org with `allow_sso=true`?
2. Does user's email domain match org's verified domain?
3. Is there an active SSO provider?

If all true, SSO may be required or recommended:

```json
{
  "sso": {
    "enabled": true,
    "required": true,
    "providers": [
      { "slug": "okta", "name": "Okta", "organization_slug": "acme" }
    ]
  }
}
```

---

## One-Sentence Summary

> SSO providers are configured per-organization with encrypted secrets, tested before activation, and enforced via org flags — with `allow_root` ensuring owner access when SSO is the only method.
