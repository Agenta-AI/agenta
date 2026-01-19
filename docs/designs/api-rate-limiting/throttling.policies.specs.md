# Policies (PAR(C) Model)

## Overview

A **policy** follows the PAR(C) authorization model:

| Component | Rate Limiting Mapping | Description |
|-----------|----------------------|-------------|
| **P**rincipal | Identifier type | `organization_id` or `ip` |
| **A**ction | Endpoint scope | Which endpoints: all, include groups, exclude groups |
| **R**esource | (implicit) | The API itself |
| **C**ondition | Plan | Subscription tier that activates this policy |
| **Output** | Bucket key + params | Key format + algorithm parameters |

---

## Action: Endpoint Scope Modes

Each policy specifies an **action** that defines which endpoints it applies to.

### Mode 1: All Endpoints

```yaml
scope:
  mode: all
```

Applies to every request for the principal.

### Mode 2: Exclude (All Except)

```yaml
scope:
  mode: exclude
  groups: [exports, auth]      # exclude these groups
  endpoints: [POST /v1/reset]  # exclude specific endpoints
```

Applies to all endpoints EXCEPT those in the specified groups or explicit endpoints.

### Mode 3: Include (Only These)

```yaml
scope:
  mode: include
  groups: [llm]                # only these groups
  endpoints: [POST /v1/chat]   # only these specific endpoints
```

Applies ONLY to endpoints in the specified groups or explicit endpoints.

---

## Output: Bucket Key and Parameters

Each policy outputs:
- **Bucket key**: Used to identify the Redis bucket
- **Bucket parameters**: `max_capacity`, `refill_rate`

### Key Format

```
throttle:{key-components}
```

Key components are built from context:
- Simple: `throttle:global`
- Single dimension: `throttle:org:abc123`
- Multiple dimensions: `throttle:group:llm:org:abc123`

---

## Policy Schema

```yaml
policy:
  slug: string              # Unique identifier for logging/metrics
  principal_type: org | ip  # Who is being limited
  condition:
    plan: string            # Which plan this applies to (* for all)
  action:
    mode: all | include | exclude
    groups: [string]        # Group names from registry (optional)
    endpoints: [string]     # Specific endpoints (optional)
  output:
    max_capacity: integer   # Burst size
    refill_rate: integer    # Tokens per minute
```

---

## Example Policies

### Global Limit for Free Plan

```yaml
policy:
  slug: org-global-free
  principal_type: org
  condition:
    plan: free
  action:
    mode: all
  output:
    max_capacity: 100
    refill_rate: 60
```

Key: `throttle:org:{organization_id}`

### LLM-Specific Limit for Pro Plan

```yaml
policy:
  slug: org-llm-pro
  principal_type: org
  condition:
    plan: pro
  action:
    mode: include
    groups: [llm]
  output:
    max_capacity: 500
    refill_rate: 300
```

Key: `throttle:group:llm:org:{organization_id}`

### All Except Exports for Enterprise

```yaml
policy:
  slug: org-non-export-enterprise
  principal_type: org
  condition:
    plan: enterprise
  action:
    mode: exclude
    groups: [exports]
  output:
    max_capacity: 10000
    refill_rate: 5000
```

Key: `throttle:org:{organization_id}`

### IP-Based Auth Protection

```yaml
policy:
  slug: ip-auth-default
  principal_type: ip
  condition:
    plan: "*"  # applies regardless of plan
  action:
    mode: include
    groups: [auth]
  output:
    max_capacity: 10
    refill_rate: 5
```

Key: `throttle:group:auth:ip:{ip_address}`

---

## Policy Selection

For a given request, find all policies where:

1. `principal_type` matches the request's identifier type
2. `condition.plan` matches the resolved plan (or is wildcard `*`)
3. The endpoint is within the policy's `action` scope

### Priority (Most Specific First)

1. Endpoint-specific (include with specific endpoints)
2. Group-specific (include with groups)
3. Exclude-based (all except)
4. Global (all)

### Multiple Policies

When multiple policies match:
- All are evaluated
- If any denies → request denied
- The "limiting policy" is recorded for headers/logging

---

## Policy Resolution Inputs

For a given request, policy selection depends on:

| Input | Source |
|-------|--------|
| `principal_type` | Authentication state |
| `principal_value` | organization_id or IP |
| `plan` | Organization configuration |
| `endpoint_groups` | Route registry |
| `endpoint_id` | Request method + path |
