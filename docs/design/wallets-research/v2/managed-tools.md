# Wallets: managed tool actions

A managed action is a paid integration action (enrich a person, search companies) that runs
on a provider account Agenta holds, and whose cost is charged to the organization's wallet.
This page is the architecture for that capability, built end to end with two mock actions so
the shape can be reviewed before a real provider is chosen. It implements the structure agreed
in [add-managed-tool-actions](openspec/changes/add-managed-tool-actions/).

Everything here sits behind `AGENTA_WALLETS_ENABLED` (EE) and `env.mock_gateways.enabled`. With
either off, nothing is wired, nothing is listed, and no request path changes.

## The shape in one picture

```text
agent (runner, MCP client)
  |  tools/call  mock_search_companies {query, limit}
  v
MCP gateway  /gateways/mcps/builtin/managed/managed          the agent-facing transport
  resolve target -> permission (USE_MCP_ENDPOINTS) -> audit
  |  managed dispatch branch: scope + run context from the signed credential
  v
ManagedMCPAdapter                     JSON-RPC <-> executor calls, nothing else
  |
  v
ManagedToolsService                   the executor; knows no transport and no price
  1. look up the action                     unknown -> refused before anything else
  2. validate the arguments                 invalid -> refused before admission
  3. rate limit (organization, provider)    over -> rate_limited, retry-after
  4. admit the worst-case price             refused -> the upstream is never contacted
  5. invoke the provider, once              bounded by the action's timeout, never retried
  6. validate the output, count the units   the same rule whatever the transport
  7. hand one measurement to billing        bounded, contained
  |                                   \
  v                                    v   EE, wallet on
ManagedActionProviderInterface       ManagedActionBillingInterface
  one instance per Agenta-owned        WalletManagedActionBilling
  connection, one per transport          price(action)   <- rate card
  RestActionProvider  (REST, our key)    admit(action)   <- wallet: spendable - floor >= worst case
  MCPActionProvider   (remote MCP)       record(...)     -> streams:measurements (kind "tool")
  ComposioActionProvider (described)                        -> MeasurementWorker -> DebitWorker
```

## Vocabulary

- **Action**: the public contract. Key, description, input and output models, what is billable.
  Provider-independent.
- **Provider**: an Agenta-owned connection to an upstream, one instance per connection, built
  with its own credentials and settings. It speaks one transport: direct REST, Composio, or MCP.
  It implements `ManagedActionProviderInterface`.
- **Binding**: on the action, the name of the provider that serves it, the provider's own name
  for the operation, and arguments fixed by us.
- **Payer**: whose account an action spends. Every provider in the managed registry spends
  Agenta's; a customer's own connection is never a managed provider (decision 11).

## Decisions

### 1. Where managed actions live

`api/oss/src/core/managed_tools/`:

| File | Holds |
| --- | --- |
| `dtos.py` | the action and its binding, the trusted execution context, the provider response, the result, the measurement, the price |
| `interfaces.py` | `ManagedActionProviderInterface` (to an upstream), `ManagedActionBillingInterface` (to the wallet), `ManagedActionRateLimiterInterface` |
| `registry.py` | `ManagedActionRegistry`: the explicit catalog of actions and the providers that serve them |
| `service.py` | `ManagedToolsService`: the executor |
| `types.py` | domain exceptions |
| `limits.py` | the Redis rate limiter, over the existing `utils/throttling.py` |
| `providers/rest.py` | `RestActionProvider`: a direct REST API on an Agenta-owned key |
| `providers/mcp.py` | `MCPActionProvider`: a remote MCP server, through the gateway's MCP upstream adapters |
| `mock/actions.py` | the two mock actions |
| `mock/rest_app.py`, `mock/mcp_upstream.py` | the two mock upstreams, one per transport |

The agent-facing entry point is `api/oss/src/core/gateways/mcps/providers/managed/adapter.py`,
beside the other MCP providers. The EE half is `api/ee/src/core/measurements/tools.py` (the
billing implementation) plus rows in `rate_card.py`, a branch in `charges.py`, and one method on
`WalletsService`. Wiring is in `api/entrypoints/routers.py`.

Options considered:

- **A domain of its own (chosen).** An action's contract, provider and price outlive any one
  transport, and the spec asks for this split. It keeps provider code out of the gateway's MCP
  relay, which is already 1,300 lines.
- **Inside `core/tools/`.** That domain is the customer-connection tool catalog (Composio browse
  and execute on the customer's own account). Managed actions spend Agenta's account and must
  never be reachable as an unrestricted customer connection; sharing the domain invites that.
- **Inside `core/gateways/mcps/`.** Ties the action contract to the agent-facing transport. A
  later REST entry point would reach into the MCP plane.

OSS never imports EE. The executor takes its billing port by injection, and the EE
implementation is bound in the composition root.

The spec sketches a per-integration `integrations/<name>/implementation.py`. This design does not
need one yet: the providers are generic per transport and an action is described by its
binding. A per-integration mapping comes back when a real upstream's payload cannot be read by
the output model (decision 5).

### 2. The action definition

```python
class ManagedAction(BaseModel):
    # identity and model-facing description
    integration: str                 # "mock"
    name: str                        # "enrich_person"
    #   key  = "mock.enrich_person"  (stable identity: rate card, measurement, audit)
    #   tool = "mock_enrich_person"  (the MCP tool name the model sees)
    description: str
    # contract
    input_model: type[BaseModel]     # validated before admission; the advertised schema
    output_model: type[BaseModel]    # what the model receives; validated after the upstream answers
    # routing
    binding: ManagedActionBinding    # provider name, operation, fixed arguments
    # metering rule, counted from the validated output
    unit: ManagedActionUnit          # CALLS or RESULTS
    results_field: Optional[str]     # RESULTS only: the output list whose length is the count
    # policy hint and config
    read_only: bool
    timeout_seconds: float = 30

class ManagedActionBinding(BaseModel):
    provider: str                           # a registered provider name: "mock_rest"
    operation: str                          # opaque to the executor: a REST path, an upstream
                                            # MCP tool name, a Composio tool slug
    fixed_arguments: Dict[str, Any] = {}    # set by us, never shown to or overridable by the model
```

Grouped by role: identity and description are metadata, the two models are the data contract,
`binding` is routing, `unit` and `results_field` are the metering rule, `read_only` is a policy
hint, `timeout_seconds` is config. The price is **not** on the action: the price list belongs to
the wallet ("the gateway enforces, the wallet accounts", seams.md), in the EE rate card keyed by
`key`.

Pydantic models rather than JSON schema dicts: they validate and produce the schema, so the
advertised schema and the enforced one cannot drift. Unknown input fields are forbidden, so
arguments cannot smuggle identity, funding, routing or price.

The MCP tool name replaces the dot because Anthropic tool names allow only `[a-zA-Z0-9_-]`, and a
harness renders the tool as `mcp__<server>__<tool>`. The registry refuses colliding keys or tool
names.

**Versioning.** A breaking change to `input_model` or `output_model` is a new action
(`apollo.enrich_person_v2`) with its own rate row. A compatible change keeps the key. Whether
the old key is kept is decided per change; nothing promises it now. A provider that pins upstream versions (Composio toolkits) pins
them in its own configuration, never `latest`.

Permission and approval stay where they already are. The MCP relay checks `USE_MCP_ENDPOINTS`
for every call, and the runner applies the agent's MCP policy (whole-server `permission`,
per-tool `tool_permissions`, `new_tool_permission`) to each managed tool exactly as to any MCP
tool. `read_only` is advertised as the MCP `readOnlyHint` annotation. No server-side approval is
added: approval is the runner's, and a second one would ask twice. An author who wants a human
to approve spending sets `ask` on the server or the tool; the price is in the listing (decision
10), so they can see what they approve.

### 3. Fixed arguments: the model cannot raise our cost

Some upstream arguments multiply what the upstream charges us: an enrichment API's "reveal the
phone number" flag, an SEO API's field selection. The binding's `fixed_arguments` are merged
into the request after validation. They are not in the advertised schema, and the registry
refuses an action whose `input_model` declares a field the binding fixes, so the model can
neither see nor override them.

Rule for authors: an argument that changes the upstream's charge is either fixed in the binding
or priced as its own action (`apollo.enrich_person_with_phone`).

Options considered: fixed arguments on the binding (chosen), because they are part of how we
call this upstream and belong with the operation; hiding fields in the input model with
defaults, which still lets the model send them; relying on the output count alone, which bounds
what we charge the customer but not what the upstream charges us.

### 4. Where the transport choice lives

`binding.provider` names a provider instance registered on this deployment. Which transport that
provider speaks, its URL, its credentials, its pinned upstream version and its rate limit are
deployment configuration: the composition root builds each provider from `env` and registers it
by name. `binding.operation` is opaque to the executor and interpreted only by the provider.

| Change | Needs |
| --- | --- |
| rotate a key, move a URL, point at a different connected account or MCP server, tune a rate limit | configuration only |
| move an action to a different transport (Composio to direct REST) | a binding change, reviewed |
| add a transport | one provider class; no executor, billing or view change |

Options considered:

- **Binding in code, connection in configuration (chosen).** Moving an action to another
  transport changes the operation name, the payload the output model reads, and usually what the
  upstream charges us. That must pass review beside the rate card row (openspec: "an action
  moves from Composio to a verified direct API ... its public contract remains compatible or
  receives an explicit version change"). Credentials and addresses change for operational
  reasons and must not need new code.
- **Bindings in configuration too.** Would let an operator route a priced action to an upstream
  whose payload or cost was never verified.

### 5. The provider interface and the common result shape

```python
class ManagedActionProviderInterface(ABC):
    name: str                                        # what bindings and rate limits name
    rate_limit: Optional[ManagedActionRateLimit]     # per organization on this provider

    async def invoke(
        self, *, operation: str, arguments: Dict[str, Any], context: ManagedActionContext
    ) -> ManagedActionResponse: ...

class ManagedActionResponse(BaseModel):
    output: Optional[Dict[str, Any]] = None             # the upstream's payload, on success
    failure: Optional[ManagedActionUpstreamFailure] = None   # the upstream answered with a failure
    provider_reference: Optional[str] = None            # the upstream's request id
    provider_cost: Optional[ManagedActionProviderCost] = None  # what the upstream says it charged us

class ManagedActionUpstreamFailure(BaseModel):
    kind: Literal["rate_limited", "auth_failed", "rejected"]
    message: str
    retry_after_ms: Optional[int] = None
```

Exactly one of `output` and `failure` is set. Every transport reports an ending the same way:

| Ending | How the provider reports it |
| --- | --- |
| success | `output` |
| the upstream answered with a failure (429, 401/403, other 4xx and 5xx, `isError`, `successful: false`) | `failure` with its kind |
| the request provably never left (connection refused, bad configuration) | raises `ManagedActionNotSentError` |
| anything else: a timeout, a connection cut after sending, an unexpected exception | raises anything else; the executor also bounds the call by the action's timeout |

The **unit count is not reported by the provider**. The executor validates `output` against the
action's `output_model` and counts units from it with the action's rule: one call per
successful `CALLS` action, the length of `results_field` for a `RESULTS` action. So a price
depends on what the customer received, a transport cannot miscount, and moving an action to
another transport cannot change what it costs.

`provider_cost` and `provider_reference` are evidence for reconciliation and margin, never
priced. They travel into the measurement's `references`.

Output the output model cannot read is a provider contract violation: not charged, recorded as a
failure, logged, and the model sees `provider_error`. When a real upstream's payload does not
match the contract shape, its provider gains a mapping for that operation; the mocks answer in
the contract's shape, so none is built now.

The three transports:

- **Direct REST, Agenta's key** (`providers/rest.py`, built). `RestActionProvider(name,
  base_url, credential_header, credential, rate_limit, transport=None)`. `POST
  {base_url}/{operation}` with the arguments as JSON and the key in the configured header. The
  key is an Agenta secret from `env`, set at construction. `httpx` is built with `retries=0`.
  The mock is an in-process ASGI app (`mock/rest_app.py`) reached through
  `httpx.ASGITransport`, which checks the key arrives, so real HTTP handling (status codes,
  headers, JSON) is exercised without a network.
- **Remote MCP server** (`providers/mcp.py`, built). `MCPActionProvider(name, upstream, route,
  auth, rate_limit)` reuses the gateway's `MCPUpstreamInterface`: `HttpMCPAdapter` for a real
  server, which brings SSRF-guarded egress and credential-header injection, and an in-process
  upstream for the mock. `HttpMCPAdapter` is a raw relay, so the provider holds a small
  provider-local MCP client: `initialize`, `notifications/initialized`, then `tools/call`
  carrying the negotiated `MCP-Protocol-Version` and any `Mcp-Session-Id`, reading a JSON or an
  event-stream answer (data lines joined per event). The paid `tools/call` is sent only after
the server accepted `notifications/initialized`. A `tools/call` answer that cannot be read is an
unknown outcome, not a failure. `structuredContent` is the output; `isError: true` is a failure. The
  credential is `MCPDirectAuth(secret=...)`: an Agenta API key, or an OAuth grant Agenta holds.
  The mock upstream (`mock/mcp_upstream.py`) is not the shared mock MCP server: other suites pin
  that server's exact tool list, and an agent using "Mock Tools" would see a free twin of a paid
  action.
- **Composio on Agenta's account** (`providers/composio.py`, not built). Below.

#### The Composio path, concretely

`ComposioActionProvider(name, client, toolkit, toolkit_version, user_id, connected_account_id,
rate_limit)`:

- `client` is the existing Composio HTTP client (`core/tools/providers/composio/adapter.py`),
  built with Agenta's own Composio API key. Its `execute` reduces the answer to
  `data/error/successful` and wraps every `httpx` error in `AdapterError`; the provider needs
  the status code and the upstream's request id, so the first Composio action extracts a small
  evidence-preserving `execute` from it rather than widening the customer path.
- `toolkit_version` is pinned; the provider refuses `latest`.
- `user_id` is one platform entity (`agenta-managed`). Customer connections use the customer's
  project id as the Composio user id (`call_tool` in `apis/fastapi/tools/router.py` reads it
  from `connection.data["project_id"]`), so a managed call can never land on a customer's
  connected account, and a customer call never on ours.
- `connected_account_id` is Agenta's connected account for the toolkit on Agenta's Composio
  project, created once by an operator (Composio-managed auth, or our own key for the toolkit)
  and set from `env`. No customer key is involved.
- `invoke`: `successful` maps to `output=data`, otherwise `failure`; 429 is `rate_limited`,
  401/403 `auth_failed`; a connection error is `ManagedActionNotSentError`; a timeout
  propagates as an unknown outcome.

Files it touches: `managed_tools/providers/composio.py` (new), `utils/env.py` (the connected
account id per toolkit), `entrypoints/routers.py` (register it), the action files that bind to
it, and `rate_card.py`. No executor, adapter, billing or view change.

### 6. The executor

`ManagedToolsService.execute(scope, context, tool, arguments) -> ManagedActionResult`:

1. **Look up** the action by tool name. Unknown: `ManagedActionNotFoundError`, before anything
   else, so an operation outside the catalog never reaches admission, a credential or an
   upstream (spec: "Unsupported operation").
2. **Validate** the arguments against `input_model`. Invalid: a failed result
   (`invalid_arguments`).
3. **Rate limit** per organization on the action's provider (decision 9). Over: `rate_limited`
   with `retry_after_ms`.
4. **Admit** through the billing port: may this
   organization pay this action's worst-case price (decision 8)? Bounded to two seconds and
   **fail closed**: a wallet that cannot answer refuses. Refused: `wallet_balance_exhausted`;
   the upstream is never contacted.
5. **Invoke** the provider once, with `fixed_arguments` merged in, bounded by the action's
   `timeout_seconds`. The execution id, `tool_<uuid7>`, is minted just before and passed to the
   provider in the context, so an upstream that accepts a client reference can carry it.
6. **Validate** the output and **count** the units (decision 5).
7. **Hand off** one measurement to billing, bounded to 0.5 seconds and contained, as the gateway
   does for model calls. A hand-off that fails or stalls is a logged, lost measurement and never
   changes the result.

Each execution publishes exactly one measurement. The publication runs as a task shielded from
the caller's cancellation, so a caller that goes away during the hand-off does not cut it short.
A caller that goes away while the provider is still running (step 5) gets an `unknown`
measurement through the same shielded hand-off, and the cancellation then propagates. No path
builds a second measurement for an execution that already has one.

Why admission sits in the executor, not the MCP relay: the spec requires "one financial boundary
per economic execution" whatever the entry point. Only `tools/call` of a known action spends;
`initialize` and `tools/list` do not, and the relay cannot tell them apart without parsing the
body, which is the adapter's job.

### 7. The billing port

```python
class ManagedActionBillingInterface(ABC):
    async def prices(self) -> Dict[str, ManagedActionPrice]: ...        # for the listing
    async def admit(self, *, scope: AuthScope, action: ManagedAction) -> bool: ...
    async def record(self, *, scope: AuthScope, measurement: ManagedActionMeasurement) -> None: ...
```

One port, three questions the wallet answers: what does it cost, may this organization pay, and
here is what happened. seams.md: "an authorization call before dispatch ... and a usage call
after the response ... The gateway holds the interface; the wallet holds both implementations."
The EE `WalletManagedActionBilling` reads the rate card, asks `WalletsService`, and publishes one
`MeasurementCommandV1` through the existing `MeasurementPublisher`.

Options considered:

- **One billing port for managed actions (chosen).** The executor needs the price for the
  listing and for worst-case admission, and neither may live in OSS. The same port publishing
  the measurement keeps the three answers from one owner.
- **Reuse the gateway's `SpendAdmissionInterface` and `UsageSinkInterface`.** Admission there
  takes a `GatewayTarget` and answers against the floor only; the usage sink maps an LLM-shaped
  outcome. Worst-case admission would have to reverse-engineer the action from the target, and
  the sink would branch on the plane. The fail-closed timeout, the one thing worth sharing, is
  four lines.

### 8. Admission against the worst-case price

Admission asks whether the organization's spendable balance minus its floor covers this call's
**maximum possible charge**: the per-call price, or the per-unit price times
`max_units_per_call`. It is a threshold, not a hold: nothing is reserved, and the actual units
are settled after the call.

`WalletsService` gains `covers(organization_id, amount_musd)`, the same spendable read as
`check` (with its lazy provisioning), answering `spendable - amount >= floor`. `WalletCheckPort`
does not change: its docstring reserves an amount argument for a future reserving check, and
this is a separate read on the service, used only here.

Every `RESULTS` rate therefore needs `max_units_per_call`; the rate card test refuses one without
it. The action's `input_model` also bounds its count argument (`le=`), which bounds what the
upstream charges us; the cap bounds what we charge the customer.

Options considered:

- **Worst-case threshold (chosen).** A cheap organization at 1 micro-dollar above its floor can
  no longer start a call that costs it ten cents. No ledger change.
- **Floor only, as for models.** A model call's cost is unknown before dispatch; an action's
  maximum is known, so ignoring it throws information away.
- **A reservation (authorize a maximum, settle the actual).** The right end state, and the same
  shape. It needs holds in the ledger (open-designs items 2 and 17). Out of scope.

### 9. A rate limit per organization on each shared provider

A provider is one Agenta key shared by every organization, and upstreams limit per key. One
looping agent in one organization could exhaust it for all, faster than the wallet floor reacts.
Each provider carries an optional `rate_limit` (burst and refill per minute) from configuration,
and the executor takes one token from a bucket keyed `(provider, organization)` before
admission. It uses the existing Redis token bucket in `utils/throttling.py`.

A Redis failure **admits** (fail open): the limit protects capacity, not money, and admission,
which protects money, still fails closed. Over the limit: `rate_limited` with the bucket's
`retry_after_ms`, not charged.

A daily spend cap per organization is not built: worst-case admission and the balance already
bound money. An alarm on the platform's own upstream budget, and upstream sub-keys with their
own limits where an upstream offers them, are launch items for a real provider.

### 10. How an agent sees and calls an action

Managed actions surface as one **builtin MCP server**, `builtin/managed`, listed by the MCP
gateway beside `Agenta Tools` and `Mock Tools`. An agent adds it like any gateway MCP server:

```json
{"name": "managed", "connection": {"type": "gateway", "namespace": "builtin", "provider": "managed"}}
```

`tools/list` returns every registered action with its input and output schema, its
`readOnlyHint`, and its **price**: a sentence appended to the description ("Costs $0.002 per
result, at most 10 results charged per call.") and `_meta["agenta/price"]` with the unit, the
micro-dollar price and the cap. The price comes from the billing port, so it cannot drift from
the rate card. `tools/call` runs one action through the executor.

The relay gets an explicit managed branch, as the Agenta bridge has: after the permission check,
`provider == "managed"` hands the body to `ManagedMCPAdapter` with the caller's `AuthScope` and a
`ManagedActionContext` built from `gateway_run_id()` and `gateway_run_labels()`. The adapter is
injected in the composition root and holds no request state. The endpoint is listed, and
resolved, only when the adapter is wired; otherwise `builtin/managed` is a 404 as today.

Options considered:

- **The builtin MCP namespace (chosen).** It is already the path an agent uses for
  platform-provided tools. It brings, with no new code: listing in the MCP endpoint picker, the
  run-bound gateway credential (organization, project, user, run, session and agent come from
  the signed credential, never from arguments), the permission check, the audit event, and the
  runner's per-tool MCP permission and approval policy. The SDK changes by one line (below); the
  runner does not change.
- **A new `type: "managed"` tool config dispatched through `POST /tools/call`.** A new SDK config
  arm, a new resolver, a catalog fetch at resolve time, and a new `call_ref` family in a
  2,100-line router. Every piece duplicates what the MCP path has.
- **A dedicated REST route (`POST /managed-tools/{key}/execute`).** No consumer today. The
  executor knows no transport, so a later REST route is a thin router over
  `ManagedToolsService.execute`, with the same admission. Deferred until a consumer exists.

The one-line SDK change: the MCP resolver hard-coded the endpoint name of every non-Agenta
builtin provider to `mock` (`sdks/python/agenta/sdk/agents/mcp/resolver.py`). It now uses the
provider name, which is `mock` for the mock provider, so no existing route changes.

### 11. The payer rule

The same rule as models: only what runs on Agenta's account is charged. A `builtin` model call
spends Agenta's key and is charged; a `standard` or `custom` one spends the customer's and is
not.

| Route | Payer | Admitted | Measured, charged |
| --- | --- | --- | --- |
| a managed action (every managed provider is Agenta-owned) | Agenta | yes | yes |
| the same upstream through the customer's own connection: their Composio connection as a gateway tool, `standard/composio`, their own API key, their own MCP server with their OAuth | customer | no | never enters the executor |

Ownership is established by the managed registry, not by the `builtin` namespace: customer
Composio connections are also served under `builtin`, but they are resolved from the project's
connection rows and never reach the executor. The EE side keeps its own guard: only
`endpoint_kind: builtin` is chargeable, and only the managed billing implementation produces
`tool` measurements.

Options considered:

- **Managed providers are always Agenta's (chosen).** The customer's own connection already has
  paths that never charge. One owner per registry removes a payer field, a branch in the
  executor, and a mode nothing uses.
- **A payer on each provider, so a customer-owned provider could serve the same contract.**
  Considered in the first draft and cut after review: no consumer, and it made "who pays"
  depend on a field instead of on which registry a call reached.

**Never fall back.** The executor calls exactly the provider the binding names. A provider that
fails is never substituted, and a customer's own connection that is missing or broken fails on
its own path; nothing reroutes it to an Agenta provider, which would spend our account under the
customer's name. A unit test pins that a failing provider is not substituted.

### 12. Billing

A platform-paid execution becomes one `MeasurementCommandV1` on `streams:measurements`, priced by
the existing measurement worker and settled by the existing debit worker. No new ledger, stream,
worker, table or migration.

| Field | Value |
| --- | --- |
| `measurement_id`, `request_id` | the execution id, `tool_<uuid7>` |
| `gateway_kind` | `tool` (new enum value) |
| `resource_key` | `tool:<action key>`, e.g. `tool:mock.search_companies` |
| `resource_locator` | `action`, `provider`, `unit` (the component key that carries the count) |
| `endpoint_kind` | `builtin` (platform-paid) |
| components | `action_calls` or `action_results`: the billable units |
| `references` | `execution: {id, outcome, provider_reference, provider_cost}`, `workflow.gateway_run_id`, `session.id` |
| `organization_id`, `project_id`, `user_id`, `agent_id` | from the credential |

Price shapes, in the rate card:

```python
class ActionRates(BaseModel):
    unit: str                                  # the component key priced
    musd_per_unit: int
    max_units_per_call: Optional[int] = None   # the cap; required for a per-result rate

ACTION_RATES = {
    "mock.enrich_person":    ActionRates(unit=ACTION_CALLS,   musd_per_unit=20_000),
    "mock.search_companies": ActionRates(unit=ACTION_RESULTS, musd_per_unit=2_000, max_units_per_call=10),
}
```

`charge = min(units, max_units_per_call) x musd_per_unit`; the worst case is `musd_per_unit x
(max_units_per_call or 1)`. A fixed price per successful call is one billable call per success;
a price per result is the number of results; a cap bounds one call. Both shapes are one formula,
so a third shape (per page, per credit) is a new unit key and a row, not new code. The table is
part of the rate card's derived version, so every debit names the prices it was charged at. The
measurement keeps the true count; the cap is applied only in pricing.

A test asserts that every registered action has a rate whose unit is the action's unit.

**Price changes between admission and pricing.** Admission reads the rate card in the API; the
measurement worker prices from its own copy when it first processes the measurement. A rate
changed by a deploy in between is charged at the new rate, which may exceed the worst case
admission checked. This is accepted, as it is for models (Wave 2 launch blocker 3: deploy the
worker with a new card before the API that relies on it). Admission is a threshold, not a
quote. The alternatives, a price snapshot carried from admission to pricing or immutable prices
per action key, add a contract or a key churn that one deploy ordering rule avoids.

Options considered for `gateway_kind`:

- **A new `tool` kind (chosen).** The measurement describes the economic action, which has a
  price per action; the transport it arrived on is incidental.
- **Reuse `mcp`.** The `mcp` branch prices per request per MCP server. Managed actions would need
  a second branch keyed on something else, and a REST entry would be mislabelled MCP.

Adding an enum value is not an envelope shape change: `sbx` was added the same way.

A measurement whose action has no rate, or whose rate prices a unit the measurement does not
carry, raises `UnpricedMeasurementError` (retried, then dead-lettered), never a free charge.

The Usage (debug) tab shows these under **Tools** (the view maps both `mcp` and `tool`), grouped
by session like model calls. Each charge carries one generic action projection, `action`,
`unit` and `quantity`, read from the locator and its matching component, and each expanded row
shows it ("mock.search_companies, 3 results"). A new unit needs no new field.

### 13. Failure semantics and the error taxonomy

| Ending | Charged | Measurement | What the model sees |
| --- | --- | --- | --- |
| success | the counted units | `succeeded` | the output |
| upstream 429 | no | `failed`, 0 units | `provider_rate_limited`, retryable, `retry_after_ms` |
| upstream 401/403 (our key is broken) | no | `failed`, 0 units | `provider_auth_failed`, not retryable; logged as an error for the operator |
| any other upstream failure | no | `failed`, 0 units | `provider_error` with its detail |
| output the contract cannot read | no | `failed`, 0 units | `provider_error` |
| never sent | no | none | `provider_unavailable`, retryable |
| timeout, cancellation, any other exception | no | `unknown`, 0 units | `outcome_unknown`, not retryable |
| our own rate limit | no | none | `rate_limited`, retryable, `retry_after_ms` |
| refused at admission | no | none | `wallet_balance_exhausted` |
| unknown action, invalid arguments | no | none | the refusal |

Each failure is an MCP result with `isError: true` whose `structuredContent` is `{error: ...}`
in the platform's agent-actionable envelope, `{code, message, retryable, next_step, details}`
(`api/AGENTS.md`); `retry_after_ms` travels in `details`.

**Failure messages are safe to show the model.** A provider never puts a credential, a header or
a raw exception string in a failure. `RestActionProvider` scans the whole answer for the key it
sent with the gateway's existing credential-echo scanner, on the raw bytes and on what they
decode to (a JSON escape hides a key from a byte scan), and withholds an answer that carries it.
`MCPActionProvider` gets the raw check from `HttpMCPAdapter` and adds the decoded one. The shared
REST client keeps no cookies, so no upstream state rides from one organization to the next.

**Not sent means provably not sent.** Only a failure to connect is `provider_unavailable`. A
connection lost after the request was written is an unknown outcome.

Failures are not charged. That is the documented rule for these actions (spec: "Billable failure
... follows the configured documented rule and records the failure"): the failure is recorded
with its execution id, at no charge. An upstream that charges us for a miss is a cost for
reconciliation, not a reason to charge the customer for an empty answer. If product decides
otherwise for a real action, that action gains a rule then.

Why an unknown outcome is not charged: charging would bill the customer for work we cannot show
happened. The platform carries that risk until reconciliation against the upstream's records
(openspec task 1.6, required before a real provider launches). The row is recorded with
`outcome: unknown` so reconciliation can find it. A stored measurement is immutable, so settling
it later is a separate, deterministically identified adjustment that names the original
execution, never a replay of this measurement with new units. The model is told the outcome is
unknown and not to repeat the call.

**No layer retries a paid dispatch.** The executor never retries; `RestActionProvider` builds
`httpx` with `retries=0`; `MCPActionProvider` sends one `tools/call`; the gateway relay does not
retry. A test per transport proves one call reaches the upstream exactly once, even when it
times out.

### 14. Idempotency

- **Charge once per execution.** The execution id is the measurement id. A redelivered stream
  message, or two workers racing on one, store one measurement and post one debit (existing
  guarantee, Wave 2).
- **A repeated request is a new execution.** MCP `tools/call` carries no idempotency key, and no
  layer retries a tool call on its own (decision 13). A model that calls twice has bought twice,
  as a model that sends a prompt twice has. The spec's "duplicate execution request returns the
  original outcome" needs a caller-supplied key and a stored outcome, which is a table. It is
  recorded as a divergence ([spec-divergences.md](spec-divergences.md) row 24) and required
  before any consumer that retries on its own (a REST client with an `Idempotency-Key` header).
  A JSON-RPC request id is not such a key: it is unique per client session, not per purchase.

### 15. Trusted context and cross-organization isolation

The execution context is built by the managed branch of the MCP relay from the authenticated
scope and the signed gateway credential: organization, project, user, run id, session id, agent
id, and the execution id the executor mints. None of it is read from the tool arguments, and
`input_model` forbids unknown fields. Provider credentials are set on each provider at
construction from `env`; the executor never sees them, no result carries them, and the sandbox
only ever holds its gateway credential. The executor stores nothing, so there is no cross-tenant
state: each measurement carries the caller's organization from its scope, and the rate-limit
bucket is keyed by it. A provider is shared by every organization, which is the point of a
platform account; a provider that caches anything per caller must key it by the context's
project.

## How to add a real provider

Apollo, three ways. The executor, the MCP adapter, the billing port, the measurement and debit
workers, the usage view, the SDK and the runner do not change in any of them.

- **Apollo's REST API on Agenta's key.** `utils/env.py`: the key. `routers.py`: register
  `RestActionProvider(name="apollo_rest", base_url=..., credential_header="x-api-key",
  credential=env..., rate_limit=...)`. A new `managed_tools/actions/apollo.py`: the actions,
  bound to `apollo_rest` with their paths, and `fixed_arguments` for every cost-raising flag.
  `rate_card.py`: one row per action, with source and date.
- **Apollo through Agenta's Composio account.** `managed_tools/providers/composio.py` (once, for
  every Composio toolkit), `env.py` for the connected account id, `routers.py` to register
  `apollo_composio`, and the same action file bound to it with Composio tool slugs.
- **An Apollo MCP server.** `routers.py`: register `MCPActionProvider(name="apollo_mcp",
  upstream=HttpMCPAdapter(), route=MCPResolvedRoute(url=...), auth=MCPDirectAuth(secret=...))`;
  bind the actions to it with the upstream tool names.

Tests: a provider unit test against recorded responses; the rate card test covers the new rows.

## Not in this slice

- A real provider, real prices, provider terms and reconciliation (openspec 1.1, 1.6), including
  the adjustment that settles an `unknown` execution.
- The Composio provider (described above), a customer-owned provider for the same contract, and
  OAuth grants Agenta holds for a remote MCP server.
- A REST entry point and request-level idempotency keys (decisions 10 and 14).
- A reservation. Admission is a worst-case threshold, one read, so concurrent calls can still
  take an organization below its floor (open-designs items 2 and 17).
- A daily spend cap per organization, and an alarm on the platform's upstream budget.
- A lost first hop: a measurement publish that fails or times out is a lost charge, logged (Wave
  2 launch blocker 6 applies unchanged).
- Progressive discovery (search, describe, run) for a large catalog. One listed tool per action
  is fine at this size; past a few dozen actions a second adapter over the same executor fits.
- Managed actions in OSS or self-hosted deployments: they spend Agenta's account, so they exist
  only where the wallet does.
