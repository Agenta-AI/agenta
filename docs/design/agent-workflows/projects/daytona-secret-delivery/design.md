# Design

## Decision summary

Use per-sandbox Daytona Secret leases for proxy-substitutable HTTP credentials. Keep Agenta as the
source of truth. Daytona stores a temporary encrypted copy for the lifetime of one sandbox.

Do not create a permanent one-to-one mirror of Agenta vault entries in the Daytona organization.
Do not pass plaintext fallback values when secret delivery fails.

## Credential classification

Before building a sandbox, classify every resolved environment entry by semantic role:

| Class | Examples | Delivery |
|---|---|---|
| Non-secret configuration | region, project, base URL, feature flags | plain `envVars` |
| HTTP substitution credential | provider API key, bearer token, custom text API key | Daytona `secrets` mapping |
| Local-use confidential material | AWS signing keys, service-account JSON, private keys | reject for isolated mode; route through a gateway or use scoped temporary credentials |
| Agenta control-plane credential | callback auth, Agenta API key, OTLP auth, Daytona API key | runner-side only |

An unclassified value fails closed. Environment-variable naming alone is not a durable interface,
so the long-term resolver output should describe the credential's use rather than rely on a growing
denylist.

## Interface design

### User-facing configuration

Keep credentials under the consumer that uses them:

- model credentials stay under the selected model connection;
- MCP credentials stay under `mcp_servers[].secrets`;
- tool credentials stay under that tool declaration;
- a future general runtime credential, if a real use case requires one, belongs under
  `runtime.credentials`, not in a top-level vault dump.

Every custom credential use must declare one or more HTTPS destination hosts. Secret storage and
destination policy are different roles: the Agenta vault owns the value, while the consumer
declaration owns where that use may send it.

Do not expose Daytona Secret names or IDs in the agent configuration or public run API. They are a
provider-specific delivery mechanism.

### Resolved internal contract

The current `secrets: Record<string, string>` wire field combines credential values with their
environment binding and carries no destination policy. Preserve it only as a compatibility input.
Add a typed resolved credential binding owned by the consumer, conceptually:

```json
{
  "modelCredential": {
    "environment": "OPENAI_API_KEY",
    "value": "<redacted plaintext on the internal wire>",
    "usage": "http_substitution",
    "destinations": {
      "httpsHosts": ["api.openai.com"]
    }
  }
}
```

Field roles:

| Field | Role | Owner and lifecycle |
|---|---|---|
| `environment` | protocol binding | harness adapter, per connection |
| `value` | credential | Agenta vault, per resolved run; never logged or persisted by the runner |
| `usage` | credential-use contract | resolver, stable for the credential kind |
| `destinations.httpsHosts` | egress policy | consumer or connection definition, per use |

The concrete wire shape should be finalized with the provider-model-auth owner. The important
constraint is that value, use, and destination travel together. A sibling `secretHosts` map would
allow them to drift and is rejected.

For the first implementation slice, standard direct providers may use a reviewed static host
registry and custom providers may derive one exact hostname from their validated `endpoint.baseUrl`.
This avoids blocking on a full wire migration. It must reject unknown providers, empty hosts,
Bedrock, Vertex service-account credentials, and arbitrary custom environment values.

## Daytona lease model

A `DaytonaSecretLease` is internal runner state:

```text
lease id               random 128-bit identifier
sandbox name or id      one Daytona sandbox
bindings[]               env name, Daytona Secret id/name, exact hosts
created at               reconciliation age
state                    provisioning | attached | parked | deleting
```

It never stores credential plaintext. Secret names use only an Agenta prefix, the random lease ID,
and an opaque binding suffix. They do not contain project IDs, provider names, user names, or raw
environment names.

### Provisioning

1. Resolve only the selected consumers' credentials from the Agenta vault.
2. Partition configuration, supported credentials, and unsupported material.
3. Generate a lease ID and create one Daytona organization Secret per binding with an exact host
   allowlist.
4. Create the sandbox with:
   - non-secret values in `envVars`;
   - `{environmentName: daytonaSecretName}` in `secrets`;
   - an opaque sandbox name or label that carries the lease ID for reconciliation.
5. Start the sandbox-agent daemon only after Secret attachment is part of sandbox creation.
6. Persist sandbox and lease metadata without plaintext.

The Secret must exist before sandbox creation. Attaching it afterward risks an already-running
daemon retaining the wrong environment.

### Rotation and model changes

If the underlying value changes but the environment binding and hosts stay the same, update the
Daytona Secret. Its placeholder remains stable. Wait for documented propagation before starting a
new provider request, with a bounded retry for authentication failures.

If the environment binding, credential class, or allowed host changes, provision a fresh sandbox
or restart the daemon after replacing the attached set. Do not assume an already-running process
sees newly attached variables. Credential identity must participate in the reusable environment or
session-pool key.

### Pause, resume, and delete

- Pause or archive: retain the lease because the sandbox may resume.
- Resume: reconcile the stored sandbox ID and lease bindings, rotate values if needed, then start
  the daemon.
- Confirmed sandbox delete: delete every Secret in the lease, then mark the lease complete.
- Secret cleanup failure: report and retry asynchronously. Do not report a successful security
  cleanup until the Secret deletions are confirmed or queued durably.

The Daytona provider adapter must implement real `pause`, not the current delete fallback.

### Reconciliation

Run a periodic janitor with a dedicated lock:

1. List all Agenta-owned Secret names with full cursor pagination.
2. List Agenta-owned Daytona sandboxes across running, stopped, archived, and deleting states.
3. Keep Secrets whose lease belongs to a live sandbox or an in-flight provisioning record.
4. Delete Secrets whose sandbox is absent and whose grace period has elapsed.
5. Emit counts and opaque lease IDs only. Never log values or user-facing secret names.

The janitor must not infer ownership from age alone. A long-lived archived sandbox is valid.

## Provider adapter strategy

The current `sandbox-agent/daytona` adapter is about 60 lines, creates its own Daytona client, and
does not expose Secret lifecycle hooks or native pause. The safest implementation is an
Agenta-owned Daytona provider adapter that still implements sandbox-agent's provider interface but
uses an injected, exact-version Daytona client.

This adapter owns create, get URL, ensure server, pause, destroy, and lease compensation. It avoids
forking the sandbox-agent runtime while removing the deprecated package-name constraint from this
security-sensitive boundary.

An upstream contribution can later add client injection and lifecycle hooks to sandbox-agent. The
Agenta implementation should not wait on that contribution.

## Agenta credentials

The TypeScript agent runner does not need an Agenta API key inside the sandbox for normal tool
callbacks. Keep all of the following out of Daytona Secrets:

- `DAYTONA_API_KEY`;
- Agenta request or callback authorization;
- OTLP authorization;
- internal MCP or tool relay credentials;
- durable-store master credentials.

The legacy Python evaluator currently injects Agenta credentials directly. Treat its migration or
retirement as a separate decision. Do not normalize that behavior into the new lease model.

## Alternatives

### Permanent organization mirror

Mirror every Agenta vault secret into Daytona once and reuse it across sandboxes.

Rejected. It creates a second durable source of truth, broad cross-sandbox reuse, difficult tenant
deletion semantics, and larger blast radius.

### One Secret per project or provider

Reuse one Daytona Secret across a project's sandboxes.

Rejected for the first version. It makes sandbox cleanup unable to revoke one sandbox and increases
cross-session coupling. Per-sandbox copies cost more API operations but provide clear ownership.

### Delete immediately after attachment

Rejected. Daytona's proxy needs the organization Secret while requests are in flight.

### Continue plaintext `envVars`

Rejected for supported credentials. It leaves the key readable by the agent.

### Use only an Agenta model proxy

Still valid and required for local sandboxes or unsupported credentials. For direct HTTP keys on
Daytona, native substitution is smaller and avoids operating another inference hop.

### Send every custom secret to the agent

Rejected. Secret access must remain explicit and consumer-scoped. A project vault is not an agent
environment template.
