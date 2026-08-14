# WP9 tasks — MCP registry and tool allowlist

Ordered so each item is one reviewable commit. Depends on the seed commit
and on merge M1 (WP1's `dbs/postgres/gateways/mcps/` DAO implementation and
migration, WP2's `SecretsResolverInterface` implementation, WP3's
`GatewayPolicyService`) having landed.

## registry.py

- [x] `core/gateways/mcps/registry.py`: add `MCPUpstreamRegistry.__init__(self,
      *, adapters: Dict[str, MCPUpstreamInterface])`, `get(self, key: str) ->
      MCPUpstreamInterface` (raises on a miss), `keys(self) -> list[str]` —
      shape copied from `ConnectionsGatewayRegistry`
      (`api/oss/src/core/gateway/connections/registry.py`).
- [x] Pick the raise for a missing key: an already-declared
      `core/gateways/mcps/types.py` exception (e.g. `MCPUpstreamError` with
      a message naming the key), not a new public exception name and not a
      cross-domain import — see "Missing from the design" in `specs-wp9.md`.
      Done: `MCPUpstreamError(target=key, detail=...)`. Note:
      `core/gateways/mcps/interfaces.py` (frozen) declares a same-named
      `MCPUpstreamRegistry` stub class raising `NotImplementedError` on every
      method — left untouched per the "own your paths" rule; the real class
      built here lives only in `registry.py` and is what the composition
      root and all callers import. Nothing in the codebase imported the
      stub, so this is dead code in a frozen file, flagged rather than
      fixed.
- [x] Unit test: `get()` on a registered key returns that adapter; `get()`
      on a missing key raises; `keys()` returns exactly the registered set.
- [x] `ruff format` && `ruff check --fix`; fix all errors.
- [x] Commit: "gateways(mcp): MCPUpstreamRegistry".

## service.py — management CRUD

- [x] `core/gateways/mcps/service.py`: `MCPGatewayService.__init__(self, *,
      mcp_endpoints_dao, policy, resolver, upstream_registry,
      connections_service)`. `connections_service: ConnectionsService` is
      required for real (see the three-source-merge section below);
      entities.md §8's abbreviated constructor pseudocode omits it, which is a
      gap in the design, not an instruction to mock the integration. Flagged
      for the M2 merge review.
- [x] Implement `create_endpoint`, `fetch_endpoint`, `edit_endpoint`,
      `delete_endpoint`, `query_endpoints` as thin delegations to
      `MCPEndpointsDAOInterface`.
- [x] Unit test each, with a mock DAO (in-memory dict), asserting the right
      DAO verb is called with the right arguments and the return value is
      passed through unchanged.
- [x] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [x] Commit: "gateways(mcp): MCPGatewayService CRUD delegation".

## service.py — the three-source merge

- [x] Implement `list_endpoints(*, project_id) -> List[MCPEndpoint]`:
      `custom` branch maps `query_endpoints()` rows 1:1.
- [x] `agenta` branch: a private, service-internal enumeration (not a
      public symbol `entities.md` does not name) of the code-defined
      builtin/agenta entries — in wave 1, the mocks WP5 registers. Implemented as
      `_agenta_endpoints()`: one entry, slug "tools" (matching D30's own
      route-grammar example `builtin/agenta/tools`), with `provider_key="agenta"`
      and `data.route.base_url=env.mock_gateways.mcp_url`.
- [x] `builtin` branch: call `ConnectionsService.query_connections(
      project_id=project_id, provider_key="composio")`, map each
      `Connection` into an `MCPEndpoint` with `namespace=BUILTIN`,
      `connection_id`, `provider_key`, `integration_key`, `slug` stamped
      from the connection row. `data.route.base_url` is a non-dialable placeholder
      (`composio://{provider}/{integration}/{slug}`) — no document fixes a
      real Composio MCP base URL, and D23 keeps every builtin target
      unreachable this wave anyway.
- [x] Implement `GatewayConnectionState` derivation per owner/namespace,
      exactly as specified in `entities.md` §8: NONE-scheme → `READY`;
      `custom` whose `secret_id` is set and whose `flags.is_valid` holds →
      `READY`; `builtin` with an active+valid connection → `READY`; otherwise `NEEDS_AUTH` for an
      OAuth/builtin target; `NEEDS_INPUT` reserved (unreachable, `api_key`
      deferred with D14). Implemented as `_connection_state(project_id,
      user_id, endpoint)`. Note: NOT called from `list_endpoints` — that
      method has no owner/user_id parameter (fixed by entities.md §8's own
      signature), so it cannot derive a per-caller state. `_connection_state`
      is exercised directly by its own unit tests as the seam a future
      per-owner read (WP10's CRUD router, or the D17 connect-affordance
      builder) wires in.
- [x] Unit test: agenta entries carry no `id`, `namespace=BUILTIN` with
      `provider_key="agenta"` and a dialable `data.route.base_url`; composio
      entries carry `connection_id`/`provider_key`/`integration_key`,
      `namespace=BUILTIN`; custom rows carry `namespace=CUSTOM`; no
      generated entry is ever passed to a DAO write (assert the mock DAO's
      write methods were never called for agenta/builtin entries).
- [x] Unit test: connection-state derivation for each of the four cases
      above (NONE, custom+secret, builtin+valid-connection, custom+no-secret).
- [x] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [x] Commit: "gateways(mcp): list_endpoints three-source merge".

## service.py — relay orchestration

- [x] Implement target resolution by namespace (step 1): `agenta` → code
      lookup by `name`; `builtin` → `ConnectionsService` lookup by
      `(provider, integration, name)`; `custom` →
      `fetch_endpoint_by_slug(project_id, slug=name)`. Raise
      `MCPEndpointNotFoundError` (with `namespace`, `provider`,
      `integration`, `name`) when nothing resolves.
- [x] Implement `_check_allowlist` (step 2): refuse a named tool outside an
      `tools` allowlist with `MCPToolNotAllowedError`, called BEFORE
      any resolver or adapter call.
- [x] Implement the authorize step (step 3): `self.policy.authorize(scope=,
      permission=Permission.USE_MCP_ENDPOINTS, target=)`; on denial, call
      `self.policy.record(...)` before raising `PolicyDeniedError`.
- [x] Implement secret resolution (step 4): `agenta`/`custom` via
      `self.resolver.resolve(scope=, ref=, mode=SecretMode.USER_OPTIONAL)`
      wrapped in `MCPDirectAuth`, skipped (`secret=None`) for
      NONE-scheme targets; `builtin` via `ConnectionsService` directly,
      wrapped in `MCPBrokeredAuth` — never through the resolver.
- [x] Implement dispatch (step 5): a private namespace→adapter-key mapping
      (`agenta`→`"mock"`, `builtin`→`"composio"`, `custom`→`"http"` in wave
      1), then `self.upstream_registry.get(key).relay(route=, auth=,
      context=, body=, headers=)`.
- [x] Implement record + list-filter (step 6): `self.policy.record(...)`
      with the real outcome; when `context.method` is a list operation,
      filter the JSON response body by the `tools` filter (an allowlist drops
      entries whole; `ALL` passes everything). Scoped strictly to
      `context.method == "tools/list"` — not any `*/list` method, since a
      tool allowlist says nothing about resources/prompts entries.
- [x] Unit test the step ORDER, not just the final outcome: a tool outside
      policy raises without the mock resolver or mock adapter ever being
      invoked (assert on the mocks' call counts, zero for both).
- [x] Unit test: a policy denial calls `policy.record` before the exception
      propagates — assert call order via a call-log mock, not just that
      both eventually happened.
- [x] Unit test: a `builtin` target's relay call never touches the mock
      resolver, only the mock `ConnectionsService`.
- [x] Unit test: tool-list filtering — a canned three-tool `tools/list`
      response filtered by `INCLUDE, names=["a","b"]` returns exactly two,
      unmodified in shape; `ALL` passes all three through untouched.
- [x] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [x] Commit: "gateways(mcp): relay six-step orchestration".
- [x] Added beyond the checklist: `relay()` normalizes `namespace` to the
      real `GatewayEndpointNamespace` enum on entry, because
      `_ResolvedTarget` is a plain dataclass (not pydantic) and does not
      auto-coerce a bare-string namespace the way `GatewayTarget` would —
      without this, a caller passing a plain string (the FastAPI path-param
      case) would crash on the first `.value` access downstream
      (`MCPEndpointNotFoundError`, `_ADAPTER_KEYS[namespace]`). Covered
      implicitly by every relay test, which passes plain strings.

## entrypoint wiring (coordinate at M2)

**Not applied to `routers.py` by this package** — recorded here per the six rules'
"own your paths", for whoever runs the M2 merge.

- [ ] Add the `MCPGatewayService` + `MCPUpstreamRegistry` construction
      block to `api/entrypoints/routers.py` as a diff fragment. **Updated**
      from `specs-wp9.md`'s own diff (which omits `connections_service` and
      the mock-adapter import/registration — both required, see below):

      ```diff
      -# from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
      +from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter
      +from oss.src.core.gateways.mcps.registry import MCPUpstreamRegistry
      +from oss.src.core.gateways.mcps.service import MCPGatewayService
      +
      +mcp_gateway_service = MCPGatewayService(
      +    mcp_endpoints_dao=mcp_endpoints_dao,
      +    policy=gateway_policy_service,
      +    resolver=secret_resolver,
      +    connections_service=connections_service,
      +    upstream_registry=MCPUpstreamRegistry(adapters={
      +        # "http": HttpMCPAdapter(),          # custom: MCPDirectAuth (WP8)
      +        # "composio": ComposioMCPAdapter(),  # builtin: MCPBrokeredAuth (no owner in wave 1)
      +        "mock": MockMCPAdapter(),  # serves the builtin/agenta mocks (D23, WP5)
      +    }),
      +)
      ```

      Two deltas from the spec's literal text, both load-bearing:
      1. **`connections_service=connections_service`** — without it,
         `MCPGatewayService.__init__` (as built) raises `TypeError` for a
         missing required keyword argument; `list_endpoints`'s builtin
         branch and `relay`'s builtin target resolution both call through
         it for real (see the three-source-merge section above).
      2. **The `MockMCPAdapter` import is uncommented and the adapter is
         registered under `"mock"`.** Per the coordinator's note on this
         package's landed foundation: WP5's import was left commented with
         "their imports land with those [WP7/WP9's registries], not here."
         Uncommenting it and registering it here is this package's job, not
         WP5's or a later merge step — without it the mocks are unreachable
         and Checkpoint A has nothing to relay to (D23: the mocks are the
         entire reachable target set in wave 1, no brokered target exists).
- [ ] `"http": HttpMCPAdapter()` and `"composio": ComposioMCPAdapter()` are
      left commented above, not omitted outright, so the shape of the final
      dict is visible at the merge site. `HttpMCPAdapter` is WP8's; landing
      it uncomments that line. `ComposioMCPAdapter` has no owning package in
      wave 1 (flagged already by specs-wp9.md) — decide with the merge
      reviewers whether it stays commented indefinitely or gets a raising
      stub. Do not silently invent an implementation here.
- [ ] At the M2 merge: apply this fragment together with WP6's, WP7's,
      WP8's and WP10's. Verify with `git diff` that the combined edit
      contains exactly the expected lines.
- [ ] `ruff format` && `ruff check --fix` on the merged `routers.py`.
- [ ] Commit (at the merge, not before): "gateways: wire WP6/7/8/9/10 into
      entrypoints/routers.py" (shared commit with WP8's fragment — one
      commit for the whole merged file, not one per package).

## Checkpoint A verification (acceptance, after M2 deploy)

**Not run by this package** — needs a live deployment per the "know which tests you
may run" rule, so this section stays a checklist for whoever runs the M2 deploy.

- [ ] Deploy the merged stack.
- [ ] `create_endpoint` a custom NONE-scheme MCP endpoint; confirm
      `fetch_endpoint_by_slug` resolves it and `list_endpoints` includes it
      under `namespace=CUSTOM`.
- [ ] With at least one active composio connection seeded, confirm
      `list_endpoints` includes a `namespace=BUILTIN` entry with no
      corresponding `mcps_endpoints` row.
- [ ] Confirm the shared Checkpoint A relay/allowlist assertions from
      `tasks-wp8.md` pass (this package's `relay` implementation is what
      makes them true).
- [ ] File any acceptance-test failure as a finding — this suite is shared
      with WP8; a failure may belong to either package.

## Definition of done

Feeds **Checkpoint A**. Plan.md's stated done condition, verbatim: *"a
custom server registers and resolves, and a built-in one needs no row."*
WP9 is done when: every CRUD/merge/relay unit test above passes with no
real database or network; `list_endpoints` never writes a generated entry
to the DAO; the connection-state derivation is correct for all four cases;
the relay step order is verified, not just its outcome; and the
Checkpoint A acceptance assertions above pass against the deployed stack.
