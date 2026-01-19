# Core Concepts

## Goals

- **Protect reliability**: Prevent overload of the API and downstream dependencies
- **Fairness**: Prevent any single tenant from consuming disproportionate capacity
- **Plan-aware enforcement**: Apply different limits based on subscription plan
- **Endpoint-aware enforcement**: Apply different limits based on route group
- **Support bursts**: Allow short-term bursts while preserving average rate
- **Distributed correctness**: Work correctly with multiple API instances

## Non-Goals

- **Billing-grade counting**: Monthly quotas and invoices are handled elsewhere
- **User-based limits**: Primary identifier is organization_id, not user_id
- **Perfect IP fairness**: IP is a guardrail for unauthenticated routes only

---

## Principal (Who)

A **principal** is "who is being limited".

| Type | Usage | Example | Status |
|------|-------|---------|--------|
| `organization_id` | Primary identifier for authenticated traffic | `org_abc123` | ✅ Implemented |
| `ip` | Unauthenticated routes or secondary guardrail | `192.168.1.100` | ⏳ Not yet implemented |

**Note**: IP limits are inaccurate due to NAT, proxies, and mobile networks. Use IP limits primarily as a safety net.

**Current implementation**: Only `organization_id` is supported. Unauthenticated requests bypass rate limiting.

---

## Endpoint Groups (What)

Endpoint groups are **named collections** of related endpoints defined in a central registry.

| Group | Description | Endpoints |
|-------|-------------|-----------|
| `otlp` | OpenTelemetry ingest | `POST /v1/otlp/traces` |
| `queries` | Span and analytics queries | `/v1/spans/query`, `/v1/analytics/query` |
| `public` | Unauthenticated endpoints | Public health checks, docs |
| `auth` | Authentication endpoints | `/v1/auth/*`, `/v1/supertokens/*` |
| `registry` | Entity fetch/retrieve | Testsets, apps, evals, traces lookups |

Groups are defined once in configuration and referenced by name in policies.

---

## Plan (Condition)

A **plan** determines which contract applies to a principal.

| Plan | Description |
|------|-------------|
| `free` | Free tier with basic limits |
| `pro` | Professional tier with higher limits |
| `enterprise` | Enterprise tier with custom limits |
| `anonymous` | Unauthenticated traffic |

The plan is resolved per request from the organization's configuration.

---

## Enforcement

The runtime act of checking policies and deciding:

1. **Resolve principal** — organization_id for authenticated, IP for unauthenticated
2. **Resolve endpoint** — determine which groups apply
3. **Resolve plan** — look up organization's subscription
4. **Select policies** — filter applicable policies
5. **Enforce atomically** — check all applicable buckets
6. **Return decision** — allow or deny (429)

### Deny Semantics

- If **any** applicable policy denies → request is denied
- System records **which policy denied** (the limiting dimension)
- `Retry-After` header computed from the denying policy

---

## Why Redis

- **Centralized shared state** across many API instances
- **Atomic operations** via Lua scripts
- **Built-in TTLs** for automatic key expiration
- **High throughput** and low latency

Redis state is typically **volatile** (acceptable reset on restart). Billing-grade persistence is handled elsewhere.

---

## Failure Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `open` | Allow requests when Redis unavailable | Default, prevents outage |
| `closed` | Deny requests when Redis unavailable | Expensive/critical endpoints |

The choice should be explicit and consistent per policy or globally configured.
