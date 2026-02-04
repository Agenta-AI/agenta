# Security Documentation Writing Quality Review

**Date:** February 2026  
**Reviewed by:** Claude  
**Documents Analyzed:**
- Agenta: Security Overview, Data Regions, SSO, RBAC
- Langfuse: Security & Compliance Overview
- Braintrust: Security docs

---

## Overall Assessment: 7.5/10 vs Competitors

Agenta's security documentation is **solid and functional** but sits between its competitors in quality:

| Aspect | Agenta | Langfuse | Braintrust |
|--------|--------|----------|------------|
| **Tone** | Professional, slightly dry | Professional, confident | Technical, dense |
| **Structure** | Good hierarchy, well-organized | Excellent navigation, modular | Good sections, concise |
| **Actionability** | Strong (clear steps) | Moderate (overview-heavy) | Moderate (reference-style) |
| **Completeness** | Good coverage, some bloat | Comprehensive but spread | Concise, some gaps |
| **Trust Building** | Moderate | Strong | Strong |

**Verdict:** Agenta has better actionability than competitors (especially SSO/RBAC), but lacks the confidence and social proof that makes Langfuse's docs inspiring, and has more unnecessary technical detail than Braintrust's lean approach.

---

## 1. Tone & Voice Analysis

### Agenta: Professional but Slightly Impersonal

**Current tone:** Technical, informative, neutral. Reads like documentation rather than a conversation.

**Examples of current tone:**
```
"Agenta is built with security at its core."
"All sensitive data stored in Agenta is encrypted at rest using AES-256 encryption"
```

**What's missing:** The "why it matters to you" framing that builds trust.

### Langfuse: Confident and Trust-Building

**Their approach:** Leads with values, backs with proof.

```
"At Langfuse, we prioritize data privacy and security. We understand that the 
data you entrust to us is a vital asset to your business."
```

Then immediately follows with social proof:
```
"Trusted by 19 of the Fortune 50 and 63 of the Fortune 500 companies."
```

### Braintrust: Technical and Efficient

**Their approach:** Direct, no fluff, assumes technical reader.

```
"Braintrust implements industry-leading security practices and maintains 
compliance with key standards to protect your data."
```

### Recommendation for Agenta

**Current:** "Agenta is built with security at its core."

**Better:** "Your prompts, evaluation data, and observability traces are business-critical assets. Agenta protects them with the same security standards used by Fortune 500 companies."

---

## 2. Structure & Scannability Analysis

### What Agenta Does Well

1. **Excellent use of tables** (RBAC permissions matrix is exemplary)
2. **Clear hierarchy** with consistent heading structure
3. **Good info boxes** (warnings, tips)
4. **Logical document organization**

### What Competitors Do Better

**Langfuse:** Modular navigation with dedicated pages per topic
- Their security section has 15+ focused pages vs. Agenta's 4 broader pages
- Easier to link to specific topics ("see our encryption page")
- Better for SEO and discoverability

**Braintrust:** Inline links to deeper content
- Every section links to relevant docs (e.g., "[Access control](/admin/access-control) for configuration details")
- Creates a web of interconnected documentation

### Specific Issues in Agenta Docs

**Data Regions page** has infrastructure details that break scannability:

```
### Database

- **Engine**: Aurora PostgreSQL
- **Backup retention**: 7 days
- **Backup window**: 03:30-05:30 UTC
- **Deletion protection**: Enabled
```

**Who cares about backup windows?** This is over-detailed for a data regions page.

---

## 3. Actionability Analysis

### Agenta Excels Here

The **SSO documentation is excellent** - best-in-class for the three compared:

**What works:**
- Clear prerequisites section
- Numbered step-by-step instructions
- Provider-specific guides (Okta, Azure AD, Google)
- Troubleshooting section with causes and solutions
- Phased rollout recommendations

**Example of great actionable content:**
```markdown
### Step 1: Configure Your Identity Provider

Create an OIDC application in your IdP with these settings:

| Setting | Value |
|---------|-------|
| **Application Type** | Web Application |
| **Grant Type** | Authorization Code |
| **Redirect URI** | `https://{region}.cloud.agenta.ai/auth/callback/sso:{org}:{provider}` |
```

This is genuinely helpful - users can copy-paste and configure.

### Where Actionability is Lacking

**Security Overview** has no actionable steps for most sections:

```markdown
### Cloud Infrastructure

Agenta Cloud runs on AWS with SOC 2 compliant infrastructure:

- **Network isolation**: Dedicated VPCs with public/private subnet separation
- **Multi-AZ deployment**: High availability across 2 availability zones
...
```

**Problem:** This tells users what Agenta does, not what users should do or verify.

**Competitors handle this better:**

Braintrust links to action:
```
"See [Access control](/admin/access-control) for configuration details."
```

Langfuse segments into user-actionable pages:
```
"Managing Personal Data" - a dedicated page for what users can do
```

---

## 4. Completeness vs Bloat Analysis

### Unnecessary Content to Remove

#### Data Regions Page - Infrastructure Over-Detail

**Remove or move to a technical reference:**

```markdown
### Database

- **Engine**: Aurora PostgreSQL
- **Backup retention**: 7 days
- **Backup window**: 03:30-05:30 UTC
- **Deletion protection**: Enabled
```

**Why:** Users choosing a region don't need to know backup windows. This is internal infrastructure detail.

Also remove:
```markdown
- **NAT Gateway per AZ**: Redundant networking
```

**Why:** Users don't care about NAT gateways. They care about reliability, which you can state without implementation details.

#### Security Overview - SSL Policy Version

**Remove:**
```markdown
- Load balancer SSL policy: `ELBSecurityPolicy-2016-08`
```

**Why:** Nobody reading security docs needs to know your specific AWS SSL policy name. Just say "TLS 1.2+ enforced" if version matters.

### Missing Content to Add

#### 1. Trust Signals (High Priority)

Langfuse leads with:
```
"Trusted by 19 of the Fortune 50 and 63 of the Fortune 500 companies."
"21,496 GitHub stars, 23.1M+ SDK installs per month"
```

**Agenta should add:**
- Customer count or tier (e.g., "Trusted by 100+ companies including...")
- Any notable customers (with permission)
- Download/usage statistics

#### 2. Compliance Summary Table (High Priority)

Braintrust has a clear compliance section. Agenta mentions SOC 2 but doesn't make it scannable.

**Add to Security Overview:**

```markdown
## Compliance Certifications

| Certification | Status | Details |
|---------------|--------|---------|
| **SOC 2 Type II** | Certified | [View details](/docs/administration/security/compliance) |
| **GDPR** | Compliant | EU data region available |
| **HIPAA** | Available | Contact sales |
```

#### 3. Data Handling Clarity (Medium Priority)

Langfuse has a dedicated "Managing Personal Data" page covering:
- How to delete user data
- Data masking options
- Data retention policies

**Agenta should add:** A section on what happens to data, how to export it, and how to delete it.

#### 4. Third-Party AI Features Disclosure (Medium Priority)

Langfuse has a dedicated page explaining AI features and data handling:
```
"AI Features" page explaining what data goes where
```

If Agenta uses any AI features that process user data, this should be disclosed.

#### 5. Responsible Disclosure Policy (Low Priority)

Current Agenta:
```markdown
## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:

- **Email**: security@agenta.ai
- **Response time**: We aim to acknowledge reports within 24 hours
```

**This is minimal.** Langfuse has a full responsible disclosure page. Consider expanding with:
- Scope (what's in/out of bounds)
- Bug bounty information (if any)
- Hall of fame / acknowledgments

---

## 5. Trust Building Analysis

### Agenta's Trust Gaps

**1. No social proof**
- No customer logos
- No usage statistics
- No testimonials

**2. Passive language reduces confidence**

Current: "We aim to acknowledge reports within 24 hours"

Better: "We acknowledge reports within 24 hours"

**3. Missing certifications visibility**

The Trust Center link is buried. Certifications should be front-and-center.

### What Competitors Do Well

**Langfuse builds trust through:**
1. Specific numbers: "21,496 GitHub stars"
2. Customer tier: "Fortune 50"
3. Certification badges prominently displayed
4. Multiple contact channels for different concerns

**Braintrust builds trust through:**
1. Trust Center link at the very top
2. Direct, confident language
3. Specific compliance details (BAA, DPA availability)
4. No hedging words

---

## Specific Examples of Good Writing in Agenta Docs

### 1. SSO Phased Rollout (Excellent)

```markdown
### Gradual Rollout

We recommend a phased approach to SSO adoption:

#### Phase 1: SSO Available (Optional)
...
#### Phase 2: SSO Encouraged
- Same settings as Phase 1
- Communicate to users: "Please start using SSO"
- Monitor adoption

#### Phase 3: SSO Required
```

**Why it works:** Practical, acknowledges real-world rollout challenges, gives specific advice.

### 2. RBAC Permissions Matrix (Excellent)

The permissions tables in RBAC are exemplary:

```markdown
| Permission | Owner | Admin | Editor | Viewer | Evaluator | Deployment Mgr |
|------------|:-----:|:-----:|:------:|:------:|:---------:|:--------------:|
| View applications | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
```

**Why it works:** Scannable, complete, uses visual markers, answers "can X do Y?" instantly.

### 3. SSO Troubleshooting (Good)

```markdown
### "Redirect URI mismatch"

**Cause:** The redirect URI in Agenta doesn't match your IdP configuration

**Solution:**
1. Check the exact redirect URI format
2. Update your IdP to match: `https://{region}.cloud.agenta.ai/auth/callback/sso:{org}:{provider}`
3. Ensure no trailing slashes or typos
```

**Why it works:** Clear problem-cause-solution format, actionable steps.

### 4. Region Selection Warning (Good)

```markdown
:::warning[Region Selection is Permanent]
Your region cannot be changed after account creation. Choose carefully based on your compliance and performance needs.
:::
```

**Why it works:** Critical information highlighted appropriately.

---

## Specific Examples of Poor Writing in Agenta Docs

### 1. Security Overview Opening (Weak)

**Current:**
```markdown
Agenta is built with security at its core. We protect your prompts, evaluation 
data, and observability traces using industry-standard encryption and security practices.
```

**Problems:**
- Generic ("security at its core" - everyone says this)
- No differentiation
- No proof

**Suggested Rewrite:**
```markdown
Your prompts, evaluation data, and observability traces are competitive advantages. 
Agenta protects them with enterprise-grade security: SOC 2 Type II certified, 
AES-256 encryption, and isolated data regions in the EU and US.

**[View our Trust Center](https://trustcenter.agenta.ai/)** | 
**[Request security documentation](mailto:security@agenta.ai)**
```

### 2. Infrastructure Details Section (Over-detailed)

**Current:**
```markdown
### High Availability

Both regions are deployed with high availability:

- **Multi-AZ deployment**: Resources span 2 availability zones
- **NAT Gateway per AZ**: Redundant networking
- **Load balancing**: Application Load Balancer with health checks
```

**Problems:**
- NAT Gateway is implementation detail users don't care about
- "2 availability zones" - is that good? Users don't know.
- No SLA or uptime commitment

**Suggested Rewrite:**
```markdown
### High Availability

Both regions provide 99.9% uptime with:

- **Multi-region redundancy**: Automatic failover to backup region
- **Zero-downtime deployments**: Updates without service interruption
- **Real-time monitoring**: [Status page](https://agenta.hyperping.app/) with incident history
```

### 3. Encryption Section (Too AWS-specific)

**Current:**
```markdown
- Load balancer SSL policy: `ELBSecurityPolicy-2016-08`
- TLS certificates managed via AWS Certificate Manager
```

**Problems:**
- AWS-specific details don't build trust
- Policy name is meaningless to most readers
- Doesn't explain what users get

**Suggested Rewrite:**
```markdown
- **TLS 1.2+** enforced on all connections
- **Automatic certificate rotation** prevents expiration issues
```

### 4. Data Regions FAQ (Could Be More Helpful)

**Current:**
```markdown
### Does region affect pricing?

No, pricing is the same across all regions.
```

**Problem:** This is fine but misses opportunity.

**Suggested Rewrite:**
```markdown
### Does region affect pricing?

No. You get the same pricing, features, and SLA regardless of region. 
Choose based on compliance needs and team location, not cost.
```

---

## Summary of Recommended Changes

### High Priority

1. **Add social proof** to Security Overview (customer count, logos, stats)
2. **Add compliance summary table** with certification status
3. **Rewrite opening paragraphs** to lead with value, not features
4. **Remove AWS-specific details** (NAT gateways, SSL policy names, backup windows)

### Medium Priority

5. **Add data management section** (export, deletion, retention)
6. **Expand responsible disclosure** policy
7. **Make Trust Center link more prominent** (badge or callout, not buried)
8. **Add "why this matters" context** to technical sections

### Low Priority

9. **Consider splitting** Data Regions into user-facing vs. technical reference
10. **Add diagrams** for architecture (competitors have these)
11. **Cross-link more aggressively** between related docs

---

## Content Audit Summary

### Remove/Relocate

| Content | Current Location | Recommendation |
|---------|------------------|----------------|
| NAT Gateway per AZ | Data Regions | Remove |
| Aurora PostgreSQL engine | Data Regions | Remove |
| Backup window times | Data Regions | Remove (or move to SLA doc) |
| `ELBSecurityPolicy-2016-08` | Security Overview | Remove |
| AWS Certificate Manager | Security Overview | Remove |

### Add

| Content | Suggested Location | Priority |
|---------|-------------------|----------|
| Social proof (customer stats) | Security Overview | High |
| Compliance summary table | Security Overview | High |
| Data export/deletion guide | New page or Data Regions | Medium |
| AI features disclosure | Security Overview | Medium |
| Expanded responsible disclosure | Security Overview | Low |
| Architecture diagram | Security Overview | Low |

---

## Final Verdict

Agenta's security documentation is **competent but not compelling**. The SSO and RBAC pages are genuinely excellent - detailed, actionable, and well-structured. However, the Security Overview and Data Regions pages suffer from:

1. Too much internal implementation detail
2. Not enough user-facing value proposition
3. Missing trust signals that competitors leverage effectively

**The fix is relatively simple:** Remove AWS internals, add social proof, and reframe technical facts as user benefits. The bones are good; the presentation needs polish.
