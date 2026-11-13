---
title: Advanced Auth Implementation Status
description: Tracking implementation status against design specifications
date: 2026-01-16
---

# Advanced Authentication Implementation Status

This document tracks the implementation status of advanced authentication features against the design specifications in this directory.

## Overview

| Spec Document | Implementation Status | Notes |
|---------------|----------------------|-------|
| auth.flags.specs.md | ✅ Implemented | Org flags, defaults, enforcement |
| auth.domains.specs.md | ✅ Implemented | Domain verification via DNS TXT |
| auth.sso.specs.md | ✅ Implemented | SSO providers, OIDC, secrets |
| auth.sessions.specs.md | ✅ Implemented | Session identity accumulation |
| auth.flows.specs.md | ✅ Partially Implemented | Discovery, upgrade flow |
| auth.realms.specs.md | 🟡 Planned | Multi-realm architecture |
| auth.supertokens.specs.md | ✅ Implemented | SuperTokens integration |
| auth.oss-ee.specs.md | ✅ Implemented | Feature gating |
| auth.migrations.specs.md | ✅ Implemented | Org migration |

## Detailed Status

### ✅ Organization Flags (auth.flags.specs.md)

**Status**: Fully Implemented

**Features**:
- ✅ `allow_email` - Email/password and OTP authentication
- ✅ `allow_social` - Social OAuth providers
- ✅ `allow_sso` - Enterprise SSO providers
- ✅ `allow_root` - Owner bypass for policy enforcement
- ✅ `domains_only` - Restrict to verified email domains
- ✅ `auto_join` - Auto-add users with verified domains
- ✅ `is_demo` - Demo organization flag

**Implementation**:
- Database: `organizations.flags` JSONB column
- Enforcement: `checkOrganizationAccess()` middleware
- Frontend: Organization settings UI
- Backend: Flag validation and defaults

**Evidence**:
- File: `/vibes/api/ee/src/services/organization_service.py`
- File: `/vibes/web/oss/src/lib/helpers/authMethodFilter.ts`
- File: `/vibes/web/oss/src/hooks/usePostAuthRedirect.ts`

---

### ✅ Domain Verification (auth.domains.specs.md)

**Status**: Fully Implemented

**Features**:
- ✅ Create domain for verification
- ✅ Generate DNS TXT verification token
- ✅ Verify domain via DNS lookup
- ✅ Refresh verification token
- ✅ Reset verified domain
- ✅ Delete domain
- ✅ One domain = one organization globally (UNIQUE constraint)

**Implementation**:
- Database: `organization_domains` table
- API: `/api/organizations/{org_id}/security/domains`
- Verification: DNS TXT record lookup
- Token format: `agenta-verify=abc123xyz`

**Evidence**:
- Schema: `organization_domains` table with `slug UNIQUE`
- API endpoints for CRUD operations
- DNS verification logic

---

### ✅ SSO Providers (auth.sso.specs.md)

**Status**: Fully Implemented

**Features**:
- ✅ Create OIDC provider (per-organization)
- ✅ Test provider connection
- ✅ Activate/deactivate provider
- ✅ Provider flags: `is_active`, `is_valid`
- ✅ Encrypted secret storage (`secret_id`)
- ✅ SSO lifecycle (Phase 0-4)
- ✅ Provider rotation support
- ✅ Safety guards (cannot disable last auth method)

**Implementation**:
- Database: `organization_providers` table
- Secret storage: Encrypted via `secrets` table
- SuperTokens integration: Dynamic provider registration
- Session identities: `sso:{org_slug}:{provider_slug}`

**Evidence**:
- Schema: `organization_providers` with `secret_id` FK
- API endpoints for provider management
- SuperTokens OIDC configuration

---

### ✅ Session Identities (auth.sessions.specs.md)

**Status**: Fully Implemented

**Features**:
- ✅ Session payload stores `identities` array
- ✅ Identity accumulation (not replacement)
- ✅ Identity formats: `email:*`, `social:google`, `sso:acme:okta`
- ✅ Policy matching against identities
- ✅ Identity removal on sign-out

**Implementation**:
- SuperTokens session payload: `session_identities` field
- Session access via `Session.getAccessTokenPayloadSecurely()`
- Identity parsing: `parseAuthMethods()` function
- Policy matching: `filterOrgsByAuthMethod()` function

**Evidence**:
- File: `/vibes/web/oss/src/lib/helpers/authMethodFilter.ts`
  - `parseAuthMethods()` - parses session identities
  - `filterOrgsByAuthMethod()` - matches orgs to identities
- File: `/vibes/web/oss/src/hooks/usePostAuthRedirect.ts`
  - Session payload access
  - Identity-based org filtering

---

### ✅ Authentication Flows (auth.flows.specs.md)

**Status**: Partially Implemented

**Implemented**:
- ✅ Email-based discovery (`POST /auth/discover`)
- ✅ Organization discovery (`GET /api/organizations`)
- ✅ Post-login organization selection
- ✅ Organization filtering by auth method
- ✅ Auth upgrade flow (AUTH_UPGRADE_REQUIRED)
- ✅ Error responses (AUTH_UPGRADE_REQUIRED, AUTH_SSO_DENIED)
- ✅ Frontend error handling

**Implementation Details**:

#### Discovery Endpoint
- ✅ Backend: `/api/auth/discover`
- ✅ Returns available auth methods per email
- ✅ Aggregates methods across user's organizations
- ✅ Does not reveal organization names (security)

#### Organization Selection Priority
- ✅ Auth upgrade state (localStorage: `authUpgradeOrgId`)
- ✅ Filter by compatible auth method (NEW - Jan 2026)
- ✅ SSO org (localStorage: `lastSsoOrgSlug`)
- ✅ Last-used org
- ✅ Preferred workspace
- ✅ Any compatible org

**Recent Fixes** (Jan 16, 2026):
- ✅ Fixed: Auth method filtering now happens BEFORE org selection
- ✅ Fixed: Auth sync no longer intercepts `/auth` route
- ✅ Fixed: usePostAuthRedirect handles all filtering logic
- ✅ Fixed: Billing page refreshes after Stripe redirect
- ✅ Fixed: Sign-out clears `authUpgradeOrgId` localStorage

**Evidence**:
- File: `/vibes/web/oss/src/state/url/auth.ts` (auth sync)
- File: `/vibes/web/oss/src/hooks/usePostAuthRedirect.ts` (org filtering)
- File: `/vibes/web/oss/src/pages/auth/[[...path]].tsx` (auth UI)

**Not Yet Implemented**:
- ⏳ Realm-based routing (subdomain → realm mapping)
- ⏳ Discovery auto-redirect for SSO-only users

---

### 🟡 Realms (auth.realms.specs.md)

**Status**: Planned (Not Implemented)

**Specification**:
- Multi-tenant realms mapped to subdomains
- Format: `{tier}.{region}.{account}.agenta.ai`
- Each realm = separate database + SuperTokens tenant
- Realm determines infrastructure scope

**Current State**:
- Single realm/tenant deployment
- No subdomain-based routing
- Future enhancement for multi-region cloud offering

**Implementation Plan**:
- Phase 1: Single realm (current)
- Phase 2: Multi-realm support (future cloud offering)

---

### ✅ SuperTokens Integration (auth.supertokens.specs.md)

**Status**: Fully Implemented

**Features**:
- ✅ Email + password authentication
- ✅ Email + OTP authentication
- ✅ Social OAuth providers (15+ providers)
- ✅ Enterprise SSO (OIDC)
- ✅ Session management
- ✅ Token refresh
- ✅ Sign-out

**Implementation**:
- SuperTokens Core: Docker container
- SuperTokens SDK: Frontend + Backend integration
- Session payload: Custom claims (`session_identities`)
- Provider configuration: Dynamic OIDC provider registration

**Environment Variables**:
- `SUPERTOKENS_CONNECTION_URI`
- `SUPERTOKENS_API_KEY`
- `SUPERTOKENS_EMAIL_DISABLED`
- OAuth client IDs/secrets for each provider

**Evidence**:
- File: `/vibes/docs/docs/self-host/02-configuration.mdx`
- SuperTokens configuration in docker-compose

---

### ✅ OSS vs EE Feature Gating (auth.oss-ee.specs.md)

**Status**: Fully Implemented

**Features**:
- ✅ License-based feature gating (`AGENTA_LICENSE=oss|ee`)
- ✅ SSO providers (EE only)
- ✅ Domain verification (EE only)
- ✅ Advanced RBAC (EE only)
- ✅ Email/social OAuth (OSS + EE)

**Implementation**:
- License check: `isEE()` helper function
- Feature flags: Conditional UI rendering
- API enforcement: License validation in backend

**Evidence**:
- File: `/vibes/web/oss/src/lib/helpers/isEE.ts`
- Conditional rendering throughout codebase

---

### ✅ Organization Migrations (auth.migrations.specs.md)

**Status**: Implemented

**Features**:
- ✅ Removed `is_personal` flag (all orgs collaborative)
- ✅ Migration script for existing orgs
- ✅ Default workspace creation

**Evidence**:
- Database migrations
- Updated schema (no `is_personal` column)

---

## Frontend Implementation Details

### Auth Method Filtering (NEW - Jan 2026)

**Problem Solved**: Users were being redirected to organizations requiring authentication methods they didn't have, causing `AUTH_UPGRADE_REQUIRED` errors.

**Solution**: Filter organizations by compatible authentication methods BEFORE selecting which org to redirect to.

**Files Changed**:
1. `/vibes/web/oss/src/lib/helpers/authMethodFilter.ts` (NEW)
   - `parseAuthMethods()` - Extract auth methods from session identities
   - `filterOrgsByAuthMethod()` - Filter orgs by compatible methods

2. `/vibes/web/oss/src/hooks/usePostAuthRedirect.ts` (MODIFIED)
   - Fetch session identities from JWT payload
   - Filter organizations before selection
   - Apply filtered list to priority logic

3. `/vibes/web/oss/src/state/url/auth.ts` (MODIFIED)
   - Disable automatic redirect from `/auth`
   - Let `usePostAuthRedirect` handle all filtering

**Session Identity Formats**:
- Email: `email:*`, `email:password`, `email:otp`
- Social: `social:google`, `social:github`, etc.
- SSO: `sso:{org_slug}:{provider_slug}`

**Org Compatibility Matching**:
```typescript
const hasEmail = identities.some(id => id.startsWith("email:"))
const hasSocial = identities.some(id => id.startsWith("social:"))
const hasSSO = identities.some(id => id.startsWith("sso:"))

// Match against org flags
const emailMatch = hasEmail && org.flags?.allow_email
const socialMatch = hasSocial && org.flags?.allow_social
const ssoMatch = hasSSO && org.flags?.allow_sso

return emailMatch || socialMatch || ssoMatch
```

---

## Error Handling

### Error Codes Implemented

| Error Code | Trigger | Frontend Action | Backend Status |
|------------|---------|-----------------|----------------|
| `AUTH_UPGRADE_REQUIRED` | Session identities don't match org policy | Redirect to `/auth?auth_error=upgrade_required&auth_message=...` | ✅ Implemented |
| `AUTH_SSO_DENIED` | SSO disabled or provider inactive | Sign out, redirect to `/auth?auth_error=sso_denied&auth_message=...` | ✅ Implemented |
| `AUTH_DOMAIN_DENIED` | Email domain not in verified list | Sign out, redirect to `/auth?auth_error=domain_denied&auth_message=...` | ✅ Implemented |

### Error Handling Locations

1. **Axios Interceptor** (`/vibes/web/oss/src/lib/api/assets/axiosConfig.ts`)
   - Catches 403 errors from API
   - Extracts error code and message
   - Redirects to appropriate auth page

2. **Organization Switching** (`/vibes/web/oss/src/components/Sidebar/components/ListOfOrgs.tsx`)
   - Calls `checkOrganizationAccess` before switching
   - Opens auth upgrade modal if needed

3. **Auth Page** (`/vibes/web/oss/src/pages/auth/[[...path]].tsx`)
   - Displays error messages
   - Shows required authentication methods
   - Handles sign-out and re-authentication

---

## Recent Bugs Fixed (Jan 16, 2026)

### Bug 1: Email sign-in redirected to SSO org
**Symptom**: User signs in with email, gets redirected to SSO-only org, sees AUTH_UPGRADE_REQUIRED

**Root Cause**: Organization selection didn't filter by auth method compatibility

**Fix**:
- Added `authMethodFilter.ts` to parse session identities and filter orgs
- Updated `usePostAuthRedirect.ts` to apply filtering before org selection
- Updated `auth.ts` to not intercept `/auth` route

**Files Changed**:
- `/vibes/web/oss/src/lib/helpers/authMethodFilter.ts` (NEW)
- `/vibes/web/oss/src/hooks/usePostAuthRedirect.ts` (MODIFIED)
- `/vibes/web/oss/src/state/url/auth.ts` (MODIFIED)

### Bug 2: Sign-out shows auth upgrade error
**Symptom**: Clicking "Sign out and use a different account" shows stale auth upgrade error

**Root Cause**: `authUpgradeOrgId` localStorage not cleared on sign-out

**Fix**:
- Clear `authUpgradeOrgId` before calling `signOut()`
- Redirect to clean `/auth` page without error params

**Files Changed**:
- `/vibes/web/oss/src/pages/auth/[[...path]].tsx`

### Bug 3: Billing page doesn't refresh after Stripe
**Symptom**: After returning from Stripe checkout, billing page shows stale data

**Root Cause**: React Query cache not invalidated, no refresh on mount

**Fix**:
- Added `useEffect` to call `mutateSubscription()` and `mutateUsage()` on mount
- Added Stripe return detection (query params: `session_id`, `success`, `canceled`)
- Automatically refresh data when returning from Stripe

**Files Changed**:
- `/vibes/web/ee/src/components/pages/settings/Billing/index.tsx`

---

## Testing Status

### Manual Testing

| Scenario | Status | Notes |
|----------|--------|-------|
| Email sign-in → email-compatible org | ✅ Tested | Redirects correctly |
| Email sign-in → SSO-only org | ✅ Tested | Shows AUTH_UPGRADE_REQUIRED |
| Social sign-in → social-compatible org | ✅ Tested | Redirects correctly |
| SSO sign-in → SSO org | ✅ Tested | Redirects correctly |
| Org switching (compatible) | ✅ Tested | Switches immediately |
| Org switching (incompatible) | ✅ Tested | Shows auth upgrade modal |
| Sign-out and use different account | ✅ Tested | Clean sign-out |
| Billing page after Stripe return | ✅ Tested | Data refreshes |

### Automated Testing

| Test Suite | Status | Coverage |
|------------|--------|----------|
| Auth method filtering | ⏳ TODO | Unit tests for parseAuthMethods, filterOrgsByAuthMethod |
| Org selection priority | ⏳ TODO | Integration tests for usePostAuthRedirect |
| Error handling | ⏳ TODO | E2E tests for error flows |
| SSO provider CRUD | ⏳ TODO | API tests for provider management |
| Domain verification | ⏳ TODO | API tests for domain verification |

---

## Documentation Status

### Internal Specs (Complete)

| Document | Status |
|----------|--------|
| auth.flags.specs.md | ✅ Complete |
| auth.domains.specs.md | ✅ Complete |
| auth.sso.specs.md | ✅ Complete |
| auth.sessions.specs.md | ✅ Complete |
| auth.flows.specs.md | ✅ Complete |
| auth.realms.specs.md | ✅ Complete |
| auth.supertokens.specs.md | ✅ Complete |
| auth.oss-ee.specs.md | ✅ Complete |
| auth.migrations.specs.md | ✅ Complete |
| auth.testing.plans.md | ✅ Complete |

### User-Facing Docs (In Progress)

| Document | Status | Location |
|----------|--------|----------|
| Documentation Plan | ✅ Complete | `/docs/design/advanced-auth/DOCUMENTATION_PLAN.md` |
| Account Linking | ✅ Draft Ready | `/docs/drafts/authentication/account-linking.mdx` |
| Multiple Organizations | ✅ Draft Ready | `/docs/drafts/authentication/multi-organization-access.mdx` |
| SSO Providers | ✅ Draft Ready | `/docs/drafts/enterprise/sso-providers.mdx` |
| Email Authentication | ⏳ TODO | Planned |
| Social OAuth | ⏳ TODO | Planned |
| Domain Verification | ⏳ TODO | Planned |
| Session Identities | ⏳ TODO | Planned |
| Auth Upgrade Flow | ⏳ TODO | Planned |

---

## Known Limitations

### 1. Single Realm Only
- **Limitation**: Only supports single realm/tenant deployment
- **Impact**: Cannot run multi-region cloud offering
- **Workaround**: Deploy separate instances per region
- **Future**: Implement realm routing per `auth.realms.specs.md`

### 2. No SCIM Provisioning
- **Limitation**: No SCIM 2.0 protocol support for user provisioning
- **Impact**: Manual user management only
- **Workaround**: Use auto-join with verified domains
- **Future**: Implement SCIM endpoints

### 3. Fixed RBAC Roles
- **Limitation**: Cannot create custom roles
- **Impact**: Limited permission granularity
- **Workaround**: Use org flags for broad policies
- **Future**: Implement custom role creation (like LangSmith)

### 4. No Audit Logs
- **Limitation**: No audit trail for auth events
- **Impact**: Cannot track who accessed what
- **Workaround**: Application logs only
- **Future**: Implement audit log table and UI

---

## Next Steps

### High Priority

1. **Complete User Documentation** (Phase 1)
   - [ ] Self-host authentication overview
   - [ ] Email authentication guide
   - [ ] Social OAuth configuration
   - [ ] Session identities concept

2. **Testing**
   - [ ] Unit tests for auth method filtering
   - [ ] Integration tests for org selection
   - [ ] E2E tests for auth flows

3. **Monitoring**
   - [ ] Add metrics for auth method usage
   - [ ] Track AUTH_UPGRADE_REQUIRED occurrences
   - [ ] Monitor SSO provider health

### Medium Priority

4. **Enterprise Documentation** (Phase 2)
   - [ ] Enterprise overview
   - [ ] Organizations guide
   - [ ] Domain verification
   - [ ] Provider-specific guides (Okta, Azure AD, Google)

5. **RBAC Enhancements**
   - [ ] Document existing RBAC system
   - [ ] Implement custom roles (if needed)

### Low Priority

6. **Multi-Realm Support**
   - [ ] Implement realm routing
   - [ ] Subdomain → realm mapping
   - [ ] Multi-tenant database separation

7. **SCIM Provisioning**
   - [ ] SCIM 2.0 endpoint implementation
   - [ ] Okta integration
   - [ ] Azure AD integration

---

## Conclusion

**Overall Status**: 🟢 Core features fully implemented and working

**Recent Progress**:
- ✅ Auth method filtering (Jan 16, 2026)
- ✅ Bug fixes for org selection and sign-out
- ✅ Billing page refresh improvements
- ✅ Comprehensive user documentation drafts

**Remaining Work**:
- Complete user-facing documentation
- Add automated tests
- Implement audit logging
- Consider RBAC and SCIM enhancements

The advanced authentication system is production-ready with all core features implemented. The main focus now is on completing user-facing documentation and adding comprehensive testing.
