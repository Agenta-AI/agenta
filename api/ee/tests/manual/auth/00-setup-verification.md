# Database Setup & Verification

SQL commands to set up test data and verify schema.

Run these in psql or your database client BEFORE running other tests.

---

## 1. Verify Migrations Applied

Check user_identities table exists:

```sql
\d user_identities
```

**Expected columns:**
- `id` (uuid)
- `user_id` (uuid, FK to users.id)
- `method` (text)
- `subject` (text)
- `domain` (text, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `updated_by_id` (uuid, nullable)

**Expected constraints:**
- UNIQUE (method, subject)
- INDEX on (user_id, method)
- INDEX on (domain)

---

## 2. Verify Organization Schema

Check organizations table has updated schema:

```sql
\d organizations
```

**Expected columns:**
- `slug` (text, unique, nullable)
- `flags` (jsonb, nullable) - contains `is_personal`, `is_demo`, auth policy flags
- `tags` (jsonb, nullable)
- `meta` (jsonb, nullable)
- `owner_id` (uuid, FK to users.id, NOT NULL)
- `created_by_id` (uuid, FK to users.id, NOT NULL)
- `updated_by_id` (uuid, nullable)
- `deleted_by_id` (uuid, nullable)
- `created_at` (timestamp, NOT NULL)
- `updated_at` (timestamp, nullable)
- `deleted_at` (timestamp, nullable)

**Expected indexes:**
- Unique index on `slug`
- GIN index on `flags`

---

## 3. Setup Test Collaborative Organization (EE Mode)

Create test collaborative organization with slug:

```sql
INSERT INTO organizations (
  id,
  name,
  slug,
  description,
  flags,
  owner_id,
  created_by_id,
  created_at
)
VALUES (
  gen_random_uuid(),
  'ACME Corporation',
  'acme',
  'Test collaborative organization for SSO',
  '{"is_personal": false, "allow_email": true, "allow_social": true, "allow_sso": true}'::jsonb,
  '<userId>',  -- Replace with actual user ID who will own this org
  '<userId>',
  now()
)
RETURNING id;
```

Save the returned ID as `@testOrgId`.

---

## 4. Setup Test Personal Organization (EE Mode)

Create test personal organization:

```sql
INSERT INTO organizations (
  id,
  name,
  slug,
  description,
  flags,
  owner_id,
  created_by_id,
  created_at
)
VALUES (
  gen_random_uuid(),
  'Personal',
  NULL,  -- Personal orgs have no slug
  NULL,
  '{"is_personal": true}'::jsonb,
  '<userId>',  -- Replace with actual user ID
  '<userId>',
  now()
)
RETURNING id;
```

Save the returned ID as `@testPersonalOrgId`.

Add user as member to their personal org:

```sql
INSERT INTO organization_members (
  id,
  user_id,
  organization_id,
  role,
  created_at
)
VALUES (
  gen_random_uuid(),
  '<userId>',
  '<testPersonalOrgId>',
  'owner',
  now()
);
```

---

## 5. Setup Organization Policy Flags (EE Mode)

Update organization flags to set authentication policies:

```sql
-- Allow only SSO, enforce verified domains, not invitation-only
UPDATE organizations
SET flags = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          flags,
          '{allow_email}', 'false'
        ),
        '{allow_social}', 'false'
      ),
      '{allow_sso}', 'true'
    ),
    '{invitations_only}', 'false'
  ),
  '{domains_only}', 'true'
)
WHERE id = '<testOrgId>';
```

**Policy flags in `organizations.flags`:**
- `allow_email` (boolean, default: true) - Allow email authentication (OTP/password)
- `allow_social` (boolean, default: true) - Allow social authentication (Google, GitHub, etc.)
- `allow_sso` (boolean, default: false) - Allow SSO/OIDC authentication
- `invitations_only` (boolean, default: true) - Require invitations to join
- `domains_only` (boolean, default: false) - Only allow users with verified domain emails
- `allow_root` (boolean, default: true) - Allow organization owner to bypass auth restrictions

---

## 6. Setup Verified Domain (EE Mode - Collaborative Org)

Add verified domain for SSO on collaborative org:

```sql
INSERT INTO organization_domains (
  id,
  organization_id,
  slug,
  name,
  description,
  token,
  flags,
  created_at
)
VALUES (
  gen_random_uuid(),
  '<testOrgId>',  -- Collaborative org ID
  'acme.com',
  'ACME Domain',
  'Primary domain for ACME Corporation',
  NULL,  -- Token only needed during verification
  '{"is_verified": true}'::jsonb,
  now()
)
RETURNING id;
```

Save as `@testDomainId`.

**Note:** `domain` field renamed to `slug`, `verified` moved to `flags.is_verified`, `verification_token` renamed to `token`.

---

## 7. Test Domain Verification Restrictions (EE Mode)

Attempt to add domain to personal org (verification should fail):

```sql
INSERT INTO organization_domains (
  id,
  organization_id,
  slug,
  name,
  token,
  flags,
  created_at
)
VALUES (
  gen_random_uuid(),
  '<testPersonalOrgId>',  -- Personal org ID
  'personal-test.com',
  'Personal Test Domain',
  'test-token-123',
  '{"is_verified": false}'::jsonb,
  now()
)
RETURNING id;
```

Save as `@personalOrgDomainId`.

**NOTE:** Attempting to verify this domain should fail with:
> "Personal organizations cannot verify domains"

---

## 8. Test Domain Exclusivity (EE Mode)

Create second collaborative org to test exclusivity:

```sql
INSERT INTO organizations (
  id,
  name,
  slug,
  description,
  flags,
  owner_id,
  created_by_id,
  created_at
)
VALUES (
  gen_random_uuid(),
  'Second Corp',
  'second',
  'Test domain exclusivity',
  '{"is_personal": false}'::jsonb,
  '<userId>',
  '<userId>',
  now()
)
RETURNING id;
```

Save as `@secondOrgId`.

Attempt to verify same domain as first org:

```sql
INSERT INTO organization_domains (
  id,
  organization_id,
  slug,
  name,
  token,
  flags,
  created_at
)
VALUES (
  gen_random_uuid(),
  '<secondOrgId>',
  'acme.com',  -- Same domain as testOrgId
  'Conflicting ACME Domain',
  'conflict-token-456',
  '{"is_verified": false}'::jsonb,
  now()
)
RETURNING id;
```

Save as `@conflictingDomainId`.

**NOTE:** Attempting to verify this domain should fail with:
> "Domain 'acme.com' is already verified by another organization"

---

## 9. Setup OIDC Provider (EE Mode)

Add OIDC provider configuration:

```sql
INSERT INTO organization_providers (
  id,
  organization_id,
  slug,
  name,
  description,
  settings,
  flags,
  created_at
)
VALUES (
  gen_random_uuid(),
  '<testOrgId>',
  'okta',
  'Okta SSO',
  'ACME Okta integration',
  '{
    "issuer": "https://dev-12345.okta.com",
    "client_id": "0oa...",
    "client_secret": "xxx",
    "scopes": ["openid", "profile", "email"],
    "authorization_endpoint": "https://dev-12345.okta.com/oauth2/v1/authorize",
    "token_endpoint": "https://dev-12345.okta.com/oauth2/v1/token",
    "userinfo_endpoint": "https://dev-12345.okta.com/oauth2/v1/userinfo"
  }'::jsonb,
  '{"is_active": true}'::jsonb,
  now()
)
RETURNING id;
```

Save as `@testProviderId`.

**Note:**
- `config` renamed to `settings`
- `enabled` moved to `flags.is_active`
- `domain_id` removed (SSO provider can handle multiple domains)

---

## 10. Create Test User

Create test user:

```sql
INSERT INTO users (id, uid, username, email, created_at)
VALUES (
  gen_random_uuid(),
  'st_user_123',  -- SuperTokens user ID
  'Test User',
  'test@acme.com',
  now()
)
RETURNING id;
```

Save as `@testUserId`.

---

## 11. Add User to Organization (EE Mode)

Create organization membership:

```sql
INSERT INTO organization_members (
  id,
  user_id,
  organization_id,
  role,
  created_at
)
VALUES (
  gen_random_uuid(),
  '<testUserId>',
  '<testOrgId>',
  'member',
  now()
);
```

**Note:** Added `role` field (default: "member", can be "owner").

---

## 12. Verification Queries

Check all test data created successfully:

### Verify organizations (check flags)

```sql
SELECT id, name, slug, flags
FROM organizations
ORDER BY flags->>'is_personal';
```

### Verify collaborative organization

```sql
SELECT id, name, slug, flags
FROM organizations
WHERE slug = 'acme';
```

### Verify personal organization

```sql
SELECT id, name, slug, flags
FROM organizations
WHERE flags->>'is_personal' = 'true';
```

### Verify organization policy flags

```sql
SELECT
  id,
  name,
  flags->'allow_email' as allow_email,
  flags->'allow_social' as allow_social,
  flags->'allow_sso' as allow_sso,
  flags->'invitations_only' as invitations_only,
  flags->'domains_only' as domains_only,
  flags->'allow_root' as allow_root
FROM organizations
WHERE id = '<testOrgId>';
```

### Verify domains

```sql
SELECT
  od.id,
  od.slug as domain,
  od.flags->>'is_verified' as verified,
  o.name as org_name,
  o.flags->>'is_personal' as is_personal
FROM organization_domains od
JOIN organizations o ON o.id = od.organization_id
ORDER BY o.flags->>'is_personal', od.slug;
```

### Verify provider

```sql
SELECT
  slug,
  name,
  flags->>'is_active' as enabled,
  settings->>'issuer' as issuer
FROM organization_providers
WHERE organization_id = '<testOrgId>';
```

### Verify user

```sql
SELECT id, email
FROM users
WHERE email = 'test@acme.com';
```

### Verify membership

```sql
SELECT
  om.id,
  u.email,
  o.name,
  om.role,
  o.flags->>'is_personal' as is_personal
FROM organization_members om
JOIN users u ON u.id = om.user_id
JOIN organizations o ON o.id = om.organization_id
WHERE u.email = 'test@acme.com'
ORDER BY o.flags->>'is_personal';
```

---

## 13. Cleanup (Run after testing)

Clean up test data:

```sql
DELETE FROM organization_members WHERE user_id = '<testUserId>';
DELETE FROM organization_providers WHERE organization_id IN ('<testOrgId>', '<secondOrgId>');
DELETE FROM organization_domains WHERE organization_id IN ('<testOrgId>', '<testPersonalOrgId>', '<secondOrgId>');
DELETE FROM user_identities WHERE user_id = '<testUserId>';
DELETE FROM users WHERE id = '<testUserId>';
DELETE FROM organizations WHERE id IN ('<testOrgId>', '<testPersonalOrgId>', '<secondOrgId>');
```

**Note:** No need to delete from `organization_policies` table (removed).

---

## Quick Setup Script (OSS Mode - Email OTP Only)

For OSS mode testing, verify migrations:

```sql
-- Check user_identities table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'user_identities'
) as user_identities_exists;

-- Check organizations.slug exists
SELECT EXISTS (
  SELECT FROM information_schema.columns
  WHERE table_name = 'organizations' AND column_name = 'slug'
) as org_slug_exists;

-- Check organizations.flags exists
SELECT EXISTS (
  SELECT FROM information_schema.columns
  WHERE table_name = 'organizations' AND column_name = 'flags'
) as org_flags_exists;

-- Verify OSS has exactly 1 collaborative organization
SELECT
  COUNT(*) as org_count,
  flags->>'is_personal' as is_personal
FROM organizations
GROUP BY flags->>'is_personal';
-- Expected: 1 row with is_personal=false (or null), count=1

-- Verify no personal organizations exist in OSS
SELECT COUNT(*) as personal_org_count
FROM organizations
WHERE flags->>'is_personal' = 'true';
-- Expected: 0
```

---

## Schema Changes Summary

### Organizations Table
- **Removed:** `type`, `owner` (string), `kind`
- **Added:** `owner_id` (UUID FK), `created_by_id`, `updated_by_id`, `deleted_by_id`, `deleted_at`, `flags`, `tags`, `meta`
- **Flags structure:** `{"is_personal": bool, "is_demo": bool, "allow_email": bool, "allow_social": bool, "allow_sso": bool, "invitations_only": bool, "domains_only": bool, "allow_root": bool}`

### Organization Domains Table
- **Renamed:** `domain` → `slug`, `verification_token` → `token`
- **Removed:** `verified` (boolean column)
- **Added:** `name`, `description`, `flags`, `tags`, `meta`
- **Flags structure:** `{"is_verified": bool}`
- **Lifecycle:** Changed from `LegacyLifecycle` to `Lifecycle` (added `deleted_at`, `created_by_id`, `deleted_by_id`)

### Organization Providers Table
- **Renamed:** `config` → `settings`
- **Removed:** `enabled` (boolean), `domain_id` (FK)
- **Added:** `name`, `description`, `flags`, `tags`, `meta`
- **Flags structure:** `{"is_active": bool}`
- **Lifecycle:** Changed from `LegacyLifecycle` to `Lifecycle`

### Organization Members Table
- **Added:** `role` (string, default: "member"), `created_at`, `updated_at`, `updated_by_id` (nullable)

### Removed Tables
- **organization_policies** - moved to `organizations.flags`
