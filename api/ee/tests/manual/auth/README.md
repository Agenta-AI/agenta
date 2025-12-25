# SSO/OIDC Manual Testing Guide

This directory contains `.http` files for manually testing the SSO/OIDC authentication implementation.

## 📋 Prerequisites

### 1. Database Setup
```bash
# Run migrations
cd vibes/api
alembic -c ee/databases/postgres/alembic.ini upgrade head

# Verify migrations applied
psql <connection-string> -c "\d user_identities"
psql <connection-string> -c "\d organizations" | grep slug
```

### 2. Backend Configuration

#### OSS Mode (Email OTP + Social only)
```bash
export AGENTA_LICENSE=oss
export SUPERTOKENS_URI_CORE=http://localhost:3567
export AGENTA_API_URL=http://localhost:8000
export AGENTA_WEB_URL=http://localhost:3000

# Optional: Enable social providers
export AUTH_GOOGLE_ENABLED=true
export AUTH_GOOGLE_OAUTH_CLIENT_ID=<your-google-client-id>
export AUTH_GOOGLE_OAUTH_CLIENT_SECRET=<your-google-secret>
```

#### EE Mode (All features including SSO)
```bash
export AGENTA_LICENSE=ee
export SUPERTOKENS_URI_CORE=http://localhost:3567
# ... other env vars ...
```

### 3. Start Services

```bash
# Terminal 1: Start SuperTokens Core
docker run -p 3567:3567 registry.supertokens.io/supertokens/supertokens-postgresql

# Terminal 2: Start Backend
cd vibes/api
uvicorn main:app --reload --port 8000
```

## 🧪 Test Execution Order

### Phase 1: Setup & Verification
1. **`00-setup-verification.http`** - Run SQL setup commands first
   - Create test organizations
   - Set up policies and providers (EE only)
   - Create test users
   - Verify schema

### Phase 2: Discovery Testing
2. **`01-discovery.http`** - Test auth method discovery
   - Test new user discovery
   - Test existing user discovery
   - Test SSO-required scenarios
   - Test multi-org users

### Phase 3: OIDC Flow Testing (EE Only)
3. **`02-oidc-authorize.http`** - Test OIDC initiation
   - Valid provider authorization
   - Invalid provider handling
   - OSS mode blocking

### Phase 4: Identity Tracking
4. **`03-identity-tracking.http`** - Verify identity creation
   - Email OTP identity tracking
   - Social login identity tracking
   - SSO identity tracking
   - Session payload verification

### Phase 5: Policy Enforcement (EE Only)
5. **`04-policy-enforcement.http`** - Test access control
   - SSO-only organization access
   - Multi-method policies
   - Auth upgrade requirements
   - Membership validation

### Phase 6: Slug Immutability
6. **`05-slug-immutability.http`** - Test slug constraints
   - Setting slug first time (null → value)
   - Preventing slug changes (immutability)
   - Updating organization without changing slug
   - Edge cases and validation

## 🔧 Using the .http Files

### Option 1: VS Code REST Client Extension
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
- ❌ SSO endpoints return 404 "EE only"
- ❌ Policy enforcement not active

### EE Mode Tests (Should Pass)
- ✅ All OSS tests pass
- ✅ Discovery returns SSO providers for verified domains
- ✅ OIDC authorization redirects to IdP
- ✅ SSO login creates `user_identity` with `sso:*` method
- ✅ Policy middleware blocks unauthorized methods
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

### Policy Not Enforced
**Check:**
- `AGENTA_LICENSE=ee`
- Middleware registered in FastAPI app
- Request includes `organization_id` parameter
- `organization_policies` table has data

### SSO Flow Fails
**Check:**
- OIDC provider configuration in `organization_providers`
- Provider `enabled=true`
- Domain verified in `organization_domains`
- IdP credentials valid
- Callback URL configured at IdP

## 📝 Test Data Cleanup

After testing, clean up test data:

```sql
-- Run the cleanup queries from 00-setup-verification.http
DELETE FROM organization_members WHERE user_id = '<test-user-id>';
DELETE FROM organization_providers WHERE organization_id = '<test-org-id>';
DELETE FROM organization_domains WHERE organization_id = '<test-org-id>';
DELETE FROM organization_policies WHERE organization_id = '<test-org-id>';
DELETE FROM user_identities WHERE user_id = '<test-user-id>';
DELETE FROM users WHERE id = '<test-user-id>';
DELETE FROM organizations WHERE id = '<test-org-id>';
```

## 🔍 Debugging Tips

### Enable Debug Logging
```bash
# Backend logs
export LOG_LEVEL=DEBUG

# SuperTokens debug
export SUPERTOKENS_DEBUG=true
```

### Inspect Database State
```sql
-- Check identities created
SELECT * FROM user_identities ORDER BY created_at DESC LIMIT 10;

-- Check organization policies
SELECT o.name, p.allowed_methods
FROM organizations o
JOIN organization_policies p ON p.organization_id = o.id;

-- Check SSO providers
SELECT o.name, op.slug, op.enabled, op.config->>'issuer'
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

## 📚 Related Documentation

- Architecture specs: `../../../../../../../sandbox/architecture/auth.*.specs.md`
- Migration files: `../../../databases/postgres/migrations/core/versions/`
- SuperTokens docs: https://supertokens.com/docs
- OIDC spec: https://openid.net/specs/openid-connect-core-1_0.html

## ✅ Test Coverage

These manual tests cover:
- ✅ Email OTP authentication (OSS + EE)
- ✅ Social authentication (OSS + EE)
- ✅ SSO/OIDC authentication (EE only)
- ✅ Identity tracking and accumulation
- ✅ Session payload with identities
- ✅ Organization membership queries
- ✅ Policy-based access control
- ✅ Auth method discovery
- ✅ Multi-organization support
- ✅ Auth upgrade requirements
- ✅ Organization slug immutability
- ✅ Slug validation and constraints

## 🚀 Next Steps

After manual testing passes:
1. Create automated integration tests
2. Add frontend components for auth flows
3. Set up E2E tests with Playwright
4. Performance test with multiple concurrent SSO flows
5. Security audit of OIDC implementation
