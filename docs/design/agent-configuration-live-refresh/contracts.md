# Contracts

This page pins the private interfaces. Each boundary preserves its existing casing: API
responses use snake case, while runner stream and apply contracts use camel case.

## Roles

| Role | Meaning |
|---|---|
| Data | The authored or resolved values being processed. |
| Config | Stable settings that define runtime behavior. |
| Policy | What an operation is allowed to do. |
| Credentials | Secret material used to authenticate one connection. |
| Routing | Values that select a resource or destination. |
| Protocol context | Trusted identity and ordering values for one exchange. |
| Metadata | Descriptive values that do not change behavior. |

## 1. API callback metadata

Owner: API commit handler. Reader: runner callback intake. Visibility: private.

`ToolCallResponse` gains an optional sibling to its existing model-visible `call` result:

```json
{
  "call": {
    "data": {
      "content": "{\"status\":\"committed\",\"workflow_revision\":{...}}"
    },
    "status": {
      "code": "STATUS_CODE_OK"
    }
  },
  "control_events": [
    {
      "type": "configuration_committed",
      "event_id": "01K...",
      "source": {
        "variant_id": "...",
        "revision_id": "...",
        "version": "12",
        "sequence": 12
      }
    }
  ]
}
```

| Field | Role | Rule |
|---|---|---|
| `control_events` | Protocol context | Private side effects of the trusted callback. Never model content. |
| `type` | Routing | Exactly `configuration_committed` for this contract. |
| `event_id` | Protocol context | Unique stable ID for deduplication. |
| `source.variant_id` | Routing | Variant that owns the committed revision. |
| `source.revision_id` | Routing | Exact immutable revision to retrieve. |
| `source.version` | Metadata | Existing stored string version, unchanged. |
| `source.sequence` | Protocol context | Integer parsed from and verified against the decimal version. |

The API emits this event only when the commit transaction returns `status: committed`.
`no_change`, conflict, refusal, and failure emit none.

The runner accepts this event only when all conditions hold:

1. The authenticated API callback succeeded.
2. The dispatched reserved operation was `commit_revision`.
3. The normal tool result reports a successful commit.
4. `version` matches `^(0|[1-9][0-9]*)$`, `sequence` is a safe integer, and
   `String(sequence) == version`.
5. Source identity is complete and valid.
6. `source.variant_id` equals the active run's bound workflow variant.

An ordinary gateway, workflow, MCP, or client tool cannot create a runner control event.

## 2. Runner private stream record

Owner: runner process that observed the commit. Reader: Python `AgentStream`. Visibility:
service only.

`StreamRecord` gains a third union arm:

```json
{
  "kind": "control",
  "control": {
    "type": "configuration_invalidated",
    "eventId": "01K...",
    "source": {
      "variantId": "...",
      "revisionId": "...",
      "version": "12",
      "sequence": 12
    },
    "target": {
      "activeRunId": "...",
      "ownerId": "...",
      "sessionId": "...",
      "turnId": "..."
    },
    "delivery": {
      "credentials": {
        "authorization": "Bearer ..."
      },
      "expiresAt": "2026-08-27T15:05:00Z"
    }
  }
}
```

| Field | Role | Rule |
|---|---|---|
| `kind` | Routing | Exactly `control`; distinct from public `event`. |
| `control.type` | Routing | Exactly `configuration_invalidated`. |
| `control.eventId` | Protocol context | Copied from trusted callback metadata. |
| `source` | Routing and protocol context | Exact committed revision identity. |
| `target.activeRunId` | Routing | Runner-issued identity present for session and non-session HTTP runs. |
| `target.ownerId` | Routing | Opaque runner owner handle interpreted only by the configured runner transport. |
| `target.sessionId` | Routing | Optional session scope check. |
| `target.turnId` | Protocol context | Optional turn scope check. |
| `delivery.credentials.authorization` | Credentials | Short-lived apply-only bearer. Never logged or persisted. |
| `delivery.expiresAt` | Protocol context | Bounds credential and active-target lifetime. |

`kind: control` uses a dedicated emitter. It must not pass through public `AgentEvent`,
session persistence, trace content, Vercel conversion, SSE conversion, or model result
handling.

`AgentStream` consumes the record and schedules the configured service handler. It yields
nothing for this record and never awaits refresh completion before reading later public
records.

The Python service advertises support on its internal HTTP `/run` request with:

```http
Agenta-Runner-Private-Capabilities: configuration-control-v1
```

The runner emits `kind: control` only when that exact token is present. Missing or unknown
tokens mean no control records. HTTP permits unknown headers, so an older runner safely
ignores the advertisement; subprocess transport remains unsupported.

The service captures the authenticated project principal from the original invocation. It
checks source revision ownership with that principal. No target or source field grants API
access.

The service passes `target` to its configured runner transport. It does not construct or
follow a URL from this record. HTTP deployments must provide a trusted owner-routing
implementation before enabling refresh.

## 3. Resolved configuration snapshot

Owner: Python service and SDK composition. Reader: runner. Visibility: private.

Every facet uses this envelope:

```ts
interface ResolvedFacet<TConfig, TCredentials = never> {
  digest: string
  config: TConfig
  credentials?: TCredentials
}
```

Every behavior-bearing credential binding is part of `config`; `credentials` contains only
secret bytes. `digest` is `sha256:` plus SHA-256 over `strictCanonicalJson` of
`{"schemaVersion":1,"facet":"<facetName>","config":<config>}`. The runner rebuilds this
payload from the strict typed DTO after intake and rejects the complete snapshot if any digest
does not match. A facet publishes config and credentials as one dependency group. The runner
derives any comparison-only credential epoch locally from credential material. The epoch never
crosses the wire and never enters logs or digests.

```json
{
  "schemaVersion": 1,
  "source": {
    "kind": "committed",
    "variantId": "...",
    "revisionId": "...",
    "version": "12",
    "sequence": 12
  },
  "configuration": {
    "fingerprint": "sha256:...",
    "facets": {
      "topology": {"digest": "sha256:...", "config": {}},
      "runtime": {"digest": "sha256:...", "config": {}, "credentials": {}},
      "workspaceFiles": {"digest": "sha256:...", "config": {}},
      "prompts": {"digest": "sha256:...", "config": {}},
      "harnessFiles": {"digest": "sha256:...", "config": {}},
      "model": {"digest": "sha256:...", "config": {}, "credentials": {}},
      "harnessSession": {"digest": "sha256:...", "config": {}, "credentials": {}},
      "toolCatalog": {"digest": "sha256:...", "config": {}},
      "toolExecution": {"digest": "sha256:...", "config": {}, "credentials": {}},
      "gatewayExecution": {"digest": "sha256:...", "config": {}}
    }
  }
}
```

| Field | Role | Rule |
|---|---|---|
| `schemaVersion` | Protocol context | Integer version of this private contract. |
| `source` | Routing and protocol context | Provenance used to build every facet. |
| `configuration.fingerprint` | Metadata | Digest over secret-free canonical configuration. |
| `configuration.facets` | Config and policy | Complete runner-safe desired values grouped by lifecycle. |

`configuration.fingerprint` is `sha256:` plus SHA-256 over `strictCanonicalJson` of
`{"schemaVersion":1,"facets":{<facetName>:<verifiedFacetDigest>}}` with every schema facet
present. The runner recomputes it after verifying individual facet digests.

Every use of `strictCanonicalJson` in this contract means the ten-rule serializer in
[execution-authorization.md section 2.3.3](../agent-config-editing/contracts/execution-authorization.md#233-strictcanonicaljson),
followed by SHA-256 over its UTF-8 bytes. Python implements those exact rules rather than a
different JSON canonicalization standard. Shared Python/TypeScript fixtures cover key order,
JSON-looking strings, numbers, lone surrogates, and rejection cases.

This `configuration.fingerprint` covers only the stable snapshot. It is distinct from the
legacy runner session-compatibility `configFingerprint`, which may continue to include
invocation delivery such as callback endpoint until session identity migrates to the facet
model. Refresh never attributes that legacy delivery value to a committed revision.

The facet registry is exhaustive for schema version 1:

| Facet | Existing `/run` fields and resolved values |
|---|---|
| `topology` | `harness`, `sandbox`, `sandboxPermission` |
| `runtime` | Process/runtime provider settings derived from the selected backend |
| `workspaceFiles` | `agentsMd`, resolved `skills`, and their complete managed-file projection |
| `prompts` | `systemPrompt`, `appendSystemPrompt` |
| `harnessFiles` | Complete `harnessFiles` set |
| `model` | `model`, `modelCapabilities`, `connection`, `modelConnection`, with model credentials nested here |
| `harnessSession` | `harnessMode`, `permissions`, `mcpServers`, with MCP credentials nested here |
| `toolCatalog` | Model-visible projection of `customTools` |
| `toolExecution` | Stable private dispatch descriptors, credential bindings, static headers, and code-tool environment values for all tools, including generic gateway routes; excludes per-invocation callback endpoint and authorization |
| `gatewayExecution` | `gatewayPolicy`, integration connection and action bindings, search filtering, and approval generation |

The existing `ToolExecutionPlan` is a run-time aggregate: its stable descriptors come from
`toolExecution`, while callback endpoint, callback authorization, and current run context
come from `RunInvocationEnvelope`. Their per-integration policy, resource binding, and
approval behavior belong to `gatewayExecution`. Current trace, span, run, telemetry
authorization, and exporter context are invocation-owned and never refreshed from a commit.

`toolCatalog` and `toolExecution` are two facets in one atomic tools dependency group. They
share the existing catalog generation. A model-visible catalog change and its private
execution plan never publish independently. An execution-only change may keep the public
manifest bytes unchanged, but it still advances their shared generation as defined by the
harness reconciliation contract.

`source` is a discriminated union:

```ts
type SnapshotSource =
  | {
      kind: "committed"
      variantId: string
      revisionId: string
      version: string
      sequence: number
    }
  | {
      kind: "inline"
      parametersFingerprint: string
    }
```

Initial `/run` accepts either source because a playground invocation can use unsaved inline
parameters. Asynchronous apply accepts only `kind: committed`. The resolved facet serializer
is shared in both cases; committed revision identity is not required to represent an inline
initial run.

`parametersFingerprint` is `sha256:` plus SHA-256 over `strictCanonicalJson` of normalized
`parameters.agent`, after every declared credential value is replaced by its stable,
secret-free binding identifier. A literal credential without a resource binding is replaced
by `{"$credential":"literal"}` at its existing JSON path; its bytes never enter the
fingerprint, and its runner-local credential epoch detects rotation. An invocation is
`committed` only when the service retrieved the exact immutable revision identified by the
request. Supplied effective or unsaved parameters are `inline`, even when their bytes happen
to equal a revision.

Each facet has a strict Python and TypeScript DTO with unknown fields rejected. The DTOs
reuse the corresponding `/run` value models rather than accepting untyped objects or arrays.
The apply endpoint uses a dedicated `MAX_CONFIGURATION_APPLY_BODY_BYTES` no smaller than the
largest stable configuration snapshot accepted by `/run`. The implementation must prove that
every accepted initial stable snapshot is also transportable by apply; it must not inherit the
smaller tool-callback body limit.

The snapshot excludes:

- messages and attachments;
- session and turn identity;
- current trace and span identity;
- current run context values;
- callback endpoint and callback authorization;
- current telemetry authorization and exporter context;
- interaction and approval state;
- model output or tool results;
- the redacted authored replay blob in `effectiveParameters`.

The snapshot uses the same builder and serializer for initial `/run` configuration and
asynchronous apply. An initial run combines it with a separate invocation envelope.

### Initial `/run` projection

Initial `/run` keeps the existing flattened `AgentRunRequest` configuration fields. The
service projects each facet's `config` and `credentials` back to the fields listed in the
facet registry, then adds one secret-free metadata sibling:

```json
{
  "harness": "...",
  "model": "...",
  "customTools": [],
  "messages": [],
  "runContext": {},
  "toolCallback": {"endpoint": "...", "authorization": "..."},
  "configurationState": {
    "schemaVersion": 1,
    "boundVariantId": "v1",
    "source": {"kind": "inline", "parametersFingerprint": "sha256:..."},
    "fingerprint": "sha256:...",
    "facets": {
      "topology": {"digest": "sha256:..."},
      "runtime": {"digest": "sha256:..."},
      "workspaceFiles": {"digest": "sha256:..."},
      "prompts": {"digest": "sha256:..."},
      "harnessFiles": {"digest": "sha256:..."},
      "model": {"digest": "sha256:..."},
      "harnessSession": {"digest": "sha256:..."},
      "toolCatalog": {"digest": "sha256:..."},
      "toolExecution": {"digest": "sha256:..."},
      "gatewayExecution": {"digest": "sha256:..."}
    }
  }
}
```

The facet registry is the exhaustive projection map; no stable value exists only in
`configurationState`, and config or credential bytes are not duplicated there. Messages,
attachments, current run context, callback delivery, and telemetry form the invocation
envelope and remain in their existing `/run` fields. `gatewayPolicy` is omitted when
`gatewayExecution.config.integrations` is empty, preserving the existing wire contract; the
runner normalizes omission to `{version: 1, integrations: {}}` before digest verification.
Otherwise `gatewayPolicy` is exactly `GatewayExecutionConfig`.

After strict intake, the runner reconstructs every facet from the flattened fields, recomputes
and verifies its digest, derives local credential epochs, binds the active run to
`configurationState.boundVariantId`, and initializes `desired` and
`lastKnownInstalled` to the supplied source with `installedTrusted: true`. Runner-owned
facets initialize `observed` to the same generation. Harness-owned facets initialize observed
state only from the governing adapter acknowledgement. A committed initial source initializes
`announcedSource` and its sequence; an inline source initializes no announced committed source.
The first control event still must match `boundVariantId`. If `configurationState` is absent, an
older request follows legacy run behavior and the runner does not advertise an actionable
refresh target.

Credential values do not enter `fingerprint`, event metadata, status responses, logs, or
traces. The service and runner extend their active redactors before inspecting or applying
the snapshot.

Schema version 1 permits secrets only in these typed credential containers:

- `snapshot.configuration.facets.runtime.credentials.environment` for process environment
  secret values;
- `snapshot.configuration.facets.model.credentials.provider` for model-provider
  authentication;
- `snapshot.configuration.facets.harnessSession.credentials.mcp` for MCP authentication;
- `snapshot.configuration.facets.toolExecution.credentials.staticHeaders` and
  `snapshot.configuration.facets.toolExecution.credentials.codeEnvironment` for tool-owned
  secrets.

The bounded pre-validation scan reads string leaves only under those exact paths. Typed
validation rejects unknown credential containers and unknown fields without logging the raw
value or body. The service also extends its redactor from every secret it resolved before
serialization. Arbitrary authored data outside a credential field is not inferred to be a
secret.

If the desired topology differs from active topology and topology installation is
unsupported, the runner also reports every harness-dependent facet unsupported. It does not
apply values adapted for a different harness or sandbox.

Schema version 1 fixes these dependencies:

| Group | Depends on | Application boundary |
|---|---|---|
| Topology | None | Environment rebuild only initially. |
| Runtime | Topology | Environment process boundary. |
| Workspace files | Topology, runtime | Managed-file set replacement. |
| Prompts | Topology, runtime | Harness adapter. |
| Harness files | Topology, runtime | Managed-file set replacement. |
| Model | Topology, runtime, harness session | Harness adapter. |
| Harness session | Topology, runtime | Harness adapter. |
| Tools (`toolCatalog` plus `toolExecution`) | Topology, runtime, harness session | Between turns only; never while approval-suspended. |
| Gateway execution | None for private preinstallation | Runner-owned atomic cell; calls remain blocked unless matching generic gateway descriptors exist in the installed tools generation. |

An unchanged dependency does not block an independently changed group. A changed unsupported
dependency blocks only its descendants. Gateway execution may preinstall for a first
connection, but it is not callable until the matching generic descriptors install. An
execution-only tools change advances the shared tools generation and both tools facets'
installed source; if public catalog bytes are unchanged, harness observation remains on the
prior source because no harness reconciliation occurred.

When a tools change cannot publish during the active or approval-suspended turn, the runner
immediately installs a fail-closed safety overlay for every tool whose permission,
credential binding, dispatch, or execution semantics changed. The overlay invalidates pending
approvals and blocks execution until the complete tools group installs; it never grants new
access. The environment reconciliation state owns only the latest pending tools snapshot and
its attempt token. Newer sequences supersede older pending work. A session-backed environment
applies it after the current turn ends and before the next starts. Active-target cleanup does
not delete environment-owned pending work. Ephemeral environments discard it at teardown and
recover through ordinary resolution on the next run.

## 4. Apply request

Owner: agent service refresh handler. Reader: owning runner process.

The service gives the opaque target and delivery credential to its configured runner
transport. The transport routes by `ownerId`; it never accepts an arbitrary destination URL.
The body contains no callback credential:

```json
{
  "eventId": "01K...",
  "target": {
    "activeRunId": "...",
    "ownerId": "...",
    "sessionId": "...",
    "turnId": "..."
  },
  "snapshot": {
    "schemaVersion": 1,
    "source": {
      "kind": "committed",
      "variantId": "...",
      "revisionId": "...",
      "version": "12",
      "sequence": 12
    },
    "configuration": {}
  }
}
```

| Field | Role | Rule |
|---|---|---|
| `eventId` | Protocol context | Connects apply telemetry to the invalidation. |
| `target` | Routing and protocol context | Must exactly match the callback credential binding. |
| `snapshot` | Config, policy, and credentials | Complete desired resolved configuration. |

The runner validates before any mutation:

1. Delivery credential, expiry, apply-only scope, owner, and active-run binding.
2. Exact active-run match and optional session and turn match.
3. Active target exists on this process.
4. Raw body is within `MAX_CONFIGURATION_APPLY_BODY_BYTES` and snapshot schema version is
   supported.
5. Snapshot source has `kind: committed`, equals the event source registered for this
   `eventId`, and its variant equals the active run's bound variant.
6. Sequence is not below the highest announced sequence for the active run.
7. A bounded, non-logging raw scan extracts string values only from declared credential
   containers and extends the active redactor. Failure returns one value-free error.
8. Every facet and credential arm passes strict typed intake. Validation errors contain paths
   and codes only, never rejected values or the raw body.

The service verifies before transport that its captured refresh principal retrieved the
committed source from the same project as the original authenticated invocation. The runner
does not repeat an API authorization decision for which it has no principal.

## 5. Apply response

The service may log aggregate status and metrics. It does not turn this response into a
model-visible event.

```json
{
  "status": "accepted",
  "source": {
    "kind": "committed",
    "variantId": "v1",
    "revisionId": "...",
    "version": "12",
    "sequence": 12
  },
  "facets": {
    "gatewayExecution": {
      "status": "installed",
      "installedSource": {"kind": "committed", "variantId": "v1", "revisionId": "...", "version": "12", "sequence": 12},
      "observedSource": {"kind": "committed", "variantId": "v1", "revisionId": "...", "version": "12", "sequence": 12}
    },
    "workspaceFiles": {
      "status": "installed",
      "installedSource": {"kind": "committed", "variantId": "v1", "revisionId": "...", "version": "12", "sequence": 12},
      "observedSource": {"kind": "inline", "parametersFingerprint": "sha256:..."}
    },
    "harnessSession": {
      "status": "unsupported",
      "installedSource": {"kind": "inline", "parametersFingerprint": "sha256:..."}
    },
    "toolCatalog": {
      "status": "pending",
      "installedSource": {"kind": "inline", "parametersFingerprint": "sha256:..."}
    }
  }
}
```

Top-level status values:

| Value | Meaning |
|---|---|
| `accepted` | Snapshot was valid and at least one facet was evaluated. |
| `duplicate` | This event or revision was already processed. |
| `stale_revision` | A newer revision was already announced. |
| `stale_target` | The active run ended or moved before delivery. |
| `rejected` | Authentication, schema, scope, size, or secret validation failed. |

Facet status values:

| Value | Meaning |
|---|---|
| `unchanged` | Desired and installed values already match. |
| `installed` | The runner or adapter installed the complete dependency group. |
| `unsupported` | No installation mechanism exists for this active runtime. |
| `failed` | An attempted installation failed and the prior value remains. |
| `dirty` | The mechanism may have changed external state before failure. Prior installed state is no longer trusted. |
| `superseded` | A newer attempt replaced this one before publication. |
| `pending` | A generation-fenced installation is retained for an allowed lifecycle boundary. |

Errors use stable codes and never include configuration or credential values.

## 6. Per-facet state

```ts
type FacetInstallationStatus =
  | "unchanged"
  | "pending"
  | "installing"
  | "installed"
  | "unsupported"
  | "failed"
  | "dirty"
  | "superseded"

interface FacetState {
  desired: FacetGeneration
  lastKnownInstalled?: FacetGeneration
  installedTrusted: boolean
  observed?: FacetGeneration
  status: FacetInstallationStatus
  attemptId?: string
  errorCode?: string
}

interface FacetGeneration {
  digest: string
  source: SnapshotSource
  credentialEpoch?: string // runner-local only; never serialized or logged
}
```

The active-run registry separately stores `announcedSource`, the committed ordering watermark.
An announcement advances it before resolution. A validated snapshot advances every facet's
`desired`, including unsupported facets. Resolution failure advances neither desired nor
installed state.

`unchanged` requires both generation equality and `installedTrusted: true`. A dirty group
must reconcile again even when its last known digest and epoch equal desired.

Secret values are not part of digests. Each facet's credential bytes publish with the
configuration that consumes them. The runner derives `credentialEpoch` with a process-local
key from credential material. `unchanged` comparison and atomic publication compare both
digest and credential epoch. A credential failure prevents that dependency group from
publishing.

Publishing one dependency group updates every member's last known installed state in one
critical section. A partially prepared group never advances it. A dirty result preserves the
last known value for diagnostics but sets `installedTrusted: false`; reconciliation must not
claim that value is current. Observations carry only a runner-issued pending-generation token.
The runner resolves it to its own installed generation and never trusts adapter-provided
digest or source values.

## 7. Gateway execution generation

`gatewayExecution.config` is the strict `GatewayExecutionConfig` DTO. Initial `/run` projects
it to the existing top-level `gatewayPolicy` field; asynchronous apply carries the same DTO
under the facet:

```ts
interface GatewayExecutionConfig {
  version: 1
  integrations: Record<string, {
    provider: string
    connection: string
    toolkitVersion: string
    connectionBinding: string
    tools: Record<string, {
      permission: "allow" | "ask" | "deny"
      readOnly: boolean | null
      executionBinding: string
    }>
  }>
}
```

Gateway approval and execution bind to the facet digest over this secret-free config:

```json
{
  "version": 1,
  "integrations": {
    "googledrive": {
      "provider": "composio",
      "connection": "drive-main",
      "toolkitVersion": "20250827_00",
      "connectionBinding": "opaque:...",
      "tools": {
        "FIND_FILE": {
          "permission": "allow",
          "readOnly": true,
          "executionBinding": "opaque:..."
        }
      }
    }
  }
}
```

`gatewayExecutionGeneration` equals `gatewayExecution.digest`, including the standard facet
domain wrapper. Strict canonical JSON sorts integration names and tool keys. The config
includes opaque connection and action bindings because those values change the provider
destination a person approves. It excludes callback endpoint and authorization because they
are per-invocation delivery values.

`POST /tools/resolve` produces `connectionBinding` from the actual provider account instance,
not only the local connection row. It produces each `executionBinding` from the
immutable/versioned canonical provider action definition, not only its stable key. The SDK
carries those opaque private values into `gatewayExecution`; the runner carries the selected
bindings in private gateway callback context.

Approval uses a composite `gatewayCallGeneration` computed over `catalogGeneration` and this
gateway execution generation. A changed generic dispatch descriptor therefore invalidates an
old gateway approval even when gateway policy itself is unchanged.

The exact composite is `sha256:` plus SHA-256 over `strictCanonicalJson` of:

```json
{
  "version": 1,
  "domain": "agenta.gateway-call",
  "catalogGeneration": "sha256:...",
  "gatewayExecutionGeneration": "sha256:..."
}
```

The composite generation and opaque bindings are required at five points:

1. The gateway gate computes the approval key from integration, tool, canonical arguments,
   and generation.
2. The approval interaction persists the generation beside the safe call representation.
   It also persists bound variant ID and captured snapshot source.
3. Durable decision lookup requires an exact generation and source match. On cold resume, the
   service first retrieves and resolves the bound variant's current committed head under the
   captured project principal; replayed effective parameters are not authority. Failure or
   mismatch refuses the stored approval.
4. Approval resume and final callback dispatch require the approved and captured generations
   to equal the runner's currently installed composite generation and pass the current
   fail-closed safety overlay. Publication invalidates affected pending approvals.
   Authenticated callback dispatch is the irreversible linearization point; a callback already
   sent to the API may finish validation and provider execution under an older generation.
5. API execution reads one immutable/versioned connection-and-catalog snapshot, checks the
   captured opaque bindings, and selects credentials plus canonical action from that same
   snapshot before calling the provider. Reconnect or catalog update cannot interleave between
   verification and selection.

A mismatch refuses the old approval. It does not create a new message or automatic approval
request.

## 8. Compatibility

- Older APIs omit `control_events`; commits behave exactly as today.
- Older runners ignore unknown callback siblings and emit no control record.
- The runner emits `kind: control` only when the `/run` request advertises
  `configuration-control-v1`. Older SDKs omit it and never receive a control record.
- Runner transports without trusted owner routing report refresh unsupported and emit no
  actionable delivery target.
- The ordinary next `/run` remains the complete recovery path.
