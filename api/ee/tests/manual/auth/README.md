# SSO/OIDC Manual Testing Guide

This directory contains `.http` files for manually testing the SSO/OIDC authentication implementation.

## 🧪 Test Execution Order

### Phase 1: Setup & Verification
1. **`00-setup-verification.http`** - Run SQL setup commands first
   - Create test organizations with flags
   - Set up domains and providers (EE only)
   - Create test users
   - Verify schema

### Phase 2: Discovery Testing
2. **`01-discovery.http`** - Test auth method discovery
   - Test new user discovery
   - Test existing user discovery
   - Test SSO-required scenarios
   - Test multi-org users

### Phase 3: Domain Verification Testing (EE Only)
3. **`03-domain-verification.http`** - Test domain verification and governance
   - Verify domains on collaborative organizations
   - Prevent personal orgs from verifying domains
   - Enforce domain exclusivity (one domain, one org)
   - Test auto-join flag configuration
   - Domain transfer scenarios

### Phase 4: OIDC Flow Testing (EE Only)
4. **`02-oidc-authorize.http`** - Test OIDC initiation
   - Valid provider authorization
   - Invalid provider handling
   - OSS mode blocking

### Phase 5: Identity Tracking
5. **`03-identity-tracking.http`** - Verify identity creation
   - Email OTP identity tracking
   - Social login identity tracking
   - SSO identity tracking
   - Session payload verification

### Phase 6: Flag Enforcement (EE Only)
6. **`04-policy-enforcement.http`** - Test access control
   - SSO-only organization access (via flags)
   - Multi-method flag combinations
   - Auth upgrade requirements
   - Membership validation

### Phase 7: Slug Immutability
7. **`05-slug-immutability.http`** - Test slug constraints
   - Setting slug first time (null → value)
   - Preventing slug changes (immutability)
   - Updating organization without changing slug
   - Edge cases and validation

## 🔧 Using the .http Files

### Option 1: VS Code REST Client
1. Install "REST Client" extension by Huachao Mao
2. Open any `.http` file
3. Click "Send Request" above each test
4. View response in split pane

### Option 2: IntelliJ HTTP Client
1. Open `.http` file in IntelliJ IDEA
2. Click ▶️ button next to each request
3. View response in tool window

### Option 3: Manual with curl
```bash
# Discovery example
curl -X POST http://localhost:8000/auth/discover \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

## 📊 Expected Test Results

### OSS Mode Tests (Should Pass)
- ✅ Discovery returns `email:otp` and social methods
- ✅ Email OTP login creates `user_identity` record
- ✅ Social login creates `user_identity` record
- ✅ Session contains `identities` array
- ✅ Exactly 1 collaborative organization exists
- ✅ No personal organizations exist
- ✅ Organization has `flags.is_personal = false`
- ❌ SSO endpoints return 404 "EE only"
- ❌ Flag enforcement not active (EE only)
- ❌ Domain verification not available

### EE Mode Tests (Should Pass)
- ✅ All OSS tests pass
- ✅ Organizations have `flags.is_personal` (true or false)
- ✅ Personal organizations cannot verify domains
- ✅ Domain exclusivity enforced (one domain per org)
- ✅ Auto-join flag (`flags.auto_join`) can be configured
- ✅ Discovery returns SSO providers for verified domains
- ✅ OIDC authorization redirects to IdP
- ✅ SSO login creates `user_identity` with `sso:*` method
- ✅ Flag-based access control blocks unauthorized methods
- ✅ Auth upgrade flow works

## 🐛 Troubleshooting

### Discovery Returns No Methods
**Check:**
- Backend environment variables configured
- SuperTokens Core is running
- Database migrations applied
- No errors in backend logs

### Identities Not Created
**Check:**
- `user_identities` table exists
- SuperTokens overrides registered in config
- User exists in `users` table
- Database has write permissions

### Flags Not Enforced
**Check:**
- `AGENTA_LICENSE=ee`
- Middleware registered in FastAPI app
- Request includes `organization_id` parameter
- `organizations.flags` JSONB contains policy flags

### SSO Flow Fails
**Check:**
- OIDC provider configuration in `organization_providers`
- Provider `flags.is_active = true`
- Domain verified in `organization_domains` (`flags.is_verified = true`)
- Organization is collaborative (`flags.is_personal = false`)
- IdP credentials valid
- Callback URL configured at IdP

### Domain Verification Fails
**Check:**
- Organization is collaborative (`flags.is_personal = false`)
- Domain not already verified by another organization
- `organization_domains` table exists and populated

## 🔍 Debugging Tips

### Inspect Database State
```sql
-- Check identities created
SELECT * FROM user_identities ORDER BY created_at DESC LIMIT 10;

-- Check organization types (personal vs collaborative)
SELECT id, name, slug, flags->>'is_personal' as is_personal
FROM organizations
ORDER BY flags->>'is_personal';

-- Check organization flags (auth policy)
SELECT
  id,
  name,
  flags->'is_personal' as is_personal,
  flags->'allow_email' as allow_email,
  flags->'allow_social' as allow_social,
  flags->'allow_sso' as allow_sso,
  flags->'domains_only' as domains_only,
  flags->'auto_join' as auto_join,
  flags->'allow_root' as allow_root
FROM organizations;

-- Check domain verification
SELECT
  od.slug as domain,
  od.flags->>'is_verified' as verified,
  o.name as org_name,
  o.flags->>'is_personal' as is_personal
FROM organization_domains od
JOIN organizations o ON o.id = od.organization_id
ORDER BY od.flags->>'is_verified' DESC;

-- Check SSO providers
SELECT
  o.name,
  o.flags->>'is_personal' as is_personal,
  op.slug,
  op.flags->>'is_active' as is_active,
  op.settings->>'issuer' as issuer
FROM organizations o
JOIN organization_providers op ON op.organization_id = o.id;
```

### Check SuperTokens Core
```bash
# Verify SuperTokens is running
curl http://localhost:3567/hello

# Check user list
curl http://localhost:3567/users?limit=10
```

## ✅ Test Coverage

These manual tests cover:
- ✅ Email OTP authentication (OSS + EE)
- ✅ Social authentication (OSS + EE)
- ✅ SSO/OIDC authentication (EE only)
- ✅ Identity tracking and accumulation
- ✅ Session payload with identities
- ✅ Organization membership queries
- ✅ Flag-based access control
- ✅ Auth method discovery
- ✅ Multi-organization support
- ✅ Auth upgrade requirements
- ✅ Organization slug immutability
- ✅ Slug validation and constraints
- ✅ Organization classification (personal vs collaborative via `flags.is_personal`)
- ✅ Domain verification on collaborative organizations
- ✅ Domain verification restrictions on personal organizations
- ✅ Domain exclusivity enforcement (one domain per org)
- ✅ Auto-join flag configuration
- ✅ Auto-join behavior with verified domains

## Error Codes

| Error Code | Trigger | HTTP Status |
|------------|---------|-------------|
| `AUTH_UPGRADE_REQUIRED` | Auth method not in allowed list | 403 |
| `AUTH_SSO_DENIED` | SSO provider disabled or inactive | 403 |
| `AUTH_DOMAIN_DENIED` | Email domain not in verified list | 403 |
