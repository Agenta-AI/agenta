# URL Model & Routing Rules

This document defines how incoming requests determine deployment context using the URL, and how that context maps to realms (DB), user pools, and workload routing.

---

## Canonical Host Format

```
https://{tier}.{region}.{account}.agenta.ai
```

### Components

| Part | Meaning | Examples |
|------|---------|----------|
| `tier` | Multi-tenant shared label or a tenant slug | `shared`, `acme`, `pr-1234` |
| `region` | Geographical region label | `eu`, `us` |
| `account` | Deployment account boundary | `cloud`, `preview` |

#### Examples

| Canonical Host | Meaning |
|----------------|---------|
| `shared.eu.cloud.agenta.ai` | Shared SaaS environment in EU |
| `acme.eu.cloud.agenta.ai` | Dedicated single-tenant ACME deployment in EU |
| `preview.eu.preview.agenta.ai` | Shared preview environment |
| `pr-1234.eu.preview.agenta.ai` | Per‑PR ephemeral preview environment |

---

## CNAME Simplification Layer

Users do not need to type the full canonical form. CNAMEs map friendly URLs to canonical URLs.

| User-Facing Host | Canonical Resolution |
|------------------|----------------------|
| `https://cloud.agenta.ai` | `shared.eu.cloud.agenta.ai` |
| `https://acme.agenta.ai` | `acme.eu.cloud.agenta.ai` |
| `https://preview.agenta.ai` | `preview.eu.preview.agenta.ai` |
| `https://pr-123.preview.agenta.ai` | `pr-123.eu.preview.agenta.ai` |

Resolution may be via DNS CNAMEs, or via a lookup table at the gateway.

---

## Parsing & Realm Resolution

Given the canonical form:

```
{tier}.{region}.{account}.agenta.ai
```

1. Extract the three labels:

| Host Part | Parsed Value |
|-----------|-------------|
| leftmost   | `tier` |
| middle     | `region` |
| rightmost before domain | `account` |

Example:

```
shared.eu.cloud.agenta.ai → (tier=shared, region=eu, account=cloud)
```

2. Resolve deployment configuration using the tuple:

```
realm = REALM_CONFIG[(account, region, tier)]
```

### Realm Configuration Contains:

- Database DSN
- `SUPERTOKENS_API_URL`
- `SUPERTOKENS_API_KEY`
- `SUPERTOKENS_TENANT_ID`
- `SUPERTOKENS_APPLICATION_ID=default`
- Operational flags (if any)

This mapping defines **both** data plane (DB) and identity boundary (tenant/user pool).

---

## Workloads via Path Prefixes

Once realm selection is done, workloads are routed by path:

| Path Prefix | Destination |
|------------|-------------|
| `/` | Web UI (no `/app` prefix) |
| `/api/*` | API |
| `/auth/*` | Authentication callbacks & flows |
| `/otlp/*` | Telemetry / OTLP collector |
| `/services/*` | Optional additional services |
| `/health` | Health check endpoint |

Example:

```
https://acme.eu.cloud.agenta.ai/api/projects
https://shared.eu.cloud.agenta.ai/otlp/v1/traces
https://preview.eu.preview.agenta.ai/auth/callback
```

---

## One‑Sentence Summary

> The URL host determines `{tier, region, account}`, which maps to a realm configuration containing DB and identity settings, while the path determines which workload (Web, API, Auth, OTLP, etc.) handles the request.
