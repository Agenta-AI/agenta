# WP12 — SDK connection resolution

**Owns:** `sdks/python/agenta/sdk/agents/connections/`, plus `platform/resolve.py::resolve_connection`.
**Depends on:** Checkpoint A, and wave 2's seed (the gateway-credentials field, W1).
**Blocks:** WP13, WP14, WP15.

Make the resolver return a gateway route. Everything downstream — the runner, agent v0, the
MCP server configs — reads what this package produces, which is why it gates three packages
and why nothing here may be guessed at.

---

## What changes, in one sentence

`resolve_connection` today answers "which provider, which key"; it must answer "the gateway,
and our credentials for it" — without losing any capability it has (D4).

## The shape

`ResolvedConnection` (`connections/models.py`) keeps every field. What changes is what fills
them:

| field | before | after |
| --- | --- | --- |
| `provider` | the upstream's family | unchanged — the gateway routes on it |
| `deployment` | `direct` / `custom` / `bedrock` / ... | unchanged |
| `endpoint.base_url` | the provider's URL | **the gateway's route** for this target |
| `credentials` | the provider's secret | **empty** — the gateway holds it |
| `credential_mode` | `env` | `none`, since we inject no provider secret |
| the W1 field | — | our credentials and the header they ride |
| `environment` | regions, project ids | unchanged; still non-secret |

**The gateway route is `{gateway_base}/gateways/llms/{namespace}/{name}`**, with the
namespace and name from D30's grammar: `standard/{provider_key}` for a generated endpoint,
`custom/{slug}` for a row. The protocol path the caller appends (`/v1/chat/completions`) is
the harness's own and is not part of the base URL — the same split the endpoint document
already makes (entities.md §2.4).

**`credential_mode` becomes `none`, not `env`.** Its meaning is "where does the *provider's*
credential come from", and the answer is now "nowhere, the gateway has it". Our own
credentials are not a provider credential and do not travel in `credentials` — that is W1.

## Contracts this package must honour

- **No provider secret in the output.** The single assertion that makes this package worth
  doing: for every provider and every deployment, a resolved connection carries no upstream
  key. Assert it structurally — a dump of the model contains nothing matching a resolved
  secret — rather than field by field.
- **Every capability survives** (D4). The resolver still answers for every provider,
  deployment and modality it answers for today. A provider it cannot route through the
  gateway must fail loudly, not silently degrade to a direct connection.
- **`plaintext_environment()` stays complete.** It returns the environment; the W1 field
  materializes separately and both are called at the boundary. A consumer that calls only
  one must not silently lose the other — the seed's validator is what enforces this, and
  this package must not work around it.
- **The https requirement holds except on loopback** (W2, settled in the seed).
- **Masking survives.** `ResolvedCredential.value` is masked from `repr`, `str` and
  `model_dump`; the W1 field carries a secret too and inherits the same treatment.

## Which upstreams are reachable

D34 forbids body conversion, so a target is routable only if a front door speaks its
protocol. WP23 ships all three doors, so at Checkpoint B the answer is: everything with a
door. **Until WP23 merges, this package can only be tested against Chat Completions
targets** — which is the mock, the OpenAI-shaped providers and OpenAI-compatible custom
endpoints. Do not add a fallback for the rest; a provider with no door is an error.

## Tests

- **Unit, no network.** A resolved connection for each (provider, deployment) pair the
  resolver supports: base URL is the gateway's, `credentials` is empty, `credential_mode` is
  `none`, and the W1 field carries our credentials.
- **Unit, structural.** `model_dump_json()` of a resolved connection contains no upstream
  secret, for every pair.
- **Unit.** A target with no front door raises, naming the target and the protocol.
- **Unit.** Loopback base URLs pass the validator; a non-loopback http base URL still fails.
- The existing connection tests keep passing unchanged, or the change is deliberate and
  named in the task list.

## Out of scope

- The wire and the runner (WP13), the MCP server configs (WP15), agent v0 (WP14).
- The gateway's own behaviour. This package produces a route and credentials; what the
  gateway does with them is wave 1's, already built.
- Any decision about which provider is reachable — that is OD16, verified in WP24.
