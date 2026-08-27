# Facet installation matrix

The service always resolves the complete committed revision. The runner groups its values
by application lifecycle and installs each supported dependency group independently.

This matrix defines initial support. `Unsupported` means the asynchronous refresh leaves
the currently installed value unchanged. It does not reject the committed revision.

## Dependency groups

| Group | Values that move together | Initial support |
|---|---|---|
| Topology | Harness identity, sandbox provider, sandbox and network policy | Unsupported |
| Runtime | Runtime process settings, provider endpoint, process environment | Unsupported |
| Workspace files | Instructions and resolved skill files | Unsupported initially |
| Prompts | System and append prompt configuration | Unsupported initially |
| Harness files | Opaque harness configuration files | Unsupported initially |
| Model | Model identifier, provider routing, connection binding, and credentials | Unsupported initially |
| Harness session | Mode, permissions, MCP definitions, bindings, and credentials | Unsupported initially |
| Tools | Model-visible catalog plus stable private dispatch descriptors, permissions, credential bindings, and their shared generation | Unsupported until adapter delivery exists |
| Gateway execution | Gateway policy, opaque connection and action bindings, search filtering, and approval generation | Supported first |

Current trace, span, run, and exporter context are invocation data, not a configuration
group. Callback endpoint, callback authorization, telemetry authorization, and exporter
context also remain in the per-invocation envelope. The snapshot excludes them.

Topology is the dependency root for every harness-adapted group. Runtime depends on topology;
workspace files, prompts, harness files, harness session, model, and tools depend on the
active topology and runtime. Model and tools also depend on harness-session capabilities.
Gateway execution can preinstall independently, but calls remain blocked until matching
generic gateway descriptors exist in the installed tools generation. Gateway revocations
publish immediately and fail closed even when stale generic tools remain.

## Installation versus observation

Installing a file means the runner replaced the managed file successfully. It does not mean
the harness reread it. If an adapter can report observation, the runner records that fact
separately.

Installing a runner-owned execution policy makes it effective immediately for calls that
start after publication. Its installed and observed versions are therefore equal.

## Initial harness behavior

| Change | Pi | Claude Code | Codex |
|---|---|---|---|
| Replace managed workspace files | Unsupported initially | Unsupported initially | Unsupported initially |
| Change model | Unsupported initially | Unsupported initially | Unsupported initially |
| Change model-visible tool catalog | Unsupported initially | Unsupported initially | Unsupported initially |
| Change MCP servers | Unsupported initially | Unsupported initially | Unsupported initially |
| Change runner-owned gateway policy | Supported | Supported | Supported |
| Rotate callback authorization | Invocation-owned; not refreshed | Invocation-owned; not refreshed | Invocation-owned; not refreshed |

The runner does not create a session reopen or model invocation for an unsupported change.
Later slices may enable files, model state, credentials, or catalog delivery after their
application mechanism is generation-fenced and can separately report partial mutation
honestly. Catalog changes apply only between turns and never while an approval is suspended.
Until then, a fail-closed runner overlay immediately blocks every changed tool and invalidates
its pending approvals. Session-backed environments keep only the newest pending tools
snapshot and apply it after the turn, before the next one; ephemeral environments discard it
at teardown and rely on ordinary next-run resolution.

## Gateway execution group

The gateway group contains:

- normalized per-tool `allow`, `ask`, or `deny` decisions;
- integration-to-provider routing;
- integration-to-connection routing;
- read-only metadata used by approval display and policy;
- gateway search filtering generation;
- gateway execution generation and composite gateway call generation;
- opaque provider connection and action bindings.

All values come from one resolved snapshot and publish atomically.

### Existing connection changes

When the generic `search_tools` and `run_tool` pair already exists in the harness, the
runner can install:

- an added integration;
- a removed integration;
- a changed connection slug;
- a changed default permission;
- per-tool permission changes;
- catalog drift reflected in the compiled table.

The next gateway call captures the new group. A call rechecks current generation before
authenticated API callback dispatch; an already dispatched callback keeps its prior capture.
It executes only when the installed tools generation still contains matching generic gateway
dispatch descriptors.

### First connection

The first `gateway_connection` requires both the private gateway group and the
model-visible generic tool pair. Until tool-catalog delivery is supported for the active
harness, the tool-catalog part reports `unsupported`.

The private gateway group reports `installed`, while the tools group reports `unsupported`
or `pending`. The runner must not claim that the integration is visible or callable merely
because it preinstalled private policy. The next ordinary run installs the complete catalog.

### Last connection removed

Removing the last connection revokes the private gateway execution group immediately. A
stale model-visible generic tool may remain, but the runner denies its calls because no
integration exists in the installed private policy.

### Search memory

Any cached or remembered gateway search result was filtered under one policy generation.
Publishing a new gateway group clears that memory. The model may still remember old prose,
but execution remains runner-gated.

## Credentials

Credential values do not enter configuration digests. Their bindings do. A credential and
the config that consumes it publish in one dependency group. The runner derives any
comparison-only credential epoch locally. A refreshed credential installs only when the
active consumer supports replacement.

The service extends redaction before delivery. The runner performs a bounded non-logging
credential scan and extends its redactor before typed validation. Failure to extend either
redactor rejects the complete snapshot before any dependency group mutates.

## Independent failure example

Revision 12 changes gateway permissions, instructions, and MCP servers after a future file
installation slice is enabled:

```json
{
  "announcedSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
  "facets": {
    "gatewayExecution": {
      "status": "installed",
      "desiredSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
      "lastKnownInstalledSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
      "installedTrusted": true
    },
    "harnessSession": {
      "status": "unsupported",
      "desiredSource": {"kind": "committed", "variantId": "v1", "revisionId": "r12", "version": "12", "sequence": 12},
      "lastKnownInstalledSource": {"kind": "inline", "parametersFingerprint": "sha256:..."},
      "installedTrusted": true
    }
  }
}
```

This is a valid best-effort result. The platform does not claim that revision 12 is fully
active. The next ordinary run resolves all facets from its selected revision.
