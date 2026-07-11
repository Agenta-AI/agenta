# Research

Research date: 2026-07-10. External behavior was checked against Daytona's current documentation,
SDK package, npm metadata, and public source history. No live Daytona resources were created.

## 1. Current Agenta behavior

### TypeScript agent runner

The live agent runner receives provider credentials as `AgentRunRequest.secrets`, currently
documented as `{OPENAI_API_KEY: value, ...}`
(`services/runner/src/protocol.ts:390-402`). The Python service fills this map from the selected
`ResolvedConnection.env` (`sdks/python/agenta/sdk/agents/handler.py:278-307`). The connection
resolver is already least-privilege for model credentials: it selects one connection rather than
copying the whole provider vault.

For Daytona, `daytonaEnvVars` spreads the resolved values directly into the sandbox environment
(`services/runner/src/engines/sandbox_agent/daytona.ts:31-45`). `buildDaytonaCreate` passes that map
as `envVars` (`services/runner/src/engines/sandbox_agent/provider.ts:78-101`). Sandbox processes can
read the plaintext.

The runner deliberately blanks its own `DAYTONA_API_KEY` and other sandbox infrastructure
credentials before starting the daemon (`services/runner/src/engines/sandbox_agent/daemon.ts`).
Tool callback authorization and most private tool configuration remain on the runner. The new
design must preserve those boundaries.

### Legacy Python Daytona evaluator

The older Python Daytona evaluator also sends `AGENTA_API_KEY`, `AGENTA_CREDENTIALS`, and provider
keys through `env_vars`
(`sdks/python/agenta/sdk/engines/running/runners/daytona.py:275-301`). That path is separate from the
TypeScript agent runner. It should not be migrated implicitly. If it remains supported, it needs a
separate follow-up because this design explicitly keeps Agenta credentials out of Daytona Secrets.

### Agenta vault and custom secrets

Agenta stores vault payloads through PostgreSQL `pgp_sym_encrypt` and decrypts them only under the
configured data-encryption context
(`api/oss/src/dbs/postgres/secrets/custom_fields.py:12-63`). `custom_secret` supports text or flat
JSON payloads (`api/oss/src/core/secrets/enums.py:4-14`,
`api/oss/src/core/secrets/dtos.py:71-78`).

The SDK contains a named-secret client that calls `POST /secrets/resolve`, but the current API
vault router does not register that batch endpoint
(`sdks/python/agenta/sdk/agents/platform/secrets.py:30-78`,
`api/oss/src/apis/fastapi/vault/router.py:25-72`). Custom-secret delivery therefore has a backend
prerequisite or must use an existing authorized read-by-slug path. This mismatch should be fixed
without broadening which secrets a run may resolve.

Current authored secret references are consumer-scoped:

- a selected model connection resolves one provider credential;
- MCP `secrets` maps a header or environment name to a vault secret name;
- code-tool `secrets` names only the values that tool requested.

There is no general agent-wide custom-secret list. That is a useful least-privilege property.

## 2. What Daytona Secrets guarantee

Daytona documents Secrets as organization-scoped, encrypted credentials. The API accepts the
plaintext only on create or update and never returns it. The sandbox environment contains an
opaque `dtn_secret_*` placeholder. Daytona substitutes the real value in outbound HTTP(S) traffic
only for allowed hosts. Requests to other hosts keep the placeholder unchanged.

Primary sources:

- [Daytona Secrets guide](https://www.daytona.io/docs/en/secrets/)
- [Daytona TypeScript SDK](https://www.daytona.io/docs/en/typescript-sdk/)
- [SDK feature commit](https://github.com/daytona/clients/commit/6e763de2c7e6655d58c1371ad8ea4c48d88842d8)

Important semantics:

- `daytona.secret.create({name, value, hosts})` creates an organization Secret.
- Sandbox creation accepts `secrets: {ENV_VAR: secretName}`.
- Omitting `hosts` makes a Secret unrestricted. Agenta must never omit it.
- Rotating a Secret preserves its placeholder and reaches attached sandboxes within about 15
  seconds.
- `sandbox.updateSecrets(...)` replaces the attached set, but new environment variables appear
  only in newly spawned processes. A sandbox created with no secrets must restart before newly
  attached secrets work.
- Secret management needs `manage:secrets`. Sandbox creation or attachment uses
  `write:sandboxes`. Operations appear in Daytona audit logs with masked values.
- Daytona documents no per-Secret TTL, sandbox ownership link, automatic cascade delete, or
  public quota for this feature. Agenta must own cleanup and verify limits in a live spike.

## 3. Feasibility by credential type

| Credential | Feasible with Daytona Secrets? | Reason |
|---|---:|---|
| OpenAI, Anthropic, Mistral, Groq, Gemini and similar API keys | Yes | Client sends the unchanged value in an HTTP header or request. |
| Azure OpenAI API key | Yes, with a derived exact host | The selected custom endpoint supplies the destination host. |
| Custom-provider text API key | Usually | Works when the client sends it unchanged over HTTP(S) and the endpoint host is known. |
| Text `custom_secret` used as bearer token or API key | Yes, with an explicit consumer and hosts | The value is opaque and does not need local transformation. |
| MCP HTTP authorization | Technically yes | The adapter must receive the placeholder, not the plaintext. Backend gateway delivery may still be safer and works across sandbox providers. |
| AWS access key, secret key, and session token | No | AWS clients need the plaintext to compute SigV4 signatures locally. Replacing a placeholder after signing invalidates the signature. |
| `GOOGLE_APPLICATION_CREDENTIALS` JSON or file path | No | Code must parse and use the credential locally. A placeholder is not valid JSON or a file. |
| JSON custom secret | Not generally | Code that parses the environment value sees the placeholder. It works only if the entire JSON string is forwarded unchanged in HTTP(S). |
| Private key, signing seed, encryption key | No | The sandbox needs plaintext for local cryptographic operations. |
| Database password over a native database protocol | No | Daytona documents substitution for HTTP(S), not arbitrary TCP protocols. |
| Agenta callback or API credential | Do not attach | Agenta calls should execute on the runner or backend, outside the sandbox. |
| Scoped mount STS credentials | No | The in-sandbox mount client performs AWS signing. Keep them short-lived and prefix-scoped, or move the mount outside the sandbox. |

The existing custom-provider resolver can emit both opaque keys and locally used cloud
credentials (`sdks/python/agenta/sdk/agents/platform/connections.py:116-157`). The runner cannot
treat every entry in `ResolvedConnection.env` alike. It must partition non-secret configuration,
proxy-substitutable credentials, and unsupported confidential material.

## 4. The organization-scope constraint

Daytona does not offer a sandbox-local secret object. Every Secret is organization-scoped. The
closest safe match to the requested behavior is an ephemeral organization Secret with a random
name, created for one sandbox and deleted with that sandbox.

The plaintext must remain stored by Daytona while the sandbox uses it. Deleting the Secret right
after sandbox creation would remove the value the egress proxy needs. Therefore we cannot both use
Daytona Secrets and avoid organization-scoped storage entirely.

We can minimize exposure:

- create one unique Secret per sandbox binding;
- use an opaque random lease identifier and never include project, provider, or environment names
  in the Daytona Secret name;
- attach an exact, non-empty host allowlist;
- keep only Secret IDs, names, hosts, and lifecycle metadata in Agenta state, never a second copy
  of the plaintext;
- delete after sandbox destruction;
- reconcile orphans after crashes.

The Daytona API key gains `manage:secrets`, which can create, rotate, and delete every Secret in
its organization. This is broader and more destructive than sandbox-only permissions. A dedicated
runner API key and a dedicated Daytona organization or environment reduce the blast radius.

## 5. Lifecycle and reconnect risks

The runner creates resumable Daytona sessions and stores a sandbox ID in session state
(`services/runner/src/engines/sandbox_agent/sandbox-reconnect.ts:25-77`). A credential lease must
live as long as that sandbox, including stopped or archived periods.

The current `sandbox-agent` Daytona provider has no `pause` method. Its generic `pauseSandbox()`
falls back to deleting the sandbox but reports successful completion to the caller. The runner then
treats it as parked (`services/runner/node_modules/sandbox-agent/dist/providers/daytona.js:16-57`,
`services/runner/node_modules/sandbox-agent/dist/chunk-TVCDKGSM.js:1226-1243`,
`services/runner/src/engines/sandbox_agent.ts:808-817`). A secret implementation layered on this
behavior could retain credentials for a sandbox that was already deleted. The current SDK adds a
native `Sandbox.pause()` method, but the wrapper does not expose it.

This is a prerequisite for reliable leases: the provider adapter must distinguish pause from
delete and call lease cleanup only after confirmed deletion.

Failure cases require saga-style compensation:

1. Secret creation partly succeeds, then another Secret fails. Delete the ones already created.
2. Secrets succeed, then sandbox creation fails. Delete all lease Secrets.
3. Sandbox succeeds, then state persistence fails. Keep the live lease in memory and register it
   for reconciliation; do not delete a credential out from under a live run.
4. Runner crashes. A janitor compares Agenta-owned Daytona Secret leases with live sandboxes and
   deletes only expired, unreferenced leases.
5. Sandbox auto-delete runs without runner teardown. The janitor removes the orphan Secrets.

## 6. SDK upgrade risk

The runner pins `@daytonaio/sdk` 0.187.0 through its lockfile and uses `sandbox-agent` 0.4.2
(`services/runner/package.json:22-35`). The old package name is deprecated in favor of
`@daytona/sdk`.

Daytona Secrets landed on 2026-06-26 and first shipped in 0.192.0. The current release checked on
2026-07-10 is 0.196.0. The Secret list API then made a documented breaking pagination change on
2026-07-06. This is a fast-moving API, so use an exact version rather than the current caret range.

The public type diff from 0.187.0 to 0.196.0 is mostly additive for Agenta's current calls:

- sandbox create adds `secrets` and `domainAllowList`;
- `Daytona` adds `secret`;
- `Sandbox` adds `pause`, `updateSecrets`, and `updateEnv`;
- existing `create`, `get`, process execution, signed preview, and delete APIs remain.

Risks remain:

- generated API clients and OpenTelemetry dependencies change across nine releases;
- the package namespace migration conflicts with `sandbox-agent`, which imports the deprecated
  package name as a peer dependency;
- self-hosted or pinned Daytona control planes older than the feature will reject Secret APIs;
- the list API changed once already and reconciliation depends on correct pagination;
- no current Agenta live test covers Secret creation, proxy substitution, rotation, or cleanup.

Upgrade risk is medium, not high. The methods Agenta already uses remain compatible, but the new
security guarantee depends on recently released control-plane and proxy behavior that needs live
verification.

## 7. Security limits that remain

- The runner and Daytona control plane see plaintext during Secret creation or rotation.
- The Python service-to-runner wire still contains plaintext model credentials. This project moves
  the boundary at the sandbox, not at the sidecar transport.
- The agent can spend or otherwise use the credential against allowed hosts.
- An allowed host that reflects credentials could reveal them. Host allowlists must name trusted,
  purpose-specific API hosts, not broad wildcards.
- Redirect handling, ports, DNS rebinding, proxy logs, quota behavior, and orphan cleanup are not
  documented deeply enough to accept without a live security spike.
- Self-managed OAuth files uploaded into the sandbox remain readable and are outside this design.
