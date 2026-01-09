# Authentication System Manual Test Plan

## Overview

Manual E2E test plan focused on functionality, errors, and security. Organized by OSS/EE modes and development phases.

---

## Phase 1: Core Authentication (OSS)

### 1.1 Email OTP Flow

**Setup**: OSS mode, clean database

**Steps**:
1. Navigate to `/` (logged out)
2. Enter email → POST `/auth/discover`
3. Verify response shows email methods available
4. Click "Send OTP" → SuperTokens sends email
5. Check email, copy OTP code
6. Enter OTP → Verify session created
7. Check session payload: `session_identities=["email:otp"]`
8. Refresh page → Session persists

**Pass Criteria**:
- ✓ User created on first login
- ✓ Session includes identities array
- ✓ Session persists across requests

---

### 1.2 Social Login (Google)

**Setup**: OSS mode, Google OAuth configured in env

**Steps**:
1. Navigate to `/` (logged out)
2. Click "Continue with Google" → Redirect to Google
3. Sign in with Google account
4. Consent screen → Allow
5. Redirected back to app with session
6. Check session: `session_identities=["social:google"]`

**Pass Criteria**:
- ✓ User matched/created by email
- ✓ Session includes social:google

---

### 1.3 Multi-Method Login

**Setup**: OSS mode, existing user with `email:otp` identity

**Steps**:
1. Log in with email OTP → Check session: `["email:otp"]`
2. Log out
3. Log in with Google → Check session: `["email:otp", "social:google"]`
4. Verify session accumulates all identities

**Pass Criteria**:
- ✓ Identities accumulate across logins
- ✓ All login methods work independently

---

## Phase 2: Organization Flags (EE)

### 2.1 Basic Flag Enforcement

**Setup**: EE mode, database with organizations table

**Steps**:
1. Create organization "ACME Corp"
2. Set flags: `allow_email=true`, `allow_social=false`, `allow_sso=false`
3. User logs in with email OTP → Session: `["email:otp"]`
4. Make request to org endpoint → 200 OK
5. User logs in with Google only → Session: `["social:google"]`
6. Make request to org endpoint → 403 `AUTH_UPGRADE_REQUIRED`

**Pass Criteria**:
- ✓ Flag enforcement works
- ✓ Allowed methods grant access
- ✓ Disallowed methods result in AUTH_UPGRADE_REQUIRED

---

### 2.2 SSO-Only Organization

**Setup**: EE mode, organization with strict flags

**Steps**:
1. Create organization "Enterprise Inc"
2. Set flags: `allow_email=false`, `allow_social=false`, `allow_sso=true`, `allow_root=true`
3. User logs in with email OTP → Session: `["email:otp"]`
4. Make request to org endpoint → 403
5. Verify error response:
   ```json
   {
     "error": "AUTH_UPGRADE_REQUIRED",
     "message": "Additional authentication required",
     "required_methods": ["sso:*"]
   }
   ```
6. User completes SSO → Session: `["email:otp", "sso:enterprise:okta"]`
7. Retry request → 200 OK

**Pass Criteria**:
- ✓ SSO-only policy blocks non-SSO users
- ✓ Clear error message with required methods
- ✓ After SSO upgrade, access granted

---

### 2.3 Owner Bypass (`allow_root`)

**Setup**: EE mode, organization with owner bypass enabled

**Steps**:
1. Create organization with `allow_email=false`, `allow_social=false`, `allow_sso=false`, `allow_root=true`
2. Owner logs in with email OTP → Session: `["email:otp"]`
3. Owner makes request to org endpoint → 200 OK (bypasses all checks)
4. Non-owner with same session → 403 `AUTH_UPGRADE_REQUIRED`

**Pass Criteria**:
- ✓ Owner bypasses all auth restrictions when `allow_root=true`
- ✓ Non-owners still subject to policy

---

### 2.4 Domains Only (`domains_only`)

**Setup**: EE mode, organization with domain restriction

**Steps**:
1. Create organization with `domains_only=true`
2. Add verified domain `acme.com`
3. User with `user@acme.com` accesses org → 200 OK
4. User with `user@gmail.com` accesses org → 403 `AUTH_DOMAIN_DENIED`
5. Verify error response:
   ```json
   {
     "error": "AUTH_DOMAIN_DENIED",
     "message": "Your email domain 'gmail.com' is not allowed for this organization"
   }
   ```

**Pass Criteria**:
- ✓ Verified domain users allowed
- ✓ Non-verified domain users blocked with AUTH_DOMAIN_DENIED

---

### 2.5 Invitation Domain Validation

**Setup**: EE mode, organization with `domains_only=true`

**Steps**:
1. Set org flags: `domains_only=true`
2. Add verified domain `acme.com`
3. Try to invite `user@gmail.com` → 400 error
4. Verify error: "Cannot invite: domain 'gmail.com' is not a verified domain"
5. Invite `user@acme.com` → Success

**Pass Criteria**:
- ✓ Invitations to non-verified domains blocked
- ✓ Invitations to verified domains succeed

---

## Phase 3: SSO/OIDC Flows (EE)

### 3.1 SSO Provider Setup

**Setup**: EE mode, organization exists

**Steps**:
1. Create organization "ACME Corp"
2. Add domain: `slug="acme.com"`
3. Verify domain via DNS TXT record
4. Create SSO provider via API:
   ```json
   {
     "slug": "okta",
     "name": "ACME Okta",
     "type": "oidc",
     "config": {
       "issuer_url": "https://acme.okta.com",
       "client_id": "abc123",
       "client_secret": "secret456"
     }
   }
   ```
5. Test provider connection → Sets `flags.is_valid=true`
6. Enable provider → Sets `flags.is_active=true`

**Pass Criteria**:
- ✓ Provider created with encrypted config via `secret_id`
- ✓ Provider must be tested before activation
- ✓ Provider linked to organization

---

### 3.2 SSO Discovery

**Setup**: EE mode, verified domain with active SSO provider

**Steps**:
1. POST `/auth/discover` with body: `{"email": "user@acme.com"}`
2. Verify response includes SSO providers:
   ```json
   {
     "sso": {
       "enabled": true,
       "required": false,
       "providers": [
         {"slug": "okta", "name": "ACME Okta"}
       ]
     }
   }
   ```

**Pass Criteria**:
- ✓ Domain matched to provider
- ✓ SSO provider shown in discovery

---

### 3.3 SSO Authentication Flow

**Setup**: EE mode, SSO provider configured

**Steps**:
1. User clicks "Continue with ACME Okta"
2. Redirect to Okta login page
3. User authenticates at Okta
4. Callback with authorization code
5. Backend exchanges code for tokens
6. Session updated with `sso:acme:okta` identity
7. User redirected to app

**Pass Criteria**:
- ✓ OIDC flow completes successfully
- ✓ Session includes SSO identity
- ✓ User can access SSO-only organization

---

### 3.4 SSO Provider Disabled

**Setup**: User authenticated via SSO, admin disables provider

**Steps**:
1. User has session with `sso:acme:okta`
2. Admin sets provider `flags.is_active=false`
3. User makes request to org with `allow_sso=true` only → 403
4. Verify error: `AUTH_SSO_DENIED`

**Pass Criteria**:
- ✓ Disabled provider results in AUTH_SSO_DENIED
- ✓ User must re-authenticate with different method

---

## Phase 4: Safety Mechanisms

### 4.1 Lockout Prevention

**Setup**: EE mode, organization with all auth methods

**Steps**:
1. Create organization with `allow_email=true`, `allow_social=true`, `allow_sso=false`
2. Update flags to disable all: `allow_email=false`, `allow_social=false`, `allow_sso=false`
3. Verify `allow_root` is automatically enabled
4. Owner can still access organization

**Pass Criteria**:
- ✓ System auto-enables `allow_root` when all methods disabled
- ✓ Owner never locked out

---

### 4.2 SSO Provider Modification Guard

**Setup**: EE mode, SSO-only organization

**Steps**:
1. Set flags: `allow_email=false`, `allow_social=false`, `allow_sso=true`, `allow_root=false`
2. Try to modify SSO provider → 400 error
3. Verify error: "Enable email, social, or root access before modifying providers"
4. Enable `allow_root=true`
5. Modify SSO provider → Success

**Pass Criteria**:
- ✓ Cannot modify SSO providers when SSO is only method and no fallback
- ✓ Enabling `allow_root` allows modification

---

## Phase 5: Error Handling

### 5.1 Error Code Summary

| Error Code | Trigger | Expected Response |
|------------|---------|-------------------|
| `AUTH_UPGRADE_REQUIRED` | Auth method not in allowed list | 403 with required_methods |
| `AUTH_SSO_DENIED` | SSO disabled or provider inactive | 403 with message |
| `AUTH_DOMAIN_DENIED` | Email domain not in verified list | 403 with message |

---

### 5.2 Frontend Error Handling

**Steps**:
1. Trigger `AUTH_UPGRADE_REQUIRED` → Verify redirect to `/auth?auth_error=upgrade_required`
2. Trigger `AUTH_SSO_DENIED` → Verify sign out and redirect to `/auth?auth_error=sso_denied`
3. Trigger `AUTH_DOMAIN_DENIED` → Verify sign out and redirect to `/auth?auth_error=domain_denied`

**Pass Criteria**:
- ✓ Each error code triggers appropriate frontend behavior
- ✓ Error messages displayed to user

---

## Phase 6: Edge Cases

### 6.1 Policy Change During Active Session

**Steps**:
1. User logs in with `["email:otp"]`
2. Org flags: `allow_email=true` → User can access
3. Admin changes to `allow_email=false`, `allow_sso=true`
4. User makes new request → 403 AUTH_UPGRADE_REQUIRED
5. User adds SSO identity → Can access again

**Pass Criteria**:
- ✓ Policy changes apply immediately
- ✓ No need to invalidate sessions

---

### 6.2 Domain Added After `domains_only` Enabled

**Steps**:
1. Enable `domains_only=true` with no verified domains
2. Try to invite user → 400 "No verified domains exist"
3. Add and verify domain
4. Invite user with matching domain → Success

**Pass Criteria**:
- ✓ Graceful handling when no domains verified
- ✓ New domains immediately usable

---

### 6.3 User Joined Before `domains_only` Enabled

**Steps**:
1. User with `user@gmail.com` joins org (domains_only=false)
2. Admin enables `domains_only=true` with only `acme.com` verified
3. User tries to access org → 403 AUTH_DOMAIN_DENIED

**Pass Criteria**:
- ✓ Existing members blocked if domain no longer allowed
- ✓ Clear error message

---

## Manual Test Checklist

### OSS Mode
- [ ] Email OTP flow works end-to-end
- [ ] Google OAuth works
- [ ] GitHub OAuth works
- [ ] Multi-method login accumulates identities
- [ ] SSO endpoints return 404 (EE only feature)

### EE Mode - Flags
- [ ] `allow_email` enforcement works
- [ ] `allow_social` enforcement works
- [ ] `allow_sso` enforcement works
- [ ] `allow_root` owner bypass works
- [ ] `domains_only` restriction works
- [ ] `auto_join` works for verified domain users

### EE Mode - SSO
- [ ] Provider setup complete
- [ ] Discovery shows SSO providers
- [ ] SSO authentication flow works
- [ ] `AUTH_SSO_DENIED` on disabled provider

### EE Mode - Domains
- [ ] Domain verification works
- [ ] Invitation validation with `domains_only`
- [ ] `AUTH_DOMAIN_DENIED` for non-verified domains

### Safety Mechanisms
- [ ] Lockout prevention (auto `allow_root`)
- [ ] Provider modification guard

### Error Codes
- [ ] `AUTH_UPGRADE_REQUIRED` triggers correctly
- [ ] `AUTH_SSO_DENIED` triggers correctly
- [ ] `AUTH_DOMAIN_DENIED` triggers correctly
- [ ] Frontend handles all error codes

---

## Success Criteria

✓ **All core flows work** in both OSS and EE modes
✓ **Flag enforcement** works correctly
✓ **Safety mechanisms** prevent lockout
✓ **Error handling** provides clear, actionable messages
✓ **Edge cases** handled gracefully
