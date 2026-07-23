# Design

## Decision summary

Use one consumer-owned resolved credential contract for local and Daytona runs. The contract keeps
the credential value, its protocol binding, and its destination together. The sandbox provider
then materializes that contract:

- local passes the plaintext to the local harness process or HTTP MCP header;
- Daytona creates a per-sandbox organization Secret and gives the sandbox only a placeholder;
- unsupported local-use credentials remain an explicit non-isolated mode or move behind a
  gateway. They never silently downgrade from isolated delivery to plaintext.

Agenta remains the source of truth. Daytona stores an encrypted temporary copy only while its
sandbox can run or resume. Do not mirror the Agenta vault into Daytona and do not put Agenta
control-plane credentials in Daytona Secrets.

## Security boundary

The protected subject is the agent and any code it runs inside a Daytona sandbox. It can inspect
its environment, files, process table, and network responses, but it receives only a Daytona
placeholder for isolated credentials. Daytona and the Agenta resolver still handle plaintext.
Daytona documents that Secret values are encrypted at rest, write-only after creation, and absent
from Secret reads and audit-log payloads.

This design does not give local sandboxes the same confidentiality property. The shared contract
works on local, but local materialization is plaintext until an Agenta gateway or equivalent local
egress proxy exists.

## Credential classification

| Class | Examples | Daytona delivery |
|---|---|---|
| Non-secret configuration | region, project, base URL, feature flags | Plain `envVars` |
| Opaque HTTP credential | provider API key, bearer token, HTTP MCP header | Daytona Secret placeholder |
| Local-use confidential material | AWS SigV4 keys, service-account JSON, private keys | Explicit non-isolated mode or gateway |
| Agenta control-plane credential | callback auth, Agenta API key, OTLP auth, Daytona API key | Runner-side only |

An opaque HTTP credential is a value that the client copies unchanged into an HTTP request. Code
inside the sandbox must not parse it, sign with it, derive another value from it, or use it over a
non-HTTP protocol.

The concrete cloud cases are:

- Azure OpenAI API keys qualify because the client sends the unchanged key in an HTTP header and
  the configured endpoint supplies the exact host.
- `AWS_BEARER_TOKEN_BEDROCK` qualifies in principle. AWS documents it as an unchanged bearer token
  for Bedrock Runtime requests. The exact regional runtime host must be known.
- AWS access-key, secret-key, and session-token credentials do not qualify because the SDK uses
  them locally to calculate SigV4 signatures.
- Vertex service-account or Application Default Credentials do not qualify because the client
  reads credential configuration and mints OAuth tokens locally. A Vertex API-key mode may qualify
  separately if Agenta supports that connection shape and the live spike verifies its request
  path.

An unclassified credential fails before sandbox creation. An operator may explicitly allow a
reviewed non-isolated credential mode during migration, but the run and UI must not describe that
mode as protected by Daytona Secrets.

## Consumer-owned internal contract

There is no backward-compatibility requirement for the pre-release agent contract. Replace the
ambiguous top-level `secrets: Record<string, string>` field rather than preserving it alongside a
new shape.

Each consumer owns its connection, routing, and credentials. A conceptual resolved model shape is:

```json
{
  "modelConnection": {
    "provider": "openai",
    "deployment": "direct",
    "endpoint": {
      "baseUrl": "https://api.openai.com/v1"
    },
    "credentials": [
      {
        "binding": { "kind": "environment", "name": "OPENAI_API_KEY" },
        "value": "<plaintext on the trusted internal wire>",
        "usage": "opaque_http"
      }
    ]
  }
}
```

An HTTP MCP server uses the same roles without duplicating its destination:

```json
{
  "mcpServers": [
    {
      "name": "support",
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "credentials": [
        {
          "binding": { "kind": "header", "name": "Authorization" },
          "value": "<plaintext on the trusted internal wire>",
          "usage": "opaque_http"
        }
      ]
    }
  ]
}
```

Field roles:

| Field | Role | Owner and lifecycle |
|---|---|---|
| consumer `endpoint` or `url` | routing | resolved connection or MCP declaration, per run configuration |
| `credentials[].binding` | protocol binding | consumer adapter, stable for that connection |
| `credentials[].value` | credential | Agenta vault, resolved per run and never logged or persisted by the runner |
| `credentials[].usage` | credential-use contract | resolver, stable for that credential kind |

Destination hosts are derived from the resolved consumer route, not transported in a sibling
secret-host map:

- model credentials use the effective `modelConnection.endpoint.baseUrl` after provider and
  deployment resolution;
- HTTP MCP credentials use `mcpServers[].url` after URL and SSRF validation;
- a consumer that has no effective HTTPS endpoint cannot request isolated delivery.

The resolver should emit the effective endpoint for standard providers too. A runner-only static
host registry would duplicate routing knowledge and can drift from the client that sends the
request. Exact hostnames are the only supported first-version policy. Wildcards remain rejected.

## Provider materialization

The runner validates and classifies the resolved contract once, then delegates materialization.

### Local

Local materialization puts model credential values in the harness subprocess environment and HTTP
MCP credential values in ACP header entries. This matches current behavior. It is functionally
compatible with the contract but does not claim secret isolation.

### Daytona

Daytona materialization:

1. Parses each consumer endpoint and derives one exact, lowercase hostname.
2. Creates one organization Secret per isolated credential binding with that non-empty host list.
3. For environment bindings, passes `{environmentName: daytonaSecretName}` in the sandbox create
   `secrets` map instead of copying the value into `envVars`.
4. For HTTP MCP header bindings, passes the Daytona placeholder as the header value in the ACP
   session configuration. Phase 0 must prove that Daytona substitutes a placeholder that reaches
   the proxy this way, even when the placeholder did not originate from an environment read.
5. Rejects any empty host, non-HTTPS route, wildcard, IP literal, localhost, metadata address, or
   credential whose use is not `opaque_http`.

This is a runner change. It does not require an upstream sandbox-agent implementation. The
existing runner-side `daytonaWithLifecycle` wrapper already adds native pause, reconnect, and
delete operations around the vendored provider. Secret provisioning and cleanup should extend
that wrapper or a sibling runner-owned adapter. The existing package patch remains limited to
vendored sandbox-agent cleanup behavior.

## Daytona lease model

A `DaytonaSecretLease` is runner-owned lifecycle state:

```text
lease id               random 128-bit identifier
sandbox id             one Daytona sandbox
bindings[]              consumer binding, Daytona Secret id/name, exact hosts
created at              reconciliation age
state                   provisioning | attached | stopped | deleting
```

It never stores plaintext. Secret names use only an Agenta prefix, the random lease ID, and an
opaque binding suffix. They do not contain project IDs, provider names, user names, vault slugs, or
environment names.

### Provisioning

1. Resolve only credentials requested by selected model and MCP consumers.
2. Validate consumer routes, classify values, and reject invalid combinations.
3. Generate a lease ID and create each Daytona Secret with an exact non-empty host list.
4. Create the sandbox with non-secret configuration in `envVars` and isolated model credentials
   in `secrets`.
5. Give HTTP MCP consumers only placeholders in their header bindings.
6. Start the daemon only after the Secret set is complete.
7. Persist sandbox and lease metadata without plaintext.

Missing names, empty values, vault-resolution failures, partial Secret creation, and empty host
derivation all abort before sandbox creation. Partial Secret creation triggers compensation.

### Credential changes

The first version does not rotate a live lease in place. The existing session compatibility path
already treats a credential-epoch change as a mismatch. Delete the old sandbox and lease, then
create a new pair. This avoids Daytona's documented propagation window and avoids assuming that a
long-lived daemon has refreshed bindings.

If a later optimization updates a Secret in place, the update must reassert the previously
validated exact host set and verify the returned metadata. Daytona documents PATCH semantics in
which omitted fields remain unchanged, but reassertion makes Agenta converge a Secret that an
administrator may have widened outside the runner.

### Stop, resume, and delete

- Stop: retain the lease because the sandbox may resume.
- Resume: reconcile the stored sandbox ID, lease bindings, and credential epoch before starting.
- Credential mismatch: delete the old sandbox and its lease, then provision fresh.
- Confirmed sandbox delete: delete every Secret in the lease, then mark cleanup complete.
- Secret cleanup failure: queue a durable retry and report cleanup as pending.

Archive is not part of the Agenta lifecycle. The current warm-Daytona create specification omits
`autoArchiveInterval`; the lifecycle ladder is running, stopped, then deleted. A Daytona sandbox
may still appear archived through provider defaults or manual administration, so reconciliation
must treat an existing archived sandbox as live until it is deleted.

### Reconciliation

Run a periodic janitor with a dedicated lock:

1. List Agenta-owned Secret names with the current SDK's full list semantics.
2. List Agenta-owned sandboxes in every provider state.
3. Keep Secrets referenced by a live sandbox or in-flight provisioning record.
4. Delete Secrets whose sandbox is absent and whose grace period has elapsed.
5. Emit counts and opaque lease IDs only.

Age alone never proves that a Secret is orphaned. The durable lease record and sandbox existence
are the authority.

## Control-plane isolation

Secret management needs Daytona `manage:secrets`, which can manage every Secret in the
organization. A dedicated API key limits credential reuse but does not narrow that permission to
Agenta-created Secrets. The recommended production boundary is a dedicated Daytona organization
for Agenta-managed sandboxes plus a dedicated runner credential. If deployment cannot provide
that boundary, enabling this feature requires explicit acceptance of organization-wide Secret
management blast radius.

Keep these values out of Daytona Secrets and the sandbox:

- `DAYTONA_API_KEY`;
- Agenta request, callback, and session authorization;
- OTLP authorization;
- internal tool-relay credentials;
- durable-store master credentials.

## Unsupported credential options

For credentials that code must use locally, the choices are:

1. Keep the current plaintext delivery as an explicit non-isolated mode. This preserves provider
   support but the agent can read the credential. Short-lived, scoped credentials and process
   isolation reduce impact but do not provide the target property.
2. Use a provider-specific opaque token when available, such as a Bedrock bearer token or a
   supported Vertex API key. This may qualify for Daytona substitution after a live proof.
3. Use a token broker or workload federation to mint short-lived credentials. The sandbox can
   still read the resulting token, so this limits lifetime rather than preventing disclosure.
4. Move the provider call behind an Agenta gateway. This is the general solution that keeps
   signing keys and service-account material outside the sandbox.

The first implementation may improve supported credentials without disabling existing cloud
connections. It must expose and test the difference between isolated and non-isolated delivery,
and it must never fall back silently after isolated delivery fails.

## Rejected alternatives

### Permanent organization mirror

Rejected. It creates a second durable source of truth, broad cross-sandbox reuse, and difficult
tenant deletion semantics.

### One Secret per project or provider

Rejected for the first version. Per-sandbox copies give each sandbox a clear revocation and cleanup
boundary.

### Delete immediately after attachment

Rejected. Daytona's proxy needs the organization Secret while requests are in flight.

### Send every custom secret to the agent

Rejected. A vault is not an environment template. Every credential must belong to a selected
consumer with a known route.
