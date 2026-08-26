# Gateway permission architecture

This page defines where gateway permission data is stored, where effective permissions
are computed, and where calls are enforced. The saved configuration is defined in
[data-model.md](data-model.md). The model-facing tools are defined in
[runtime-tools.md](runtime-tools.md).

## Decision

Keep the existing permission responsibilities:

- The agent revision stores authored permission policy.
- The Tools API owns gateway connections, catalog metadata, provider tool identity, and
  provider execution.
- The Python SDK compiles authored policy and catalog metadata into effective per-tool
  permissions at run start.
- The runner enforces those permissions and owns approval, pause, and resume.
- The harness allows the gateway runtime tools to reach the runner. It does not decide
  permissions for individual integration tools.
- The Sessions API stores approval interactions and delivers answers back to the runner.

There is no API policy service, run-scoped policy record, or signed policy capability in
this design.

## Responsibility map

| Component | Owns | Does not own |
| --- | --- | --- |
| Agent revision | Connection references and authored permission policy | Resolved catalog metadata, credentials, runtime approval state |
| Tools API catalog | Canonical tool keys, provider tool IDs, schemas, and `read_only` hints | Agent permission decisions |
| Python SDK | Config parsing, compatibility, and effective permission compilation | Human interaction state, provider execution |
| Runner | Permission enforcement, operator override, approval, pause, and resume | Connection storage, provider catalog, Composio credentials |
| Harness | Model loop and delivery of gateway calls to the runner | Per-integration-tool permission policy |
| Tools API execution | RBAC, connection validation, tool-to-integration validation, provider mapping, and execution | Agent revision permission evaluation, approval orchestration |
| Sessions API | Durable approval interactions and response delivery | Permission computation, provider execution |

## Trust model

This design preserves the current trust boundary:

- The runner is trusted.
- Callback credentials and private resolved configuration do not enter the sandbox.
- The model cannot edit the resolved gateway policy or the callback connection context.
- Sandbox-written relay requests are untrusted and pass through the runner's execution
  guard.
- The Tools API enforces project RBAC and validates that a connection and tool belong to
  the requested integration.
- A person with a project credential and `RUN_TOOLS` can call the Tools API directly, as
  today. Agent permission policy governs model execution; it is not project RBAC.

If the product later requires `/tools/call` to prove that one exact agent revision
authorized a call, that is a new security contract. It would require server-side run
state or a verifiable run-scoped capability and is outside this design.

## Saved policy

The agent revision stores one policy per gateway connection:

```json
{
  "type": "gateway_connection",
  "connection": {
    "provider": "composio",
    "integration": "github",
    "slug": "github-work"
  },
  "policy": {
    "permissions": {
      "default": "deny",
      "tools": {
        "GET_ISSUE": "inherit",
        "CREATE_ISSUE": "ask",
        "DELETE_REPOSITORY": "deny"
      }
    }
  }
}
```

The saved values are `inherit`, `allow`, `ask`, and `deny`. The saved policy does not
contain `read_only`, provider action IDs, resolved connection IDs, or credentials.

## Catalog input

At run start, the SDK gateway resolver obtains trusted metadata for each configured
integration from the Tools API catalog. The permission compiler needs these fields for
each catalog tool:

```json
{
  "key": "GET_ISSUE",
  "read_only": true
}
```

The catalog may carry additional fields for runtime discovery and execution. Permission
compilation depends only on the stable Agenta tool key and the tri-state `read_only` hint:

- `true`: a read operation;
- `false`: a write operation;
- absent: unknown, treated like a write under `allow_reads`.

Provider metadata is a classification input. It never overrides an explicit authored or
operator `deny`.

## SDK permission compilation

The compiler is a pure SDK function. Its inputs are:

- one `gateway_connection` policy;
- the integration's catalog tools and `read_only` hints;
- the agent-wide runner permission mode.

Its output contains only effective `allow`, `ask`, or `deny` values. `inherit` does not
cross the service-to-runner boundary.

For each catalog tool, the compiler applies this order:

1. Use the exact value in `policy.permissions.tools` when present.
2. Otherwise use `policy.permissions.default`.
3. If the selected value is `inherit`, apply the agent-wide runner mode.
4. Under `allow_reads`, resolve `read_only: true` to `allow`; resolve `false` or unknown
   to `ask`.

An exact configured tool that is missing from the current catalog remains visible as a
stale authoring entry, but it does not become an executable resolved tool.

The compiler belongs with the canonical agent configuration models, for example:

```text
sdks/python/agenta/sdk/agents/tools/gateway_policy.py
```

It must not import API models. The API catalog response and SDK input model share a
portable contract containing the fields above.

## Resolved policy

The SDK sends one private resolved policy object to the runner. A representative wire
shape is:

```json
{
  "gatewayPolicy": {
    "integrations": {
      "github": {
        "provider": "composio",
        "connection": "github-work",
        "tools": {
          "GET_ISSUE": {
            "permission": "allow",
            "readOnly": true
          },
          "CREATE_ISSUE": {
            "permission": "ask",
            "readOnly": false
          },
          "DELETE_REPOSITORY": {
            "permission": "deny",
            "readOnly": false
          }
        }
      }
    }
  }
}
```

This is private runtime policy, not model input. The public tool specifications and model
schemas do not expose the connection slug or permission table.

The Python and TypeScript wire models must define and test the same shape. The exact wire
placement can change during implementation, but the data must remain structured. It must
not be encoded in a tool name or `call_ref`.

## Runner enforcement

The harness permits the gateway runtime tools by their coarse names so their calls reach
the runner. The harness does not receive one rule per integration tool.

When the model requests an integration tool, the runner:

1. Reads the integration and tool key from the model call.
2. Looks up the exact entry in the private resolved policy.
3. Treats a missing integration or tool as `deny`.
4. Applies the operator override before the compiled permission.
5. Rejects `deny`, continues on `allow`, or starts approval on `ask`.

The runner must perform this check on every delivery path, including sandbox relay files.
The model naming a tool is not proof that the tool is permitted.

## Search visibility

The Tools API calls Composio search and translates provider results into Agenta integration
and tool keys. It does not apply the agent permission map.

Before a search result reaches the model, the trusted runner compares it with the private
resolved policy:

1. Remove results from integrations not configured on the agent.
2. Remove tool keys missing from the resolved policy.
3. Remove tools whose compiled permission is `deny`.

The runner applies the same policy again when the model requests execution. Search
filtering is not an execution authorization boundary.

## Approval

The runner owns approval because it already owns the model turn and session lifecycle. For
an `ask` call, it:

1. Normalizes the call shape used for approval matching.
2. Creates a `user_approval` interaction containing the integration, tool, and safe
   representation of the arguments.
3. Records the pending interaction through the existing Sessions API.
4. Pauses the turn.
5. Resumes after the interaction answer arrives.
6. Consumes the answer for that pending call and continues only when approved.

The Tools API does not pause a run. The existing client-tool and approval machinery is
extended in the runner for the semantic gateway-tool identity.

Approval identity must include the integration and tool key in addition to the canonical
arguments. Keying only on the coarse runtime tool name would mix unrelated integration
tools.

## Operator override

The deployment-wide deny switch is a separate operator policy. It is not compiled into the
SDK result because it can change after run start.

The runner applies it before every authored permission:

```text
operator deny
    > compiled tool permission
    > stored approval answer
```

The current implementation represents the operator switch by replacing only the runner
default. Explicit tool permissions are checked before that default, so an explicit `allow`
can currently win. This must be corrected so the operator switch is a first-class,
top-priority condition.

## API execution

The API changes for grouped gateway tools, but it does not become the permission engine.

The model supplies the integration, tool key, and arguments to the runner. After validating
them against the resolved policy, the runner sends the selected provider, integration,
connection, and tool as private callback context. Only the integration tool's arguments
remain in the callback function arguments. A representative callback shape is:

```json
{
  "data": {
    "id": "tool-call-id",
    "type": "function",
    "function": {
      "name": "gateway.run",
      "arguments": {
        "channel": "#general",
        "text": "hello"
      }
    }
  },
  "context": {
    "provider": "composio",
    "integration": "slack",
    "connection": "slack-main",
    "tool": "SEND_MESSAGE"
  }
}
```

The API performs these checks at call time:

1. The caller has project-level `RUN_TOOLS` access.
2. The connection belongs to the project, provider, and integration.
3. The connection is active and valid.
4. The tool key exists in that integration's catalog.
5. The catalog provides the canonical provider action ID. Execution never reconstructs
   that ID with string concatenation.
6. The arguments have the expected object shape.

The API then executes through the existing provider adapter. These are resource, routing,
and input-validity checks. They are not agent permission computation.

## API changes

| Area | Change |
| --- | --- |
| Gateway resolution | Resolve one grouped connection entry and provide catalog metadata needed by the SDK compiler. |
| Catalog DTOs | Preserve the canonical provider action ID internally instead of rebuilding it from integration and tool strings. |
| Runtime search | Reuse the Composio semantic-search adapter, translate provider results, and return them to the runner for policy filtering. |
| Generic call routing | Accept the stable gateway call route and private connection context instead of parsing policy from `call_ref`. |
| Integration validation | Reject a tool key that does not belong to the selected integration. |
| Argument handling | Reject malformed arguments with an actionable error; do not silently replace them with `{}`. |
| Provider execution | Execute the catalog-resolved provider action against the validated connection. |

The API does not add:

- an agent permission policy service;
- agent-wide permission evaluation;
- approval storage;
- runner pause or resume behavior;
- signed run capabilities;
- per-run policy persistence.

## End-to-end flow

```text
Agent revision
    |
    | authored gateway policy
    v
Python SDK resolver <------ Tools API catalog
    |
    | compiled per-tool allow / ask / deny
    v
Runner
    |
    | semantic tool call
    +---- deny ----> reject
    |
    +---- ask -----> Sessions API <----> browser
    |                    |
    |                    +---- approval answer ----+
    |                                               |
    +---- allow ------------------------------------+
                                                    v
                                         Tools API execution
                                                    |
                                                    v
                                                 Provider
```

## Failure behavior

- Unknown integration: runner denies before callback.
- Unknown tool: runner denies before callback; API also rejects if reached.
- Stale configured tool: omitted from the resolved executable policy and reported to the
  authoring surface.
- Unknown `read_only`: `ask` under `allow_reads`.
- Revoked or invalid connection: API rejects at execution time.
- Malformed arguments: reject before approval or execution; never coerce to an empty
  object.
- Operator deny enabled after run start: runner rejects before using the compiled policy.

## Alternatives not selected

### API-owned policy

The Tools API could receive the agent configuration and compute permission on each call.
This would duplicate the current SDK and runner responsibility, require new run identity at
the callback boundary, and still require the runner to orchestrate approval. It is not used.

### Signed run capability

The SDK or API could issue a verifiable policy artifact for each run. This is useful only
if the Tools API must prove which agent revision authorized a call. The current trust model
does not require that proof, so the additional protocol and key management are not used.

### Harness-owned semantic permission

The harness cannot assign different permissions to integration tools hidden behind one
coarse runtime tool name. Splitting runtime tool names by permission would expose policy as
tool identity and give the model a role in choosing the permission path. It is not used.

### Policy encoded in `call_ref`

Encoding connection policy or allowed tool keys in a routing string creates a second data
format, requires fragile parsing, and couples authorization to naming. Structured private
runtime data replaces it.
