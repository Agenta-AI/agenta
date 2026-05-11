# Authentication Documentation Plan

## Executive Summary

This document outlines a comprehensive plan to document Agenta's advanced authentication features for both self-hosted and enterprise customers. The plan is based on:

1. **Current implementation** (from `./designs/advanced-auth/*.specs.md`)
2. **Best practices** from LangFuse, LangSmith/LangGraph, and LangChain
3. **Gap analysis** between current docs and implementation

---

## Current State Assessment

### What We Have (Implementation Specs)

✅ **Complete technical specifications:**
- Organization flags and policies (`auth.flags.specs.md`)
- Domain verification via DNS TXT records (`auth.domains.specs.md`)
- SSO provider configuration (`auth.sso.specs.md`)
- Session identity accumulation (`auth.sessions.specs.md`)
- Discovery and authentication flows (`auth.flows.specs.md`)
- Multi-realm architecture (`auth.realms.specs.md`)

✅ **Basic self-hosting docs:**
- Environment variable configuration (`docs/self-host/02-configuration.mdx`)
- OAuth provider client ID/secret settings
- SuperTokens connection settings

### What's Missing (Documentation Gaps)

❌ **User-facing authentication documentation:**
- No guide on account linking concepts
- No explanation of multiple organization access
- No domain verification user guide
- No SSO provider setup guide
- No organization security settings documentation

❌ **Enterprise feature documentation:**
- No enterprise authentication overview
- No compliance/security documentation
- No multi-tenant architecture explanation
- No RBAC documentation beyond basic mentions

❌ **Progressive learning path:**
- No tutorial from basic → enterprise auth
- No troubleshooting guides
- No migration guides (OSS → EE)

---

## Competitive Analysis Summary

### LangFuse Strengths
- **Dual-path documentation**: Separate cloud vs self-hosted paths
- **Feature availability tables**: Clear tier comparison
- **Security warnings**: Explicit callouts for dangerous options
- **Provider-specific guides**: Separate sections per OAuth provider

### LangSmith Strengths
- **Conceptual hierarchy**: Org → Workspace → Resource model explained upfront
- **Tutorial progression**: Basic → Advanced → Production OAuth2
- **API-driven emphasis**: Programmatic management throughout
- **Full-stack templates**: Working OAuth2 implementations

### LangGraph Strengths
- **Custom auth focus**: `@auth.authenticate` decorator pattern
- **Code examples**: Working implementations provided
- **Resource-level access**: Per-conversation privacy

### What All Three Emphasize
- Compliance certifications prominently displayed
- Clear feature tier differentiation
- API-driven automation capabilities
- Deployment flexibility options
- Data isolation and security controls

---

## Proposed Documentation Structure

### 1. Self-Hosting Documentation Path

Location: `/docs/self-host/authentication/`

```
self-host/
├── authentication/
│   ├── 01-overview.mdx              [NEW]
│   ├── 02-email-authentication.mdx  [NEW]
│   ├── 03-social-oauth.mdx          [NEW]
│   ├── 04-sso-configuration.mdx     [NEW]
│   ├── 05-account-linking.mdx       [NEW]
│   └── 06-troubleshooting.mdx       [NEW]
```

### 2. Enterprise Documentation Path

Location: `/docs/enterprise/` (NEW SECTION)

```
enterprise/
├── 01-overview.mdx                  [NEW]
├── 02-organizations.mdx             [NEW]
├── 03-domain-verification.mdx       [NEW]
├── 04-sso-providers.mdx             [NEW]
├── 05-rbac.mdx                      [NEW]
├── 06-security-compliance.mdx       [NEW]
└── guides/
    ├── okta-integration.mdx         [NEW]
    ├── azure-ad-integration.mdx     [NEW]
    └── google-workspace-sso.mdx     [NEW]
```

### 3. Concepts Documentation

Location: `/docs/concepts/authentication/` (NEW)

```
concepts/
└── authentication/
    ├── account-linking.mdx          [NEW]
    ├── session-identities.mdx       [NEW]
    ├── multi-organization.mdx       [NEW]
    └── auth-upgrade-flow.mdx        [NEW]
```

---

## Detailed Content Plan

## Part 1: Self-Hosting Authentication

### 01-overview.mdx

**Purpose**: High-level introduction to authentication options

**Content**:
- What authentication methods are supported
- How authentication differs from authorization
- Architecture diagram (user → session → identity → org access)
- Quick decision tree: "Which auth method is right for you?"
- Links to detailed guides

**Inspired by**: LangFuse's dual-path approach, LangSmith's overview page

**Key elements**:
- Feature availability table (OSS vs EE)
- Visual architecture diagram
- Quick-start links for common scenarios

---

### 02-email-authentication.mdx

**Purpose**: Guide to email/password and OTP authentication

**Content**:
1. **Email + Password**
   - Environment variables: `SUPERTOKENS_EMAIL_DISABLED=false`
   - How users sign up and sign in
   - Password requirements and security
   - How to disable: `SUPERTOKENS_EMAIL_DISABLED=true`

2. **Email + OTP (One-Time Password)**
   - When to use OTP vs password
   - Email provider configuration (SendGrid, etc.)
   - Testing OTP flows in development
   - Rate limiting and security

3. **Security Best Practices**
   - Session timeout configuration
   - Email verification requirements
   - Preventing enumeration attacks

**Inspired by**: LangFuse's progressive disclosure (start simple, add complexity)

**Key elements**:
- Configuration examples
- Security warnings (enumeration, brute force)
- Testing guidance

---

### 03-social-oauth.mdx

**Purpose**: Configure social login (Google, GitHub, etc.)

**Content**:
1. **Supported Providers**
   - List of 15+ providers with icons
   - Feature comparison (standard OAuth vs Workspace-specific)

2. **Provider Setup Guides** (collapsible sections)
   - **Google**: Creating OAuth app, scopes, verified domain setup
   - **GitHub**: App registration, organization access
   - **Microsoft Azure AD**: App registration, tenant configuration
   - _(Repeat for each provider)_

3. **Environment Variables**
   ```bash
   GOOGLE_OAUTH_CLIENT_ID=your-client-id
   GOOGLE_OAUTH_CLIENT_SECRET=your-secret
   ```

4. **Account Linking**
   - What is account linking?
   - Security implications
   - When to enable/disable
   - Configuration: (link to detailed account-linking.mdx)

**Inspired by**: LangFuse's provider-specific examples

**Key elements**:
- Per-provider setup instructions
- Visual guide (screenshots of OAuth app creation)
- Warning callouts for security risks

---

### 04-sso-configuration.mdx

**Purpose**: Enterprise SSO setup (OIDC/SAML)

**Content**:
1. **What is SSO?**
   - Difference between social OAuth and enterprise SSO
   - When to use SSO
   - Requirements (EE license)

2. **OIDC Provider Setup**
   - Organization-level SSO providers (not global)
   - Creating provider in UI: Settings → Security → Providers
   - Testing provider connection
   - Activating provider

3. **Provider Configuration**
   - Issuer URL
   - Client ID and Secret
   - Scopes (openid, email, profile)
   - Callback URLs

4. **SSO Enforcement**
   - Organization flags: `allow_sso`, `allow_email`, `allow_social`
   - Gradual rollout strategy
   - Preventing owner lockout with `allow_root`

5. **SSO Lifecycle**
   - Phase 0: No SSO
   - Phase 1: SSO available (optional)
   - Phase 2: SSO encouraged
   - Phase 3: SSO required
   - Phase 4: Provider rotation

**Inspired by**: LangFuse's SSO lifecycle phases, LangSmith's OIDC guides

**Key elements**:
- Step-by-step setup wizard
- Phase progression diagram
- Safety mechanisms explanation
- Provider rotation guide

---

### 05-account-linking.mdx

**Purpose**: Deep dive on account linking security and configuration

**Content**:
1. **What is Account Linking?**
   - Scenario: User signs in with Google, then email
   - How identities accumulate in session
   - Benefits: Seamless multi-method access
   - Risks: Account takeover via unverified email

2. **How Account Linking Works**
   - Session identity accumulation model
   - Example flow: email:otp → social:google → sso:acme
   - When identities are added vs removed

3. **Security Considerations**
   - ⚠️ **WARNING**: Only link accounts from verified sources
   - Email verification requirement
   - Preventing account takeover scenarios
   - When to disable account linking

4. **Configuration**
   - Global vs per-provider linking settings
   - Environment variables (if applicable)
   - UI settings (if implemented)

**Inspired by**: LangFuse's explicit security warnings

**Key elements**:
- Clear security warnings
- Visual flow diagrams
- Example attack scenarios
- Best practice checklist

---

### 06-troubleshooting.mdx

**Purpose**: Common authentication issues and solutions

**Content**:
1. **Common Issues**
   - "Authentication failed" errors
   - OAuth callback errors
   - Session expiration issues
   - SSO provider connection failures

2. **Error Codes**
   - `AUTH_UPGRADE_REQUIRED`: What it means, how to resolve
   - `AUTH_SSO_DENIED`: Provider inactive or disabled
   - `AUTH_DOMAIN_DENIED`: Email domain not verified

3. **Debugging Steps**
   - Checking environment variables
   - Verifying provider configuration
   - Testing OAuth callback URLs
   - Inspecting session payload

4. **Logs and Monitoring**
   - Key log messages to watch for
   - SuperTokens dashboard access
   - Session debugging tools

**Inspired by**: All three platforms have detailed troubleshooting

**Key elements**:
- Error code reference table
- Step-by-step debugging guides
- Common misconfigurations
- Support contact information

---

## Part 2: Enterprise Documentation

### 01-overview.mdx

**Purpose**: Enterprise authentication capabilities overview

**Content**:
1. **Enterprise Features**
   - SSO providers (OIDC/SAML)
   - Domain verification
   - Organization-level RBAC
   - Compliance certifications (if applicable)

2. **Multi-Organization Architecture**
   - Users can belong to multiple organizations
   - Each organization has own security policies
   - Authentication accumulates identities
   - Authorization checks per-organization

3. **Getting Started**
   - Prerequisites (EE license)
   - Migration from OSS
   - Setting up first organization
   - Inviting users

**Inspired by**: LangSmith's hierarchical model explanation

**Key elements**:
- Architecture diagram: User → Orgs → Projects
- Feature comparison table (OSS vs EE)
- Migration guide link

---

### 02-organizations.mdx

**Purpose**: Understanding organization structure and access control

**Content**:
1. **Organization Hierarchy**
   - Organizations contain projects and members
   - No "personal" vs "collaborative" distinction (all collaborative)
   - Organization slug in URL: `/w/{workspace_id}`

2. **Organization Security Policies**
   - Flags stored in `organizations.flags`
   - Per-organization auth method control
   - Domain restrictions
   - Auto-join for verified domains

3. **Organization Flags Reference**
   | Flag | Default | Purpose |
   |------|---------|---------|
   | `allow_email` | env default | Email/OTP authentication |
   | `allow_social` | env default | Social OAuth |
   | `allow_sso` | false | SSO providers |
   | `allow_root` | false | Owner bypass |
   | `domains_only` | false | Restrict to verified domains |
   | `auto_join` | false | Auto-add verified domain users |

4. **Switching Between Organizations**
   - How users navigate between orgs
   - What triggers `AUTH_UPGRADE_REQUIRED`
   - Example: Switching from email-only org to SSO-only org

**Inspired by**: LangSmith's workspace concept, LangFuse's RBAC hierarchy

**Key elements**:
- Flag reference table
- Organization switching flow diagram
- Multi-org access scenarios

---

### 03-domain-verification.mdx

**Purpose**: Guide to verifying email domains

**Content**:
1. **What is Domain Verification?**
   - Establishes organizational authority over email domain
   - Required for `domains_only` and `auto_join` features
   - One domain = one organization globally

2. **Verification Process**
   - Step 1: Add domain in Settings → Security → Domains
   - Step 2: Get verification token
   - Step 3: Add DNS TXT record
     ```
     _agenta-verification.acme.com TXT "agenta-verify=abc123xyz"
     ```
   - Step 4: Click "Verify" button
   - Step 5: Domain status changes to "Verified"

3. **DNS Configuration Examples**
   - Cloudflare
   - Route53
   - Google Domains
   - Namecheap

4. **Using Verified Domains**
   - **domains_only=true**: Only verified domain users can access
   - **auto_join=true**: Auto-add users with matching domain
   - Multiple domains per organization

5. **Troubleshooting**
   - DNS propagation delays (up to 48 hours)
   - Token refresh
   - Verification failure reasons
   - Resetting verification

**Inspired by**: LangFuse's domain enforcement patterns

**Key elements**:
- Step-by-step verification guide
- DNS provider screenshots
- Verification status indicators
- Troubleshooting decision tree

---

### 04-sso-providers.mdx

**Purpose**: Enterprise SSO provider management

**Content**:
1. **SSO Provider Lifecycle**
   - Creating providers (per-organization, not global)
   - Testing connection
   - Activating provider
   - Rotating credentials
   - Disabling/replacing provider

2. **Provider Configuration**
   - Issuer URL
   - Client ID and Client Secret
   - Scopes (openid, email, profile)
   - Secret storage (encrypted `secret_id`)

3. **Provider Flags**
   - `is_active`: Provider enabled for use
   - `is_valid`: Configuration tested successfully

4. **SSO Enforcement Strategy**
   - **Phase 1**: SSO optional (`allow_sso=true`, `allow_email=true`)
   - **Phase 2**: UI prioritizes SSO
   - **Phase 3**: SSO required (`allow_email=false`, `allow_social=false`)
   - **Phase 4**: Provider rotation

5. **Safety Mechanisms**
   - `allow_root` prevents owner lockout
   - Cannot disable SSO without alternative auth
   - Must have active+valid provider to enforce SSO

6. **Session Identities**
   - Format: `sso:{org_slug}:{provider_slug}`
   - Example: `sso:acme:okta`
   - Identity persists across sessions
   - Identity removed when provider disabled

**Inspired by**: LangFuse's SSO lifecycle, LangSmith's SAML setup

**Key elements**:
- Lifecycle phase diagram
- Safety mechanism explanations
- Provider rotation guide
- Identity format reference

---

### 05-rbac.mdx

**Purpose**: Role-Based Access Control

**Content**:
1. **Role Hierarchy** (if implemented)
   - Organization Owner
   - Organization Admin
   - Organization Member
   - Organization Viewer
   - (Custom roles if supported)

2. **Permission Matrix**
   | Role | Manage SSO | Verify Domains | Invite Users | View Data |
   |------|-----------|----------------|--------------|-----------|
   | Owner | ✓ | ✓ | ✓ | ✓ |
   | Admin | ✓ | ✓ | ✓ | ✓ |
   | Member | ✗ | ✗ | Limited | ✓ |
   | Viewer | ✗ | ✗ | ✗ | ✓ |

3. **Managing Roles**
   - Assigning roles to users
   - Changing user roles
   - Role inheritance
   - API key scoping

4. **Owner Privileges**
   - `allow_root` flag bypasses auth restrictions
   - Cannot be removed (must transfer ownership)
   - Always has full access

**Inspired by**: LangFuse's 5-role system, LangSmith's workspace RBAC

**Key elements**:
- Permission matrix table
- Role assignment workflow
- Owner transfer process

---

### 06-security-compliance.mdx

**Purpose**: Security features and compliance information

**Content**:
1. **Security Features**
   - Encrypted secret storage
   - Session management and timeout
   - Rate limiting
   - Audit logs (if implemented)

2. **Compliance** (if applicable)
   - SOC 2 Type II
   - ISO 27001
   - GDPR compliance
   - HIPAA compliance

3. **Data Residency** (if multi-region)
   - Region selection
   - Data location guarantees

4. **Security Best Practices**
   - Rotating secrets regularly
   - Enabling MFA (if supported)
   - Monitoring session activity
   - Reviewing access logs

**Inspired by**: LangFuse's prominent compliance section

**Key elements**:
- Compliance badge display
- Security checklist
- Audit log access guide

---

## Part 3: Concepts Documentation

### account-linking.mdx

**Purpose**: Conceptual explanation of account linking

**Content**:
- What problem does account linking solve?
- How it works technically
- Security tradeoffs
- When to enable/disable
- Visual flow diagrams

**Inspired by**: LangChain's conceptual guides

---

### session-identities.mdx

**Purpose**: Understanding session identity accumulation

**Content**:
1. **What Are Session Identities?**
   - List of verified authentication methods
   - Format: `email:otp`, `social:google`, `sso:acme:okta`
   - Identities accumulate, not replace

2. **How Identities Accumulate**
   - Step 1: User logs in with OTP → `["email:otp"]`
   - Step 2: User logs in with Google → `["email:otp", "social:google"]`
   - Step 3: User accesses SSO org → `["email:otp", "social:google", "sso:acme:okta"]`

3. **Identity Matching**
   - How org policies match against identities
   - Example: `allow_sso=true` requires `sso:*` in identities
   - Why identities don't match: AUTH_UPGRADE_REQUIRED

4. **Identity Removal**
   - When session ends
   - When credential is revoked
   - When SSO link is broken

**Key elements**:
- Progressive accumulation examples
- Matching algorithm explanation
- Visual state machine diagram

---

### multi-organization.mdx

**Purpose**: How users access multiple organizations

**Content**:
1. **One User, Many Organizations**
   - Users can belong to multiple orgs
   - Each org has independent security policies
   - Single session accumulates identities

2. **Organization Discovery**
   - After login: `GET /api/organizations`
   - Returns all orgs user belongs to
   - Frontend filters by compatible auth method

3. **Switching Organizations**
   - What happens when switching
   - When AUTH_UPGRADE_REQUIRED triggers
   - Example: Email → SSO org requires SSO login

4. **Organization Selection Priority**
   - Auth upgrade state (if exists)
   - Filter by compatible auth method
   - SSO org (if last used)
   - Last used org
   - Preferred workspace
   - Any compatible org

**Key elements**:
- Multi-org access diagram
- Org selection flowchart
- Compatibility filtering explanation

---

### auth-upgrade-flow.mdx

**Purpose**: Understanding authentication upgrade flow

**Content**:
1. **What is Auth Upgrade?**
   - User tries to access org
   - Current session identities don't satisfy policy
   - User must authenticate with required method

2. **When It Happens**
   - Switching to SSO-only organization
   - Organization enables new policy after user logged in
   - Accessing resource requiring specific auth level

3. **The Upgrade Process**
   - Step 1: User receives AUTH_UPGRADE_REQUIRED
   - Step 2: Redirect to `/auth?auth_error=upgrade_required`
   - Step 3: Required methods shown
   - Step 4: User completes required auth
   - Step 5: Identity added to session
   - Step 6: User gains access

4. **Error Messages**
   - `AUTH_UPGRADE_REQUIRED`: Re-authenticate with allowed method
   - `AUTH_SSO_DENIED`: SSO disabled or provider inactive
   - `AUTH_DOMAIN_DENIED`: Email domain not verified

**Key elements**:
- Step-by-step flow diagram
- Error message explanations
- Example scenarios

---

## Part 4: Provider Integration Guides

### okta-integration.mdx

**Purpose**: Step-by-step Okta SSO setup

**Content**:
1. **Prerequisites**
   - Agenta EE license
   - Okta administrator access
   - Verified domain (recommended)

2. **Okta Configuration**
   - Step 1: Create new OIDC application
   - Step 2: Configure redirect URIs
   - Step 3: Set scopes (openid, email, profile)
   - Step 4: Get Client ID and Secret

3. **Agenta Configuration**
   - Step 1: Navigate to Settings → Security → Providers
   - Step 2: Add new provider
   - Step 3: Enter Okta details
   - Step 4: Test connection
   - Step 5: Activate provider

4. **Enable SSO Enforcement** (optional)
   - Update organization flags
   - Gradual rollout plan
   - Testing with subset of users

5. **Troubleshooting**
   - Common Okta errors
   - Redirect URI mismatches
   - Scope issues

**Inspired by**: LangFuse's Okta guide with troubleshooting

**Key elements**:
- Screenshots for each step
- Copy-paste configuration values
- Troubleshooting decision tree

---

### azure-ad-integration.mdx

**Purpose**: Step-by-step Azure AD SSO setup

**Content**:
- Similar structure to Okta guide
- Azure AD-specific steps
- App registration process
- Tenant configuration
- Troubleshooting

---

### google-workspace-sso.mdx

**Purpose**: Google Workspace SSO setup

**Content**:
- Google Workspace admin console setup
- OAuth vs SAML options
- Domain verification with Google
- Testing SSO
- Troubleshooting

---

## Implementation Priorities

### Phase 1: Foundation (Week 1-2)
1. ✅ Self-host authentication overview
2. ✅ Email authentication guide
3. ✅ Social OAuth configuration
4. ✅ Account linking concepts

**Rationale**: Cover 80% of self-hosted users' needs

### Phase 2: Enterprise Basics (Week 3-4)
1. ✅ Enterprise overview
2. ✅ Organizations guide
3. ✅ SSO configuration
4. ✅ Domain verification

**Rationale**: Enable enterprise customers to set up SSO

### Phase 3: Advanced Concepts (Week 5)
1. ✅ Session identities deep dive
2. ✅ Multi-organization access
3. ✅ Auth upgrade flow
4. ✅ RBAC documentation

**Rationale**: Help users understand complex behaviors

### Phase 4: Provider Guides (Week 6+)
1. ✅ Okta integration
2. ✅ Azure AD integration
3. ✅ Google Workspace integration
4. ⏳ Additional providers as needed

**Rationale**: Provider-specific guides reduce support burden

---

## Documentation Standards

### Writing Style
- **Progressive disclosure**: Start simple, add complexity
- **Active voice**: "Configure the provider" not "The provider should be configured"
- **Task-oriented**: Focus on what users need to do
- **Scannable**: Use headings, bullets, tables

### Visual Elements
- **Architecture diagrams**: Show system components and flow
- **Screenshots**: Annotate with arrows and highlights
- **Code examples**: Syntax-highlighted, copy-paste ready
- **Warning callouts**: Security and safety warnings

### Navigation
- **Breadcrumbs**: Show page hierarchy
- **Next/Previous**: Guide users through learning path
- **Related links**: Link to related concepts
- **Search optimization**: Use keywords users search for

### Testing
- **Technical accuracy**: Verify all steps work
- **Link validation**: No broken links
- **Version compatibility**: Note version requirements
- **User testing**: Have non-experts review

---

## Success Metrics

### Documentation Coverage
- ✅ All features documented
- ✅ All error codes explained
- ✅ All providers have guides
- ✅ Troubleshooting for common issues

### User Success
- Reduced support tickets for auth issues
- Faster SSO setup time
- Higher SSO adoption rate
- Positive documentation feedback

### Search and Discovery
- Users find answers via search
- Low bounce rate on docs pages
- High time-on-page for guides
- Positive NPS for documentation

---

## Maintenance Plan

### Regular Updates
- **Quarterly review**: Update for new features
- **Version notes**: Document breaking changes
- **Provider updates**: Update when providers change APIs
- **Screenshot refresh**: Keep UI screenshots current

### Community Contributions
- Accept community PRs for docs
- Community-contributed provider guides
- Translation support (if needed)

### Analytics
- Track most-viewed pages
- Identify gaps in documentation
- Monitor search queries
- Analyze user flow through docs

---

## Conclusion

This documentation plan transforms our internal technical specifications into user-facing documentation that:

1. **Educates** users on authentication concepts
2. **Guides** self-hosted admins through configuration
3. **Enables** enterprise customers to implement SSO
4. **Troubleshoots** common authentication issues
5. **Scales** with our product growth

By following best practices from LangFuse, LangSmith, and LangGraph, we create documentation that is:
- **Progressive**: Start simple, add complexity
- **Visual**: Diagrams and screenshots
- **Practical**: Working examples and guides
- **Safe**: Security warnings and best practices

The phased implementation approach ensures we deliver value quickly while building toward comprehensive coverage.
