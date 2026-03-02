# SuperTokens Runtime Configuration Model

This defines how each deployment selects the correct SuperTokens Core, tenant (user pool), and configuration mode.

Authentication behavior (allowed login methods, SSO rules, domain restrictions, etc.) is **not configured in SuperTokens**, but controlled by **organization flags in the database**.

---

## Environment Variables

| Variable | Purpose | Notes | Varies per deployment? |
|----------|---------|--------|-------------------------|
| `SUPERTOKENS_API_URL` | Selects which **SuperTokens Core instance** to communicate with | Encodes `{account,region}` (e.g., `cloud-eu`, `cloud-us`, `preview-eu`) | Yes |
| `SUPERTOKENS_API_KEY` | Authenticates requests to the Core | Set once per core; rotated outside app logic | Usually No |
| `SUPERTOKENS_TENANT_ID` | Selects the **user pool** (SuperTokens tenant) | Maps to `shared`, `preview`, or customer-specific tenants | Yes |
| `SUPERTOKENS_APPLICATION_ID` | SuperTokens application identifier | Always `default` — we do **not** split applications | No (always static) |

---

## Interpretation Rules

- **Core boundary = `{account,region}`**
  Examples:
  - `cloud-eu`
  - `cloud-us`
  - `preview-eu`

- **Tenant = user pool**
  Used to isolate identity spaces:

  | Case | Tenant Example |
  |-------|--------------|
  | Shared multi-tenant SaaS | `shared` |
  | Single-tenant enterprise | `acme`, `customer-x` |
  | Preview / ephemeral | Typically `preview` (shared) |

- **Application layer is fixed**
  We always use a **single application per tenant** (`SUPERTOKENS_APPLICATION_ID=default`).
  Dynamic per-org authentication rules come from `organizations.flags` in the database.

---

## Session Payload

SuperTokens sessions store authentication proofs:

```json
{
  "user_id": "UUID",
  "session_identities": ["email:otp", "social:google", "sso:acme:okta"]
}
```

Organization access is determined by matching `session_identities` against `organizations.flags`.

---

## Examples

### 1. Cloud EU — Shared SaaS Environment

```env
SUPERTOKENS_API_URL=https://supertokens.core-cloud-eu.internal
SUPERTOKENS_API_KEY=your-api-key-here
SUPERTOKENS_TENANT_ID=shared
SUPERTOKENS_APPLICATION_ID=default
```

---

### 2. Cloud EU — Dedicated Enterprise Tenant (ACME)

```env
SUPERTOKENS_API_URL=https://supertokens.core-cloud-eu.internal
SUPERTOKENS_API_KEY=your-api-key-here
SUPERTOKENS_TENANT_ID=acme
SUPERTOKENS_APPLICATION_ID=default
```

---

### 3. Preview EU — Multiple Realms Sharing Same Pool

```env
SUPERTOKENS_API_URL=https://supertokens.core-preview-eu.internal
SUPERTOKENS_API_KEY=sk_preview_eu_key
SUPERTOKENS_TENANT_ID=preview
SUPERTOKENS_APPLICATION_ID=default
```

> In preview:
> - SuperTokens sees one user pool
> - Our application may create separate `users` entries per preview realm.
> This means **same identity in ST → separate internal identities in each realm**, which is intended.

---

## Relationship to Organization Flags

SuperTokens handles **session management**. Organization-level policies are enforced by our backend:

| Concern | Where Configured |
|---------|------------------|
| Session creation/validation | SuperTokens |
| Allowed auth methods | `organizations.flags` (`allow_email`, `allow_social`, `allow_sso`) |
| Domain restrictions | `organizations.flags` (`domains_only`) + `organization_domains` |
| SSO providers | `organization_providers` table |
| Owner bypass | `organizations.flags` (`allow_root`) |

---

## One-Sentence Summary

> **A deployment picks an identity boundary by choosing the correct SuperTokens Core (`SUPERTOKENS_API_URL`) and tenant (`SUPERTOKENS_TENANT_ID`), while `SUPERTOKENS_APPLICATION_ID=default` remains universal and all auth rules are enforced via `organizations.flags` by our backend.**
