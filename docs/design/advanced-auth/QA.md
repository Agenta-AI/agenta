# Advanced Auth QA

Manual QA checklist for advanced authentication flows. Use alongside the specs in this folder.

---

## Account Sign-On, Linking, and Switching

### New user sign-up (email)
- Preconditions: No existing user for email.
- Steps: Discover → sign up with email/password.
- Expected: Personal org created, session identities include `email:password`, profile loads.

### Existing user login (email/social/SSO)
- Preconditions: User already has at least one identity.
- Steps: Login with each available method.
- Expected: Session identities include current method; user identities include all known methods.

### Identity linking (multi-method)
- Preconditions: User has `email:password`, `social:google`, `sso:org:provider` available.
- Steps: Login with one method, then login with another method.
- Expected: Session identities accumulate; user identities persist across logins.

### Org switching with upgrade required
- Preconditions: User logged in with method not allowed by target org.
- Steps: Switch org from sidebar.
- Expected: Auth upgrade modal opens; no redirect until auth completes; switch blocked.

### Org switching with domain denied
- Preconditions: User email domain A, target org `domains_only` with verified domain B.
- Steps: Switch org from sidebar.
- Expected: Single toast “Only verified domains are allowed…”, no redirect, stay on current org.

---

## Verified Domain Configuration

### Add domain + verify
- Preconditions: Org with `allow_email` true.
- Steps: Add domain, copy TXT token, publish DNS, verify.
- Expected: Domain marked verified; token stored for audit; verification idempotent.

### Refresh/reset domain token (unverified vs verified)
- Preconditions: Have unverified and verified domains.
- Steps: Refresh token for unverified; reset verified domain to unverified.
- Expected: Token refresh allowed only for unverified; reset returns to unverified.

### Domains-only/auto-join flag validation
- Preconditions: No verified domains.
- Steps: Enable `domains_only` or `auto_join`.
- Expected: Block with clear error; UI shows disabled state with tooltip.

---

## Verified Domain Enforcement

### Domains-only access check
- Preconditions: Org has `domains_only=true`, verified domain B.
- Steps: Access org with user email domain A.
- Expected: `AUTH_DOMAIN_DENIED`, no org switch, no logout.

### Invite restriction (domains-only)
- Preconditions: Org has `domains_only=true`, verified domain B.
- Steps: Invite user with domain A.
- Expected: Invite blocked; toast “Only verified domains are allowed in this organization.”

### Auto-join
- Preconditions: Org has `auto_join=true`, verified domain B, user email domain B.
- Steps: Login for new and existing users.
- Expected: Auto-membership created for org; workspace/project membership created with `editor`.

---

## SSO Provider Configuration

### Create provider
- Preconditions: Org has slug set.
- Steps: Add OIDC provider with valid issuer/client/secret.
- Expected: Provider created with flags `is_valid=true`, `is_active` default.

### Enable/disable provider
- Preconditions: Provider exists.
- Steps: Toggle enable/disable.
- Expected: Disabled provider cannot be used for SSO login.

### Allow SSO flag validation
- Preconditions: No active+valid providers.
- Steps: Set `allow_sso=true`.
- Expected: Block with clear error; UI tooltip on disabled control.

---

## SSO Provider Enforcement

### SSO-only org access
- Preconditions: Org has `allow_sso=true`, verified domain, active provider.
- Steps: Login with SSO and access org.
- Expected: Access allowed; non-SSO methods prompt upgrade.

### SSO denied
- Preconditions: Session identity is SSO but provider inactive or org disallows SSO.
- Steps: Access org.
- Expected: `AUTH_SSO_DENIED`, no access, clear message.

---

## Multi-Organization Checks (OSS and EE)

### OSS baseline
- Preconditions: OSS mode, multiple orgs.
- Steps: Switch between orgs with different flags.
- Expected: No EE-only enforcement; access follows OSS rules.

### EE enforcement
- Preconditions: EE mode, multiple orgs with mixed policies.
- Steps: Switch across orgs with `allow_email/social/sso`, `domains_only`, `auto_join`.
- Expected: Enforcement matches flags; upgrade modal and domain restrictions work.

---

## Notes

- Use `AUTH_UPGRADE_REQUIRED`, `AUTH_SSO_DENIED`, `AUTH_DOMAIN_DENIED` responses for validation.
- Validate UI behavior: single toast for domain denied, no redirect/log out, no React errors.
