# Security Documentation Comparison Matrix

**Agenta vs Langfuse vs Braintrust**

*Last updated: February 2026*

---

## Executive Summary

| Vendor | Doc Pages | Trust Center | Key Differentiator |
|--------|-----------|--------------|-------------------|
| **Langfuse** | 20+ pages | Vanta-powered | Most comprehensive (DPA, TOMs, subprocessors all published online) |
| **Braintrust** | 1 page | Vanta-powered | Hybrid deployment emphasis, concise but complete |
| **Agenta** | 8 pages | Sprinto-powered | Good foundation, gaps in legal docs |

---

## 1. Compliance & Certifications

| Feature | Agenta | Langfuse | Braintrust |
|---------|--------|----------|------------|
| **SOC 2 Type II** | ✅ Certified | ✅ Certified | ✅ Certified |
| **ISO 27001** | ❌ Not mentioned | ✅ Certified | ❌ Not mentioned |
| **HIPAA** | ❌ "Not currently available" | ✅ Dedicated region + BAA | ✅ BAA available |
| **GDPR** | ✅ Committed | ✅ Full compliance + DPA | ✅ DPA available |
| **Penetration Testing** | ❌ Not mentioned | ✅ Dedicated page | ❌ Not mentioned |
| **Vulnerability Management** | ❌ Not mentioned | ✅ Dedicated page | ❌ Not mentioned |

### Assessment

- **Agenta**: SOC 2 is table stakes. Missing ISO 27001 and HIPAA are significant gaps for enterprise deals.
- **Langfuse**: Gold standard with dedicated pages for pen testing, vulnerability management, responsible disclosure.
- **Braintrust**: Pragmatic - covers SOC 2 and HIPAA which are the most requested.

---

## 2. Encryption

| Feature | Agenta | Langfuse | Braintrust |
|---------|--------|----------|------------|
| **At-rest encryption** | ✅ AES-256 | ✅ AES-256 | ✅ AES-256 |
| **In-transit encryption** | ✅ TLS | ✅ TLS 1.2 | ✅ TLS (implied) |
| **TLS version specified** | ⚠️ Not specified | ✅ TLS 1.2 | ❌ Not specified |
| **Secrets encryption** | ✅ PGP symmetric (AES-256) | ✅ AES-256 | ✅ AES-256 with unique keys/nonces |
| **Key management details** | ⚠️ "AWS managed" | ⚠️ Not detailed | ✅ Cloud KMS for self-hosted |
| **Services encrypted listed** | ✅ PostgreSQL, S3, EBS | ✅ Redis, Postgres, Clickhouse, S3 | ❌ Not listed |

### Assessment

- **Agenta**: Good coverage but should specify TLS version (1.2 minimum).
- **Langfuse**: Clean table format showing encryption per service is effective.
- **Braintrust**: Unique selling point is "unique 256-bit keys and nonces" for secrets.

---

## 3. Data Regions

| Feature | Agenta | Langfuse | Braintrust |
|---------|--------|----------|------------|
| **US region** | ✅ Ohio (us-east-2) | ✅ Oregon (us-west-2) | ✅ Available |
| **EU region** | ✅ Frankfurt (eu-central-1) | ✅ Ireland (eu-west-1) | ❌ Self-host only |
| **HIPAA-dedicated region** | ❌ Not available | ✅ Oregon (us-west-2) | ❌ Not mentioned |
| **Region selection** | ✅ At signup | ✅ Separate accounts | ❓ Not specified |
| **Multi-region for enterprise** | ✅ Mentioned | ✅ Available | ❌ Not mentioned |
| **Backup region disclosed** | ✅ Yes (EU→Ireland, US→Oregon) | ❌ "Cross-region" mentioned | ❌ Not mentioned |
| **Self-hosted option** | ✅ Yes | ✅ Yes (OSS + Enterprise) | ✅ Yes (Hybrid model) |

### Assessment

- **Agenta**: Unique in disclosing backup regions - this is a USP!
- **Langfuse**: Three regions including HIPAA-dedicated is strong.
- **Braintrust**: Relies on hybrid/self-hosted for EU data residency - weaker for pure SaaS.

---

## 4. Access Control

| Feature | Agenta | Langfuse | Braintrust |
|---------|--------|----------|------------|
| **SSO/SAML** | ✅ OIDC (Okta, Azure, Google) | ✅ Yes | ✅ SSO/SAML + OIDC |
| **RBAC** | ✅ 6 roles, detailed matrix | ⚠️ Mentioned, not detailed | ✅ 3 roles + custom groups |
| **Custom roles** | ❌ Not supported | ❓ Not specified | ✅ Custom groups |
| **Domain verification** | ✅ DNS TXT verification | ❌ Not mentioned | ❌ Not mentioned |
| **Auto-join** | ✅ Verified domain users | ❌ Not mentioned | ❌ Not mentioned |
| **Audit logs** | ⚠️ "Track access and changes" | ✅ Dedicated page | ⚠️ "Monitor API key usage" |
| **API key scoping** | ✅ Workspace-scoped | ✅ Project-scoped | ✅ Project-scoped |
| **MFA enforcement** | ⚠️ "Enforce via IdP" | ❓ Not specified | ❓ Not specified |

### Assessment

- **Agenta**: Domain verification + auto-join is a unique differentiator! 6 roles with detailed permission matrix is excellent.
- **Langfuse**: Has dedicated audit logs page - Agenta should add this.
- **Braintrust**: Custom groups is valuable for complex org structures.

---

## 5. Infrastructure

| Feature | Agenta | Langfuse | Braintrust |
|---------|--------|----------|------------|
| **Cloud provider** | ✅ AWS | ✅ AWS + Clickhouse | ⚠️ Not specified (implied AWS/GCP/Azure) |
| **Multi-AZ deployment** | ✅ 2 AZs | ✅ Multi-AZ | ❌ Not mentioned |
| **Database backup retention** | ✅ 7 days | ❌ Not specified | ❌ Not specified |
| **Backup window disclosed** | ✅ 03:30-05:30 UTC | ❌ No | ❌ No |
| **Deletion protection** | ✅ Enabled | ❌ Not mentioned | ❌ Not mentioned |
| **DDoS protection** | ✅ AWS Shield | ⚠️ Via Cloudflare | ❌ Not mentioned |
| **VPC isolation** | ✅ Public/private subnets | ⚠️ Implied | ✅ Isolated VPC |
| **VPC Flow Logs** | ✅ 30-day retention | ❌ Not mentioned | ❌ Not mentioned |
| **Status page** | ✅ hyperping.app | ✅ status.langfuse.com | ❓ Not found |

### Assessment

- **Agenta**: Over-detailed in some areas (instance sizes, backup windows) - enterprise buyers don't care about `db.r8g.large`.
- **Langfuse**: Right level of detail - mentions Multi-AZ without instance specs.
- **Braintrust**: Minimal infrastructure details, relies on "SOC 2 covers this" approach.

---

## 6. Documentation Quality

| Feature | Agenta | Langfuse | Braintrust |
|---------|--------|----------|------------|
| **DPA published online** | ❌ "Coming soon" | ✅ Full DPA with annexes | ⚠️ "Contact required" |
| **BAA available** | ❌ "Not available" | ✅ Yes | ✅ Yes |
| **Subprocessor list** | ❌ "Coming soon" | ✅ By region, detailed | ❌ Not published |
| **TOMs document** | ❌ Not published | ✅ Dedicated page | ❌ Not published |
| **RTO/RPO published** | ❌ Not mentioned | ✅ 12h RTO / 10min RPO | ❌ Not mentioned |
| **Incident response** | ⚠️ Brief mention | ✅ Dedicated page | ❌ Not mentioned |
| **Responsible disclosure** | ✅ security@agenta.ai | ✅ Dedicated page + process | ❌ Not mentioned |
| **Whistleblowing policy** | ❌ Not mentioned | ✅ Dedicated page | ❌ Not mentioned |
| **IP ranges published** | ❌ Not mentioned | ✅ Networking page | ❌ Not mentioned |
| **NDA template** | ❌ Not mentioned | ✅ Available | ❌ Not mentioned |

### Assessment

- **Agenta**: "Coming soon" for DPA/subprocessors is a blocker for enterprise procurement.
- **Langfuse**: Publishing RTO/RPO (12h/10min) builds enormous trust - Agenta should do this.
- **Braintrust**: Minimal published docs, relies on sales engagement for enterprise.

---

## 7. Unique Selling Points

### Things Agenta Mentions That Competitors Don't

| Feature | Agenta | Notes |
|---------|--------|-------|
| **Domain verification via DNS** | ✅ | Langfuse and Braintrust don't have this |
| **Auto-join for verified domains** | ✅ | Enterprise convenience feature |
| **6 granular roles** | ✅ | More than Braintrust's 3, more detailed than Langfuse |
| **Deployment Manager role** | ✅ | Unique role for DevOps separation |
| **Evaluator role** | ✅ | Unique role for QA teams |
| **Backup regions disclosed** | ✅ | Shows DR planning transparency |
| **VPC Flow Logs mentioned** | ✅ | Security logging transparency |
| **Account linking** | ✅ | Multiple auth methods per user |

### Things Competitors Have That Agenta Should Add

| Feature | Who Has It | Priority | Effort |
|---------|------------|----------|--------|
| **Published DPA** | Langfuse | 🔴 Critical | Medium (legal) |
| **Published subprocessor list** | Langfuse | 🔴 Critical | Low |
| **RTO/RPO numbers** | Langfuse | 🟡 High | Low |
| **ISO 27001** | Langfuse | 🟡 High | High (audit) |
| **HIPAA + BAA** | Langfuse, Braintrust | 🟡 High | High |
| **TOMs document** | Langfuse | 🟡 High | Medium |
| **Audit logs dedicated page** | Langfuse | 🟢 Medium | Low |
| **Penetration testing page** | Langfuse | 🟢 Medium | Low |
| **TLS version (1.2+)** | Langfuse | 🟢 Medium | Trivial |
| **IP ranges/allowlisting** | Langfuse | 🟢 Medium | Low |
| **Custom RBAC groups** | Braintrust | 🟢 Medium | Medium |
| **NDA template** | Langfuse | 🟢 Low | Low (legal) |
| **Whistleblowing policy** | Langfuse | 🟢 Low | Low |

---

## 8. Things Over-Detailed in Agenta Docs

These details are in Agenta's docs but aren't necessary (no competitor includes them):

| Detail | Where | Recommendation |
|--------|-------|----------------|
| Instance class `db.r8g.large` | Research notes | Remove - nobody cares about instance sizes |
| Instance class `r7a.large` | Research notes | Remove |
| Disk size `200 GB` | Research notes | Remove |
| CloudWatch retention `90 days` | Research notes | Keep only if legally relevant |
| NAT Gateway per AZ | Docs | Simplify to "redundant networking" |
| ALB SSL Policy `ELBSecurityPolicy-2016-08` | Docs | Remove or just say "TLS 1.2+" |
| Backup window `03:30-05:30 UTC` | Docs | Remove - too specific, implies rigidity |

### Recommendation

Replace infrastructure specs with outcome-focused statements:
- "High availability with redundant infrastructure"
- "Automatic failover across availability zones"
- "Daily automated backups with 7-day retention"

---

## 9. Documentation Structure Comparison

### Langfuse (20+ pages) - Best in Class

```
Security/
├── Overview
├── Authentication & Authorization
├── Audit Logs
├── AI Features
├── Encryption
├── Data Regions & Availability
├── Networking & IP Ranges
├── Software Dependencies
├── Incident & Breach
├── Responsible Disclosure
├── Whistleblowing
├── Penetration Testing
├── Vulnerability Management
├── Security FAQ
├── TOMs
Compliance/
├── Policies
├── SOC 2 Type II
├── ISO 27001
├── HIPAA
├── Compliance FAQ
Privacy/
├── DPA
├── Subprocessors
├── GDPR
├── Managing Personal Data
├── Privacy FAQ
Legal/
├── Terms of Service
├── Privacy Policy
├── NDA
```

### Braintrust (1 page) - Minimalist

```
Security (single page covering everything)
```

### Agenta (8 pages) - Middle Ground

```
Security/
├── Overview
├── Data Regions
├── Compliance
├── Privacy
Access Control/
├── Organizations
├── SSO
├── RBAC
├── Domain Verification
```

---

## 10. Priority Action Items for Agenta

### Immediate (Blocks Enterprise Sales)

1. **Publish DPA** - Even a basic one is better than "coming soon"
2. **Publish subprocessor list** - Required for GDPR compliance
3. **Add TLS 1.2+ specification** - One-line change

### Short-term (Next Quarter)

4. **Document RTO/RPO** - Decide numbers and publish
5. **Create TOMs document** - Extract from infrastructure details
6. **Add audit logs page** - Document what's logged and retention
7. **Remove over-detailed specs** - Instance sizes, backup windows, SSL policies

### Medium-term (Next 6 Months)

8. **Pursue ISO 27001** - Growing enterprise requirement
9. **HIPAA roadmap** - Evaluate demand from healthcare prospects
10. **Penetration test docs** - After conducting and documenting tests

---

## Summary Scorecard

| Category | Agenta | Langfuse | Braintrust |
|----------|:------:|:--------:|:----------:|
| Compliance | 3/5 | 5/5 | 4/5 |
| Encryption | 4/5 | 5/5 | 4/5 |
| Data Regions | 4/5 | 5/5 | 3/5 |
| Access Control | 5/5 | 3/5 | 4/5 |
| Infrastructure | 4/5 | 4/5 | 2/5 |
| Documentation | 2/5 | 5/5 | 2/5 |
| **Overall** | **22/30** | **27/30** | **19/30** |

**Agenta's Position**: Strong fundamentals (SOC 2, encryption, RBAC) with gaps in published legal docs. Domain verification is a genuine differentiator. Need to prioritize DPA and subprocessor list to unblock enterprise deals.
