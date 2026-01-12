# Organization Flags: Rules, Conditions, and Enforcement

This document provides a comprehensive reference for all organization flags, their purpose, enforcement logic, and practical examples. Organization flags control authentication policies, access restrictions, and automatic membership behaviors at the organization level.

---

## 1. Flag Overview

| Flag | Default | Category | Purpose |
|------|---------|----------|---------|
| `is_personal` | `false` | Identity | Marks org as personal/single-user |
| `is_demo` | `false` | Identity | Marks org as demo organization |
| `allow_email` | `env.auth.email_enabled` | Authentication | Allow email/password or OTP |
| `allow_social` | `env.auth.oidc_enabled` | Authentication | Allow social providers (Google, GitHub) |
| `allow_sso` | `false` | Authentication | Allow enterprise SSO/OIDC |
| `allow_root` | `false` | Authentication | Owner bypasses auth restrictions |
| `domains_only` | `false` | Access Control | Restrict to verified email domains |
| `auto_join` | `false` | Access Control | Auto-add users with verified domains |

---

## 2. Identity Flags

### 2.1 `is_personal`

**Purpose:** Marks the organization as a personal, single-user workspace.

**Behavior:**
- Personal organizations cannot configure security settings
- All security-related UI is hidden
- Cannot add members or send invitations

**Example:**
```
User signs up → Personal org created with is_personal=true
User cannot access: Verified Domains, SSO Providers, Access Controls
```

---

### 2.2 `is_demo`

**Purpose:** Marks the organization as a demo/trial organization.

**Behavior:**
- Used for onboarding and trial experiences
- May have limited features or time restrictions

---

## 3. Authentication Method Flags

These flags control which authentication methods are allowed for accessing the organization.

### 3.1 `allow_email`

**Purpose:** Allow email-based authentication (password or OTP).

**Default:** Inherited from `env.auth.email_enabled`

**Enforcement Points:**

1. **Discovery Phase** - Determines available auth methods shown to user
2. **Authorization Phase** - Validates user's session identity includes `email:*`

**Example Scenarios:**

| `allow_email` | User Auth Method | Result |
|---------------|------------------|--------|
| `true` | Email/OTP | Allowed |
| `true` | Google | Depends on `allow_social` |
| `false` | Email/OTP | Denied (AUTH_UPGRADE_REQUIRED) |

---

### 3.2 `allow_social`

**Purpose:** Allow social authentication providers (Google, GitHub, etc.).

**Default:** Inherited from `env.auth.oidc_enabled`

**Enforcement Points:**

1. **Discovery Phase** - Shows/hides social provider buttons
2. **Authorization Phase** - Validates session identity includes `social:*`

**Example Scenarios:**

| `allow_social` | User Auth Method | Result |
|----------------|------------------|--------|
| `true` | Google | Allowed |
| `true` | GitHub | Allowed |
| `false` | Google | Denied (AUTH_UPGRADE_REQUIRED) |

---

### 3.3 `allow_sso`

**Purpose:** Allow enterprise SSO/OIDC authentication.

**Default:** `false`

**Prerequisites:**
- At least one SSO provider configured
- Provider must be `is_active=true` and `is_valid=true`

**Enforcement Points:**

1. **Discovery Phase** - Returns SSO provider options if available
2. **Authorization Phase** - Validates session identity matches `sso:{org}:{provider}`
3. **Flag Update** - Cannot enable without valid SSO provider

**Example Scenarios:**

| `allow_sso` | SSO Provider Status | User Auth | Result |
|-------------|---------------------|-----------|--------|
| `true` | Active + Valid | SSO | Allowed |
| `true` | Active + Valid | Email | Depends on `allow_email` |
| `true` | Inactive | SSO | Denied (AUTH_SSO_DENIED) |
| `false` | Any | SSO | Denied (AUTH_SSO_DENIED) |

**SSO Enforcement Rule:**
When an organization has:
- A verified domain matching user's email domain
- An active SSO provider

Then SSO becomes the **only** allowed method for that user (email and social are disabled).

---

### 3.4 `allow_root`

**Purpose:** Allow organization owner to bypass all authentication restrictions.

**Default:** `false`

**Behavior:**
- When `true`, organization owners skip all policy checks
- Automatically enabled if all auth methods are disabled (lockout prevention)

**Enforcement Point:**
```
check_organization_access():
  if is_owner AND allow_root:
    return None  # Bypass all checks
```

**Safety Mechanism:**
```
If allow_email=false AND allow_social=false AND allow_sso=false:
  → System automatically sets allow_root=true
  → Prevents organization lockout
```

**Example:**

| Owner | `allow_root` | All Auth Disabled | Can Access |
|-------|--------------|-------------------|------------|
| Yes | `true` | Yes | Yes (bypass) |
| Yes | `false` | Yes | No |
| No | `true` | Yes | No |
| No | `false` | No | Depends on auth method |

---

## 4. Access Control Flags

### 4.1 `domains_only`

**Purpose:** Restrict organization access to users with verified email domains only.

**Default:** `false`

**Enforcement Points:**

1. **Invitation Validation** - Blocks invitations to non-verified domains
2. **Access Control** - Denies access if user's domain not verified

**Invitation Enforcement:**

```python
if domains_only:
    email_domain = invited_email.split("@")[-1]
    if email_domain not in verified_domains:
        return Error("Cannot invite: domain not verified")
```

**Access Enforcement:**

```python
if domains_only:
    user_domain = user.email.split("@")[-1]
    if user_domain not in verified_domains:
        return AUTH_DOMAIN_DENIED
```

**Example Scenarios:**

| `domains_only` | Verified Domains | User Email | Result |
|----------------|------------------|------------|--------|
| `false` | `["acme.com"]` | `user@gmail.com` | Allowed |
| `true` | `["acme.com"]` | `user@acme.com` | Allowed |
| `true` | `["acme.com"]` | `user@gmail.com` | Denied (AUTH_DOMAIN_DENIED) |
| `true` | `[]` (none) | Any | All invitations blocked |

**Important:** When `domains_only` is enabled after users have already joined:
- Existing members with non-verified domains are **blocked** on next access
- They receive `AUTH_DOMAIN_DENIED` error
- They must re-authenticate with a verified domain email

---

### 4.2 `auto_join`

**Purpose:** Automatically add users to the organization if their email domain is verified.

**Default:** `false`

**Enforcement Point:** Post-authentication (after successful login)

```python
if auto_join:
    user_domain = user.email.split("@")[-1]
    if user_domain in verified_domains:
        if user not in organization.members:
            add_user_to_organization(user, role="member")
```

**Example Scenarios:**

| `auto_join` | Verified Domains | User Email | Existing Member | Result |
|-------------|------------------|------------|-----------------|--------|
| `true` | `["acme.com"]` | `user@acme.com` | No | Auto-added as member |
| `true` | `["acme.com"]` | `user@acme.com` | Yes | No action |
| `true` | `["acme.com"]` | `user@gmail.com` | No | Not added |
| `false` | `["acme.com"]` | `user@acme.com` | No | Not added |

---

## 5. Flag Combinations and Interactions

### 5.1 SSO-Only Organization

**Configuration:**
```json
{
  "allow_email": false,
  "allow_social": false,
  "allow_sso": true,
  "allow_root": true
}
```

**Behavior:**
- Regular users must authenticate via SSO
- Organization owner can still access (via `allow_root`)
- Prevents lockout while enforcing SSO for team

---

### 5.2 Domain-Restricted Organization

**Configuration:**
```json
{
  "allow_email": true,
  "allow_social": true,
  "domains_only": true
}
```

**Verified Domains:** `["acme.com", "acme.io"]`

**Behavior:**
- Users can authenticate with any method (email, social)
- Only users with `@acme.com` or `@acme.io` emails can access
- Invitations to other domains are blocked

---

### 5.3 Auto-Join Corporate Organization

**Configuration:**
```json
{
  "allow_email": true,
  "allow_social": true,
  "auto_join": true,
  "domains_only": false
}
```

**Verified Domains:** `["bigcorp.com"]`

**Behavior:**
- Any `@bigcorp.com` user who logs in is automatically added
- External users (e.g., contractors) can still be invited manually
- External users with non-verified domains can access (since `domains_only=false`)

---

### 5.4 Fully Locked Down Enterprise

**Configuration:**
```json
{
  "allow_email": false,
  "allow_social": false,
  "allow_sso": true,
  "allow_root": true,
  "domains_only": true,
  "auto_join": true
}
```

**Verified Domains:** `["enterprise.com"]`

**Behavior:**
- Only SSO authentication allowed
- Only `@enterprise.com` users can access
- New `@enterprise.com` employees auto-join on first login
- Owner retains emergency access via `allow_root`

---

## 6. Error Responses

| Error Code | Trigger | User Action |
|------------|---------|-------------|
| `AUTH_UPGRADE_REQUIRED` | Auth method not allowed | Re-authenticate with allowed method |
| `AUTH_SSO_DENIED` | SSO disabled or provider inactive | Contact admin or use different method |
| `AUTH_DOMAIN_DENIED` | Email domain not in verified list | Contact admin or use verified domain email |

---

## 7. Frontend Behavior

### 7.1 Error Handling Flow

```
API returns 403 with error code
    │
    ├─ AUTH_UPGRADE_REQUIRED
    │   └─ Redirect to /auth with required methods
    │
    ├─ AUTH_SSO_DENIED
    │   └─ Sign out user
    │   └─ Redirect to /auth with message
    │
    └─ AUTH_DOMAIN_DENIED
        └─ Sign out user
        └─ Redirect to /auth with domain message
```

### 7.2 Organization Settings UI

| Flag | UI Label | Notes |
|------|----------|-------|
| `allow_email` | "Email authentication" | Toggle |
| `allow_social` | "Social authentication" | Toggle |
| `allow_sso` | "SSO authentication" | Toggle (requires provider) |
| `allow_root` | "Owner bypasses authentication controls" | Toggle |
| `domains_only` | "Restrict to verified domains" | Toggle |
| `auto_join` | "Auto-join from verified domains" | Toggle |

**Confirmation Dialog:** Shown when disabling all auth methods, warning that `allow_root` will be auto-enabled.

---

## 8. Safety Mechanisms

### 8.1 Lockout Prevention

**Rule:** Cannot disable all authentication methods without owner bypass.

```
If attempting to set:
  allow_email=false AND allow_social=false AND allow_sso=false

Then:
  → Automatically enable allow_root=true
  → Show warning to user
```

### 8.2 SSO Provider Validation

**Rule:** Cannot enable `allow_sso` without valid provider.

```
If attempting to set allow_sso=true:
  If no providers with is_active=true AND is_valid=true:
    → Reject with error
```

### 8.3 Provider Modification Guard

**Rule:** Cannot modify SSO providers when SSO is the only auth method.

```
If allow_email=false AND allow_social=false AND allow_root=false:
  → Block all provider create/update/delete operations
  → Require enabling email, social, or root first
```

---

## 9. Implementation References

| Component | File | Lines |
|-----------|------|-------|
| Flag defaults | `api/ee/src/services/db_manager_ee.py` | Organization creation |
| Discovery | `api/oss/src/core/auth/service.py` | `discover()` method |
| Authorization | `api/oss/src/core/auth/service.py` | `check_organization_access()` |
| Auto-join | `api/oss/src/core/auth/service.py` | `enforce_domain_policies()` |
| Invitation validation | `api/ee/src/services/workspace_manager.py` | `invite_user_to_workspace()` |
| Provider guard | `api/ee/src/apis/fastapi/organizations/router.py` | `require_email_or_social_or_root_enabled()` |
| Frontend settings | `web/oss/src/components/pages/settings/Organization/index.tsx` | Flag toggles |
| Error handling | `web/oss/src/lib/api/assets/axiosConfig.ts` | 403 interceptor |

---

## 10. Migration Considerations

When enabling `domains_only` on an existing organization:

1. **Audit current members** - Identify users with non-verified domains
2. **Communicate changes** - Notify affected users before enabling
3. **Add verified domains first** - Ensure all legitimate domains are verified
4. **Enable flag** - Users with non-verified domains will be blocked on next access
5. **Handle exceptions** - Use invitations for contractors/external users if needed

When enabling `auto_join`:

1. **Verify domain ownership** - Ensure DNS verification is complete
2. **Consider security implications** - Any user with that email domain can join
3. **Set appropriate default role** - Auto-joined users get "member" role
