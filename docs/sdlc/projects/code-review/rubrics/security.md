# rubrics/security.md – Security Review

**Domain:** Authentication, injection, secrets, cryptography, OWASP Top 10.
**Universal criterion:** Security (6) — full depth.  See `criteria.md` for the baseline questions that apply in every review.
**Applies to:** Any change that touches auth, user input, data storage, networking, or privilege boundaries.
**References:** OWASP Top 10 (2021), CWE Top 25, NIST SP 800-53.

---

## Goals

- Identify exploitable vulnerabilities before code reaches production.
- Confirm that trust boundaries, authentication, and authorisation are enforced correctly.
- Verify that sensitive data is handled and stored securely.

---

## Checklist

### Injection (OWASP A03)

| # | Criterion | Severity if violated |
|---|---|---|
| S‑1 | All user-supplied input is validated, sanitised, or parameterised before use in queries, commands, or templates | critical |
| S‑2 | SQL queries use parameterised statements or an ORM; no string concatenation with user input | critical |
| S‑3 | Shell commands are constructed without user-controlled data; if unavoidable, inputs are escaped and allowlisted | critical |
| S‑4 | Template engines use auto-escaping; user input is not passed to `eval`, `exec`, or equivalent | critical |

### Authentication and session management (OWASP A07)

| # | Criterion | Severity if violated |
|---|---|---|
| S‑5 | Passwords are hashed with a slow algorithm (bcrypt, scrypt, Argon2); never stored in plaintext or with MD5/SHA-1 | critical |
| S‑6 | Session tokens are cryptographically random, rotated on privilege change, and invalidated on logout | high |
| S‑7 | Authentication failures return generic messages; no username enumeration | medium |
| S‑8 | Multi-factor authentication is not bypassed by the change | high |
| S‑9 | JWT signatures are verified; algorithm confusion (`alg: none`) is not possible | high |

### Broken access control (OWASP A01)

| # | Criterion | Severity if violated |
|---|---|---|
| S‑10 | Every endpoint and function enforces authorisation; no implicit trust of user-supplied IDs | critical |
| S‑11 | Direct object references are validated against the requesting user's permissions (IDOR check) | high |
| S‑12 | Privilege escalation paths are closed; users cannot grant themselves elevated roles | high |
| S‑13 | Admin or internal endpoints are not publicly reachable without authentication | high |

### Sensitive data exposure (OWASP A02)

| # | Criterion | Severity if violated |
|---|---|---|
| S‑14 | Secrets, API keys, and credentials are not hardcoded; they are read from environment variables or a secret store | critical |
| S‑15 | Secrets are not logged, included in error messages, or returned in API responses | high |
| S‑16 | Sensitive data in transit uses TLS 1.2+; no plaintext channels | high |
| S‑17 | PII stored at rest is encrypted or pseudonymised as required | high |
| S‑18 | Debug or verbose logging is disabled in production builds | medium |

### Security misconfiguration (OWASP A05)

| # | Criterion | Severity if violated |
|---|---|---|
| S‑19 | CORS policy is restrictive; wildcard origin is not used for credentialed requests | high |
| S‑20 | Security headers are set (CSP, X-Frame-Options, HSTS, etc.) | medium |
| S‑21 | Dependency versions are current; known vulnerable versions are not introduced | high |
| S‑22 | Default credentials and unnecessary features are removed | high |

### Other

| # | Criterion | Severity if violated |
|---|---|---|
| S‑23 | CSRF protection is in place for state-changing requests | high |
| S‑24 | Rate limiting or throttling exists on sensitive endpoints (login, password reset) | medium |
| S‑25 | Cryptographic operations use well-known libraries; no custom crypto | high |
| S‑26 | File uploads are validated (type, size, content); stored outside the web root | high |

---

## Scoring guidance

One **critical** failure → **Fail** verdict.  Multiple **high** failures without remediation → **Fail**.
Remediate security findings before any other category.  When in doubt, flag as high and document reasoning.
