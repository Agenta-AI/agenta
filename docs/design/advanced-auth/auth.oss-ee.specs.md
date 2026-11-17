# OSS vs Commercial License (EE) — Feature Matrix

This document specifies how **OSS** and **Commercial License (EE)** differ for **self-hosted deployments**.

> **Important framing**
> EE here means **commercial license**, not "enterprise SaaS".
> The distinction is about **scope, separation, governance, and risk**, not company size.

---

## 1. Core Framing Principles

### 1.1 What OSS Is For

OSS supports:
- Evaluation
- Research
- Small teams
- Low-stakes internal use
- Single-scope collaboration

OSS is **fully functional**, but **intentionally bounded**.

### 1.2 What the Commercial License (EE) Is For

The commercial license supports:
- Separation of concerns
- Multiple internal boundaries
- Governance and enforcement
- Accountability and auditability
- Regulated or commercial usage

> **Rule of thumb:**
> If you need boundaries, governance, or guarantees, you need a commercial license.

---

## 2. Organization Model

### 2.1 Personal Organizations

| Capability | OSS | EE |
|----------|-----|----|
| Personal organizations | ❌ | ✅ |

Personal organizations (`is_personal=true`) provide individual sandboxes with no governance scope.

### 2.2 Collaborative Organizations

| Capability | OSS | EE |
|----------|-----|----|
| Collaborative organizations | ✅ (exactly 1) | ✅ (multiple) |
| Organization deletion | ❌ | Restricted |

---

## 3. Organization Flags

All authentication policies are stored in `organizations.flags` JSONB.

| Flag | OSS | EE |
|------|-----|-----|
| `is_personal` | ❌ (always false) | ✅ |
| `is_demo` | ✅ | ✅ |
| `allow_email` | ✅ | ✅ |
| `allow_social` | ✅ | ✅ |
| `allow_sso` | ❌ | ✅ |
| `allow_root` | ❌ | ✅ |
| `domains_only` | ❌ | ✅ |
| `auto_join` | ❌ | ✅ |

---

## 4. Domain & Identity Governance

| Capability | OSS | EE |
|----------|-----|----|
| Domain verification | ❌ | ✅ |
| Auto-join by domain | ❌ | ✅ |
| Domain-only access restriction | ❌ | ✅ |
| SSO enforcement | ❌ | ✅ |
| Owner bypass (`allow_root`) | ❌ | ✅ |

---

## 5. SSO Providers

| Capability | OSS | EE |
|----------|-----|----|
| SSO provider configuration | ❌ | ✅ |
| Multiple SSO providers per org | ❌ | ✅ |
| SSO-only enforcement | ❌ | ✅ |

---

## 6. Workspaces

| Capability | OSS | EE |
|----------|-----|----|
| Workspaces per org | 1 | Multiple |
| Workspace-level governance | ❌ | ✅ |

---

## 7. Projects & Environments

| Capability | OSS | EE |
|----------|-----|----|
| Multiple projects | ✅ | ✅ |
| Default environments (prod/staging) | ✅ | ✅ |
| Custom environments | Limited | Unlimited |

---

## 8. Users & Collaboration

| Capability | OSS | EE |
|----------|-----|----|
| Multiple users | ✅ | ✅ |
| Invitations | ✅ | ✅ |
| Basic collaboration | ✅ | ✅ |

---

## 9. RBAC (Role-Based Access Control)

| Capability | OSS | EE |
|----------|-----|----|
| Basic roles (Owner, Admin, Member) | ✅ | ✅ |
| Custom roles | ❌ | ✅ |
| Fine-grained permissions | ❌ | ✅ |

---

## 10. Audit, Compliance, and Security

| Capability | OSS | EE |
|----------|-----|----|
| Audit logs | ❌ | ✅ |
| Compliance artifacts (SOC2, HIPAA) | ❌ | ✅ |
| Governance reporting | ❌ | ✅ |

---

## 11. Error Codes

Both OSS and EE use the same error codes, but EE has additional enforcement:

| Error Code | OSS | EE |
|------------|-----|-----|
| `AUTH_UPGRADE_REQUIRED` | ✅ | ✅ |
| `AUTH_SSO_DENIED` | ❌ | ✅ |
| `AUTH_DOMAIN_DENIED` | ❌ | ✅ |

---

## 12. Summary

### OSS Supports
- One collaborative organization
- One workspace
- Multiple projects
- Basic environments
- Basic RBAC
- Multiple users
- Full core product functionality

### EE Unlocks
- Multiple organizations (including personal)
- Multiple workspaces
- Advanced RBAC
- Governance and enforcement (`domains_only`, `auto_join`)
- Domain authority and verification
- SSO providers and enforcement
- Owner bypass (`allow_root`)
- Auditability and compliance

---

## 13. Canonical Wording

> **OSS supports collaboration inside a single scope.**
> **The commercial license supports separation, governance, and enforcement across scopes.**

Or simply:

> **If you need boundaries, you need a license.**

---

## 14. Guiding Principle

> **Structure enables use; governance enables responsibility; responsibility has commercial value.**
