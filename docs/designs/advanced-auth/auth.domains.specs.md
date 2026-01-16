# Domain Verification & Governance

This document describes domain verification, its purpose, implementation, and relationship to organization governance.

---

## 1. Overview

**Domain verification answers:**

> *Which organization is allowed to define policies for identities from a given email domain?*

Domain verification:
- Is a **governance mechanism**, not authentication
- Establishes **authority** over a domain
- Enables `domains_only` and `auto_join` flags
- Applies only to **collaborative organizations** (not personal)

---

## 2. Schema

### `organization_domains`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Identifier |
| `organization_id` | UUID FK | Owning organization |
| `slug` | TEXT | Domain name (e.g., `acme.com`) |
| `name` | TEXT | Optional display name |
| `description` | TEXT | Optional description |
| `token` | TEXT | DNS TXT verification token |
| `flags` | JSONB | Contains `is_verified` boolean |
| `created_by_id` | UUID FK | User who created |
| `updated_by_id` | UUID FK | User who last updated |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Constraint:** `UNIQUE (slug)` — a domain can only be verified by one organization globally.

---

## 3. Verification Process

### 3.1 Create Domain

```http
POST /api/organizations/{org_id}/security/domains
{
  "slug": "acme.com",
  "name": "ACME Corporation"
}
```

Response includes a verification token:

```json
{
  "id": "uuid",
  "slug": "acme.com",
  "token": "agenta-verify=abc123xyz",
  "flags": { "is_verified": false }
}
```

### 3.2 Add DNS TXT Record

The organization must add a TXT record to their DNS:

```
_agenta-verification.acme.com TXT "agenta-verify=abc123xyz"
```

### 3.3 Verify Domain

```http
POST /api/organizations/{org_id}/security/domains/verify
{
  "domain_id": "uuid"
}
```

Backend performs DNS lookup to confirm the TXT record exists. If found:

```json
{
  "id": "uuid",
  "slug": "acme.com",
  "flags": { "is_verified": true }
}
```

### 3.4 Token Refresh

If verification fails or token expires, generate a new token:

```http
POST /api/organizations/{org_id}/security/domains/{domain_id}/refresh
```

### 3.5 Reset Verified Domain

To re-verify an already verified domain:

```http
POST /api/organizations/{org_id}/security/domains/{domain_id}/reset
```

This generates a new token and sets `is_verified=false`.

---

## 4. Authority Model

### Core Rule

> A domain may be verified by **exactly one collaborative organization at a time**.

### What Verification Grants

- Right to define **domain-scoped policies**
- Right to use `domains_only=true` (restrict access to verified domains)
- Right to use `auto_join=true` (auto-add users with matching domain)
- Right to represent the domain organizationally

### What Verification Does NOT Grant

- Authentication — users still need to prove identity
- Automatic user migration — existing users stay where they are
- Control over other organizations — they remain functional

---

## 5. Governance Scenarios

### 5.1 Multiple Orgs, No Verification

- Alice (`alice@acme.com`) creates `Acme Research`
- Bob (`bob@acme.com`) creates `Acme ML`
- Neither verifies `acme.com`

**Outcome:**
- Both orgs coexist
- No auto-join
- No domain restrictions
- Manual invitations only

### 5.2 One Org Verifies Domain

- Alice verifies `acme.com` for `Acme Research`

**Outcome:**
- `Acme Research` becomes authoritative for `@acme.com`
- `Acme ML` cannot verify `acme.com`
- `Acme ML` continues to function with manual invitations

### 5.3 Multiple Domains Per Org

Organizations may verify multiple domains:

```
acme.com
acme.co
subsidiary.com
```

Each domain:
- Has its own verification token
- Must be verified independently
- Enables auto-join for that specific domain

---

## 6. Integration with Flags

### `domains_only` Flag

When `domains_only=true`:

1. **Invitations** — Only emails with verified domains can be invited
2. **Access** — Only users with verified domain emails can access
3. **Error** — Non-verified domain users receive `AUTH_DOMAIN_DENIED`

```python
if domains_only:
    user_domain = user.email.split("@")[-1]
    if user_domain not in verified_domains:
        return AUTH_DOMAIN_DENIED
```

### `auto_join` Flag

When `auto_join=true`:

1. User logs in with email matching verified domain
2. System checks if user is already a member
3. If not, automatically adds user with "member" role

```python
if auto_join:
    user_domain = user.email.split("@")[-1]
    if user_domain in verified_domains:
        if user not in organization.members:
            add_member(user, role="member")
```

---

## 7. Personal vs Collaborative Organizations

| Organization Type | Domain Verification |
|-------------------|---------------------|
| Personal (`is_personal=true`) | ❌ Not allowed |
| Collaborative (`is_personal=false`) | ✅ Allowed |

**Why personal orgs cannot verify domains:**
- Personal orgs represent individuals, not organizations
- Allowing verification would create false authority
- No governance scope exists for personal orgs

---

## 8. Edge Cases

### Domain Already Verified by Another Org

```http
POST /api/organizations/{org_id}/security/domains
{ "slug": "acme.com" }
```

Response:
```json
{
  "error": "Domain 'acme.com' is already verified by another organization"
}
```

### No Verified Domains When `domains_only=true`

If `domains_only=true` but no verified domains exist:
- All invitations are blocked
- Returns error: "Cannot send invitations: domains_only is enabled but no verified domains exist"

### User Joined Before `domains_only` Enabled

When `domains_only` is enabled after users have joined:
- Existing members with non-verified domains are blocked on next access
- They receive `AUTH_DOMAIN_DENIED` error
- No automatic removal — just access denial

---

## 9. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/security/domains` | Create domain for verification |
| `GET` | `/security/domains` | List all domains |
| `POST` | `/security/domains/verify` | Verify domain via DNS |
| `POST` | `/security/domains/{id}/refresh` | Refresh verification token |
| `POST` | `/security/domains/{id}/reset` | Reset verified domain |
| `DELETE` | `/security/domains/{id}` | Delete domain |

---

## One-Sentence Summary

> Domain verification establishes organizational authority over an email domain, enabling `domains_only` access restrictions and `auto_join` membership, with each domain verifiable by exactly one collaborative organization via DNS TXT record.
