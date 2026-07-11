# Research

Research date: 2026-07-11. Findings combine the current shared worktree, the PR base, Daytona's
current documentation and npm packages, and provider authentication documentation. No Daytona
resource was created for this research.

## 1. Current Agenta credential paths

### Model connections

The Python connection resolver selects one model connection and returns `ResolvedConnection.env`.
The agent handler copies that map into `SessionConfig.secrets`, and the TypeScript runner receives
it as `AgentRunRequest.secrets`.

Relevant code:

- `sdks/python/agenta/sdk/agents/platform/connections.py`
- `sdks/python/agenta/sdk/agents/handler.py`
- `services/runner/src/protocol.ts`

The resolver already separates non-secret endpoint configuration from the credential map. Custom
and Azure connections can carry `endpoint.baseUrl`, API version, and region. Standard direct
providers do not always carry an explicit effective base URL, which leaves the runner without an
authoritative exact host.

The current runner applies resolved provider values to the selected daemon environment. Daytona's
`buildDaytonaCreate` then calls `daytonaEnvVars`, which spreads those values into sandbox
`envVars`. They are plaintext inside the sandbox.

Before building the daemon environment, the runner sets known sandbox-infrastructure variables,
including `DAYTONA_API_KEY`, to the empty string. "Empty" means an explicit `KEY=""` override. An
absent entry would inherit the runner process value through the underlying spawn. This prevents the
runner's Daytona credential from leaking into either local or remote harness processes.

### HTTP MCP credentials

The authored MCP shape already ties a secret reference to a consumer:

```text
mcp server -> url + secrets {header name: vault secret name}
```

The current resolver fetches all requested values, then merges them into `ResolvedMCPServer.env`.
The runner interprets every HTTP MCP `env` entry as an ACP request header. This has two problems for
Daytona isolation:

1. secret and non-secret values lose their classification after the merge;
2. plaintext travels in ACP session configuration to the in-sandbox harness.

The MCP URL is already the right host source. `validateUserMcpUrl` requires HTTPS, resolves DNS,
and blocks loopback, private, link-local, metadata, and disallowed IP targets before attaching
credentials. A revised resolved MCP contract can keep credential headers separate and derive the
exact host from the validated URL without adding another public host field.

Relevant code:

- `sdks/python/agenta/sdk/agents/mcp/resolver.py`
- `sdks/python/agenta/sdk/agents/mcp/models.py`
- `services/runner/src/engines/sandbox_agent/mcp.ts`

The missing-secret policy already defaults to error. The full path must preserve that behavior for
missing names, empty resolved values, authorization failures, and resolver request failures before
sandbox creation.

### Other secrets

Custom tools execute through runner-side callbacks and file relays. Their private callback
configuration does not need to enter Daytona. There is no valid reason to expose an agent-wide
project vault. The first custom-secret use that belongs in this project is an HTTP MCP credential
or another explicit in-sandbox HTTP consumer with its own route.

The legacy Python evaluator is outside this project's scope.

## 2. Daytona Secret semantics

Daytona documents Secrets as organization-scoped credentials that are encrypted at rest. The
plaintext is accepted on create or update and is never returned by Secret reads. A sandbox sees an
opaque `dtn_secret_*` placeholder. The outbound proxy substitutes plaintext only when an HTTP(S)
request carrying that placeholder targets an allowed host.

Primary sources:

- [Daytona Secrets guide](https://www.daytona.io/docs/en/secrets/)
- [Daytona TypeScript Secret API](https://www.daytona.io/docs/en/typescript-sdk/secret/)
- [Daytona SDK feature commit](https://github.com/daytona/clients/commit/6e763de2c7e6655d58c1371ad8ea4c48d88842d8)

Important details:

- Secret names are unique within an organization.
- Sandbox creation accepts `secrets: {ENVIRONMENT_NAME: secretName}`.
- Omitting `hosts` creates an unrestricted Secret. Agenta must never omit the field on create.
- Daytona supports exact hosts and `*.` wildcards. Agenta can apply a stricter policy and reject all
  wildcards in the first version.
- Host entries contain only hostnames, without protocol, path, port, or query.
- Updating a value keeps the placeholder stable and propagates within about 15 seconds.
- Update uses PATCH semantics. Omitted fields remain unchanged. Omitting `hosts` on update does not
  itself remove the allowlist.
- A later Agenta rotation path should still resend and verify the approved exact host list. This
  repairs a Secret that an organization administrator may have widened outside the runner.
- Secret management requires `manage:secrets`; sandbox attachment requires sandbox permissions.
- Create, update, and delete operations appear in audit logs with masked values.
- Daytona documents no Secret TTL, per-sandbox Secret ownership, cascade delete, or public quota.

Daytona's examples inject the placeholder through an environment mapping. The documentation says
the proxy inspects outbound requests that carry a placeholder, but it does not demonstrate a
placeholder placed directly into ACP HTTP MCP headers. That exact path is a live-spike gate.

## 3. Where exact hosts come from

The destination belongs to the consumer, not the vault entry.

| Consumer | Current route source | Required change |
|---|---|---|
| Custom model provider | `ResolvedConnection.endpoint.baseUrl` | Parse and use its exact hostname. |
| Azure OpenAI | Configured endpoint base URL | Parse and use its exact hostname. |
| HTTP MCP | `ResolvedMCPServer.url` | Use after the existing SSRF validation. |
| Standard direct provider | Often implicit in the client | Resolver emits the effective endpoint. |
| Bedrock bearer token | Region plus AWS partition and runtime endpoint | Resolver emits the effective regional endpoint. |

A runner-only provider-host registry is possible but weaker. It duplicates routing knowledge and
can diverge from custom SDK behavior, regional endpoints, sovereign partitions, or a user-selected
base URL. The resolved connection should carry the actual endpoint used by the harness.

Redirects remain a live security question. An exact original host is not sufficient if Daytona
substitutes the credential again after a cross-host redirect. Phase 0 must test this.

## 4. Feasibility by credential shape

| Credential | Daytona isolation | Evidence and constraint |
|---|---:|---|
| OpenAI, Anthropic, Mistral, Groq, Gemini API keys | Yes | The unchanged key enters an HTTP header and the provider host is known. |
| Azure OpenAI API key | Yes | Microsoft documents the unchanged key in the `api-key` header; the configured endpoint supplies the host. |
| Custom-provider API key | Usually | Requires an HTTPS endpoint and an unchanged header or body value. |
| HTTP MCP authorization | Candidate | URL supplies the host; direct ACP-header placeholder substitution needs a live proof. |
| Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK` | Candidate | AWS documents `Authorization: Bearer` for regional Bedrock Runtime HTTP requests. |
| AWS access key, secret key, and session token | No | The SDK needs plaintext locally to calculate SigV4. |
| Vertex service-account or ADC configuration | No | `GOOGLE_APPLICATION_CREDENTIALS` points to credential JSON used to mint OAuth tokens locally. |
| Vertex API key | Candidate later | Google documents API-key authentication for some Vertex Gemini paths, but Agenta's current Vertex connection is ADC-shaped. |
| JSON parsed by sandbox code | No | Code sees a placeholder, not parseable JSON. |
| Private key, signing seed, encryption key | No | Local cryptographic use requires plaintext. |
| Native database password | No | Daytona documents HTTP(S) substitution, not arbitrary database protocols. |

Provider sources:

- [AWS Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html)
- [Google Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)
- [Vertex AI quickstart authentication choices](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart)
- [Azure OpenAI REST authentication](https://learn.microsoft.com/en-us/azure/foundry/openai/reference)

The current Agenta resolver supports both Bedrock bearer tokens and SigV4 environment fields. They
must not share one classification. The bearer token can be proxy-substituted if its endpoint is
known and the harness sends it unchanged. The access-key triple cannot.

A proxy is the only general way to keep local-use signing or service-account material completely
outside the sandbox. Provider-specific bearer or API-key modes can avoid the proxy. Short-lived
credentials, workload federation, restricted IAM, and process hardening reduce exposure but do not
stop the agent from reading a token or key that its own process must use.

## 5. Current lifecycle implementation

The active warm-Daytona worktree has moved beyond the earlier design assumptions:

- `services/runner/src/engines/sandbox_agent/daytona-provider.ts` wraps the vendored provider and
  implements state-aware `pause`, `reconnect`, and `deleteSandbox` with the Daytona client.
- `services/runner/src/engines/sandbox_agent/provider.ts` sets `ephemeral: false`, a 15-minute
  auto-stop, and a 30-minute auto-delete. It no longer sets `autoArchiveInterval`.
- `services/runner/src/engines/sandbox_agent/teardown.ts` distinguishes stop from delete.
- the `sandbox-agent@0.4.2` patch fixes vendored session and process cleanup behavior. Secret
  lifecycle does not belong in that patch.

These are concurrent implementation-lane changes, not part of this design PR. Secret delivery
should extend the runner-owned provider boundary after that work lands. It should not wait for or
require an upstream sandbox-agent change.

The lifecycle ladder is running, stopped, then deleted. Reconciliation must still recognize a
manually or provider-archived sandbox as existing, but Agenta does not intentionally archive one.

The current keepalive path also tracks a credential epoch. A changed epoch makes a reusable
session incompatible. The simplest safe first version deletes the old sandbox and lease and
provisions fresh instead of updating a live Secret and waiting for propagation.

## 6. Lease and organization risks

Daytona has no sandbox-local Secret object. The closest boundary is one random organization Secret
per sandbox credential binding, retained as long as the sandbox can resume and deleted afterward.

The lease record needs sandbox ID, Secret IDs and opaque names, exact hosts, binding metadata,
state, and timestamps. It must not store plaintext or user-facing vault names. A durable record is
required for crash reconciliation; process memory alone is insufficient.

`manage:secrets` can manage every Secret in the organization. A dedicated API key prevents sharing
the runner credential with other services but does not narrow its object scope. A dedicated
Daytona organization for Agenta sandboxes is the strongest available documented boundary. A shared
organization requires explicit acceptance of the broader blast radius.

Failure compensation must cover:

1. partial Secret creation;
2. sandbox creation failure after Secret creation;
3. sandbox success followed by lease persistence failure;
4. runner crash at each boundary;
5. sandbox auto-delete without runner teardown;
6. Secret deletion failure and concurrent janitor retries.

## 7. SDK upgrade state and risk

The runner currently declares `@daytonaio/sdk` with `^0.187.0`; its lockfile resolves 0.187.0. It
also uses `sandbox-agent` 0.4.2. The active worktree has not upgraded the Daytona package.

On 2026-07-11, npm reports:

- `@daytona/sdk` current version: 0.196.0;
- `@daytonaio/sdk` current version: 0.196.0 and deprecated in favor of `@daytona/sdk`;
- the deprecation message states that the package move keeps the same API;
- Daytona Secrets first shipped in 0.192.0.

The upgrade remains medium risk. Secret APIs, native pause, and attachment are additive for the
calls Agenta uses, but nine releases change generated clients and transitive dependencies. The
package also changed Secret list behavior during this fast release sequence. Pin one exact version,
remove the old package, test for duplicate clients, and verify the actual self-hosted control plane.

The upgrade must preserve snapshot/image selection, target routing, network policy fields, signed
preview, process execution, file operations, mounts, state transitions, and deletion. Unit tests
cannot replace a live Daytona smoke.

## 8. Security limits

Daytona Secrets prevent the sandbox from reading supported plaintext, but they do not make Agenta
or Daytona unable to access it:

- Agenta's authorized vault layer decrypts the value.
- The runner handles it transiently in the create request.
- Daytona stores an encrypted copy and performs egress substitution.
- Daytona's API does not return the plaintext after creation.

If the requirement includes hiding plaintext from Agenta operators or the runner process, this
architecture is insufficient. It would require client-side encryption to a trusted execution
boundary or a provider authorization flow that never gives Agenta the credential.
