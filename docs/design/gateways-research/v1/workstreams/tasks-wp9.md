# WP9 tasks — MCP registry and tool allowlist

Ordered so each item is one reviewable commit. Depends on the seed commit
and on merge M1 (WP1's `dbs/postgres/gateways/mcps/` DAO implementation and
migration, WP2's `CredentialResolverInterface` implementation, WP3's
`GatewayPolicyService`) having landed.

## registry.py

- [ ] `core/gateways/mcps/registry.py`: add `McpUpstreamRegistry.__init__(self,
      *, adapters: Dict[str, McpUpstreamInterface])`, `get(self, key: str) ->
      McpUpstreamInterface` (raises on a miss), `keys(self) -> list[str]` —
      shape copied from `ConnectionsGatewayRegistry`
      (`api/oss/src/core/gateway/connections/registry.py`).
- [ ] Pick the raise for a missing key: an already-declared
      `core/gateways/mcps/types.py` exception (e.g. `McpUpstreamError` with
      a message naming the key), not a new public exception name and not a
      cross-domain import — see "Missing from the design" in `specs-wp9.md`.
- [ ] Unit test: `get()` on a registered key returns that adapter; `get()`
      on a missing key raises; `keys()` returns exactly the registered set.
- [ ] `ruff format` && `ruff check --fix`; fix all errors.
- [ ] Commit: "gateways(mcp): McpUpstreamRegistry".

## service.py — management CRUD

- [ ] `core/gateways/mcps/service.py`: `McpGatewayService.__init__(self, *,
      mcp_endpoints_dao, mcp_grants_dao, policy, resolver, upstream_registry)`.
- [ ] Implement `create_endpoint`, `fetch_endpoint`, `edit_endpoint`,
      `delete_endpoint`, `query_endpoints` as thin delegations to
      `McpEndpointsDAOInterface`.
- [ ] Unit test each, with a fake DAO (in-memory dict), asserting the right
      DAO verb is called with the right arguments and the return value is
      passed through unchanged.
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): McpGatewayService CRUD delegation".

## service.py — the three-namespace merge

- [ ] Implement `list_endpoints(*, project_id) -> List[McpEndpoint]`:
      `custom` branch maps `query_endpoints()` rows 1:1.
- [ ] `agenta` branch: a private, service-internal enumeration (not a
      public symbol `entities.md` does not name) of the code-defined
      agenta entries — in wave 1, the fakes WP5 registers.
- [ ] `builtin` branch: call `ConnectionsService.query_connections(
      project_id=project_id, provider_key="composio")`, map each
      `Connection` into an `McpEndpoint` with `namespace=BUILTIN`,
      `connection_id`, `provider_key`, `integration_key`, `slug` stamped
      from the connection row.
- [ ] Implement `GatewayConnectionState` derivation per owner/namespace,
      exactly as specified in `entities.md` §8: NONE-scheme → `READY`;
      `custom` with a valid grant for this owner → `READY`; `builtin` with
      an active+valid connection → `READY`; otherwise `NEEDS_AUTH` for an
      OAuth/builtin target; `NEEDS_INPUT` reserved (unreachable, `api_key`
      deferred with D14).
- [ ] Unit test: agenta entries carry no `id`, `namespace=AGENTA`; builtin
      entries carry `connection_id`/`provider_key`/`integration_key`,
      `namespace=BUILTIN`; custom rows carry `namespace=CUSTOM`; no
      generated entry is ever passed to a DAO write (assert the fake DAO's
      write methods were never called for agenta/builtin entries).
- [ ] Unit test: connection-state derivation for each of the four cases
      above (NONE, custom+grant, builtin+valid-connection, custom+no-grant).
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): list_endpoints three-namespace merge".

## service.py — grants (declared, not implemented)

- [ ] Declare `connect_endpoint`, `complete_connect`, `revoke_grant`,
      `query_grants` with the exact signatures from `entities.md` §8, each
      body raising `NotImplementedError`.
- [ ] Unit test: calling each raises `NotImplementedError` (a guard so a
      future accidental partial implementation is caught by a failing
      test, forcing a deliberate update to this task file when WP17/WP18
      fill them in).
- [ ] `ruff format` && `ruff check --fix`; fix all errors.
- [ ] Commit: "gateways(mcp): declare grants surface for WP17/WP18".

## service.py — relay orchestration

- [ ] Implement target resolution by namespace (step 1): `agenta` → code
      lookup by `name`; `builtin` → `ConnectionsService` lookup by
      `(provider, integration, name)`; `custom` →
      `fetch_endpoint_by_slug(project_id, slug=name)`. Raise
      `McpEndpointNotFoundError` (with `namespace`, `provider`,
      `integration`, `name`) when nothing resolves.
- [ ] Implement `_check_allowlist` (step 2): refuse a named tool outside an
      `INCLUDE` tool_policy with `McpToolNotAllowedError`, called BEFORE
      any resolver or adapter call.
- [ ] Implement the authorize step (step 3): `self.policy.authorize(scope=,
      permission=Permission.USE_MCP_ENDPOINTS, target=)`; on denial, call
      `self.policy.record(...)` before raising `PolicyDeniedError`.
- [ ] Implement credential resolution (step 4): `agenta`/`custom` via
      `self.resolver.resolve(scope=, ref=, mode=CredentialMode.USER_OPTIONAL)`
      wrapped in `McpDirectAuth`, skipped (`credential=None`) for
      NONE-scheme targets; `builtin` via `ConnectionsService` directly,
      wrapped in `McpBrokeredAuth` — never through the resolver.
- [ ] Implement dispatch (step 5): a private namespace→adapter-key mapping
      (`agenta`→`"fake"`, `builtin`→`"composio"`, `custom`→`"http"` in wave
      1), then `self.upstream_registry.get(key).relay(route=, auth=,
      context=, body=, headers=)`.
- [ ] Implement record + list-filter (step 6): `self.policy.record(...)`
      with the real outcome; when `context.method` is a list operation,
      filter the JSON response body by `tool_policy` (`INCLUDE` drops
      entries whole; `ALL` passes everything).
- [ ] Unit test the step ORDER, not just the final outcome: a tool outside
      policy raises without the fake resolver or fake adapter ever being
      invoked (assert on the fakes' call counts, zero for both).
- [ ] Unit test: a policy denial calls `policy.record` before the exception
      propagates — assert call order via a call-log fake, not just that
      both eventually happened.
- [ ] Unit test: a `builtin` target's relay call never touches the fake
      resolver, only the fake `ConnectionsService`.
- [ ] Unit test: tool-list filtering — a canned three-tool `tools/list`
      response filtered by `INCLUDE, names=["a","b"]` returns exactly two,
      unmodified in shape; `ALL` passes all three through untouched.
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): relay six-step orchestration".

## entrypoint wiring (coordinate at M2)

- [ ] Add the `McpGatewayService` + `McpUpstreamRegistry` construction
      block to `api/entrypoints/routers.py` as a diff fragment (see
      `specs-wp9.md`'s diff section) — this is the block WP8's `"http"`
      adapter entry and WP10's router construction both attach to.
- [ ] Flag at the merge: the `"composio": ComposioMcpAdapter()` entry has
      no owning wave-1 package. Decide with the merge reviewers whether to
      omit it (accepting that `builtin` relay calls fail at
      `upstream_registry.get("composio")` until a later package lands it)
      or stub it. Do not silently invent an implementation here.
- [ ] At the M2 merge: apply this fragment together with WP6's, WP7's,
      WP8's and WP10's. Verify with `git diff` that the combined edit
      contains exactly the expected lines.
- [ ] `ruff format` && `ruff check --fix` on the merged `routers.py`.
- [ ] Commit (at the merge, not before): "gateways: wire WP6/7/8/9/10 into
      entrypoints/routers.py" (shared commit with WP8's fragment — one
      commit for the whole merged file, not one per package).

## Checkpoint A verification (acceptance, after M2 deploy)

- [ ] Deploy the merged stack.
- [ ] `create_endpoint` a custom NONE-scheme MCP endpoint; confirm
      `fetch_endpoint_by_slug` resolves it and `list_endpoints` includes it
      under `namespace=CUSTOM`.
- [ ] With at least one active composio connection seeded, confirm
      `list_endpoints` includes a `namespace=BUILTIN` entry with no
      corresponding `mcp_gateway_endpoints` row.
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
