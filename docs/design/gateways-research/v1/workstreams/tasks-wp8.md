# WP8 tasks — MCP ingress and proxy

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/{dtos,types}.py`, `core/gateways/mcps/{dtos,types,interfaces}.py`)
already existing on the base branch, and on merge M1 (WP1 domain/storage,
WP2 secret resolution, WP3 policy core, WP5 fakes) having landed.

## south port

- [ ] `core/gateways/mcps/providers/http/adapter.py`: add `HttpMcpAdapter(McpUpstreamInterface)`
      with `async def relay(self, *, route: McpResolvedRoute, auth: McpRelayAuth,
      context: McpCallContext, body: bytes, headers: Dict[str, str]) -> McpRelayResult`,
      signature copied verbatim from `entities.md` §7.1.
- [ ] Implement the POST: send `body` untouched to `route.url`; merge
      `route.headers` under the caller's forwarded `headers`.
- [ ] Implement the `auth` branch: `isinstance(auth, McpDirectAuth)` only —
      raise (or assert, since this adapter is only ever reached via `custom`)
      on `McpBrokeredAuth`. When `auth.credential` is `None`, add no
      authorization header. When present, build `Authorization: {token_type}
      {access_token}` from the resolved `OAuthGrantSettingsDTO` fields.
- [ ] Map a transport failure (connection refused, timeout, DNS failure) to
      `McpUpstreamError`; do NOT raise on a non-2xx HTTP status or a
      JSON-RPC error body — return it as `McpRelayResult` untouched (D16
      pass-through rule).
- [ ] `ruff format` && `ruff check --fix` from the repo root; fix all
      errors.
- [ ] Commit: "gateways(mcp): HttpMcpAdapter south-port implementation".

## south port tests (unit)

- [ ] Unit test: body passed through byte-for-byte to the fake upstream
      (assert on what the fake received, not just what came back).
- [ ] Unit test: `route.headers` present in the outbound request; caller
      `headers` also present; no collision case needs resolving since
      `entities.md` does not specify one — assert whichever ordering the
      implementation picks and note it in the test docstring.
- [ ] Unit test: `auth.credential is None` → no `Authorization` header sent.
- [ ] Unit test: `auth.credential` present (a fake `ResolvedCredential`
      wrapping an `OAuthGrantSettingsDTO`) → `Authorization: Bearer <token>`
      (or the configured `token_type`) sent.
- [ ] Unit test: fake upstream refuses the connection → `McpUpstreamError`
      raised, carrying `target` and no false `status_code`.
- [ ] Unit test: fake upstream returns HTTP 200 with a JSON-RPC `error`
      object in the body → `McpRelayResult` returned with that body intact,
      no exception.
- [ ] `ruff format` && `ruff check --fix`; run the new unit tests; fix
      failures.
- [ ] Commit: "gateways(mcp): HttpMcpAdapter unit tests".

## utils.py

- [ ] `apis/fastapi/gateways/mcps/utils.py`: implement
      `parse_mcp_call_context(*, headers: Dict[str, str]) -> McpCallContext`,
      reading the method and target routing headers per the 2026-07-28
      MCP revision (`mcp.md`). Pin the exact header names in this file's
      module docstring, since `entities.md` explicitly defers the choice
      here.
- [ ] Raise a typed, documented error (do not invent a new exception class
      not in `entities.md` — reuse an existing domain exception or a plain
      `ValueError` translated at the proxy boundary) when a required header
      is missing or malformed.
- [ ] Unit test: representative header sets (both present; target absent
      for a method that does not need one; method missing entirely) each
      produce the expected `McpCallContext` or the expected raise.
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): parse_mcp_call_context".

## proxy.py

- [ ] `apis/fastapi/gateways/mcps/proxy.py`: `McpGatewayProxy.__init__(self,
      *, mcp_gateway_service: McpGatewayService)`, `self.router = APIRouter()`.
- [ ] Register the three POST routes exactly as in `entities.md` §9:
      `/agenta/{slug:path}` → `relay_agenta`, operation_id
      `mcp_gateway_relay_agenta`; `/builtin/{provider}/{integration}/{connection}`
      → `relay_builtin`, operation_id `mcp_gateway_relay_builtin`;
      `/custom/{slug}` → `relay_custom`, operation_id `mcp_gateway_relay_custom`.
      Confirm `{slug:path}` (not `{slug}`) on the agenta route — this is the
      one detail that silently breaks nested agenta identifiers if missed.
- [ ] Register `reject_stream_verbs` on the same three paths for `GET` and
      `DELETE`, `include_in_schema=False`, returning 405.
- [ ] Implement `relay_agenta`/`relay_builtin`/`relay_custom`: each calls
      `get_auth_scope()`, calls `parse_mcp_call_context(headers=...)`, reads
      the raw request body, and delegates to
      `self.service.relay(scope=..., namespace=..., name=..., provider=...,
      integration=..., context=..., body=..., headers=...)` — `namespace`
      is the literal `GatewayEndpointNamespace` matching the route;
      `provider`/`integration` are set only in `relay_builtin`.
- [ ] Translate the returned `McpRelayResult` into a raw `Response` with the
      relayed `status_code`, `headers`, and `body` — no wrapping envelope
      (§6: the data plane has no wire models).
- [ ] Decorate each handler with `@intercept_exceptions()` and
      `@handle_gateway_exceptions()`, importing the latter from
      `apis/fastapi/gateways/exceptions.py`. If WP10's file has not landed
      in this worktree yet, code against the documented decorator name and
      mapping table (§9) and leave a merge-point note in this task file
      rather than writing a local copy.
- [ ] `ruff format` && `ruff check --fix`; fix all errors.
- [ ] Commit: "gateways(mcp): McpGatewayProxy routes".

## proxy.py tests (unit)

- [ ] Unit test (TestClient + fake `McpGatewayService` + faked
      `get_auth_scope()`): `POST /agenta/tools/search` reaches
      `relay_agenta` with `name="tools/search"` — proves the catch-all
      nests.
- [ ] Unit test: `POST /builtin/composio/notion/my-notion` reaches
      `relay_builtin` with `provider="composio"`, `integration="notion"`,
      `name="my-notion"`.
- [ ] Unit test: `POST /custom/acme-notion` reaches `relay_custom` with
      `name="acme-notion"`.
- [ ] Unit test: `GET` and `DELETE` on all three paths return 405.
- [ ] Unit test: the fake service raising `McpToolNotAllowedError` maps to
      403 through `handle_gateway_exceptions`; raising
      `McpEndpointNotFoundError` maps to 404; raising `McpUpstreamError`
      maps to 424 (or 502 when the upstream answered ≥500, per the mapping
      table).
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): McpGatewayProxy routing tests".

## entrypoint wiring (coordinate at M2)

- [ ] Add the `"http": HttpMcpAdapter()` entry to the `McpUpstreamRegistry`
      adapters dict in `api/entrypoints/routers.py`, as a diff fragment —
      do not edit the file directly if WP9's surrounding construction
      block has not landed; raise it at the merge instead (per
      `workstreams/README.md` rule 1: own your paths).
- [ ] Add `mcp_gateway_proxy = McpGatewayProxy(mcp_gateway_service=mcp_gateway_service)`
      and `app.include_router(router=mcp_gateway_proxy.router,
      prefix="/gateways/mcps", include_in_schema=False)` as a second diff
      fragment.
- [ ] At the M2 merge: apply this package's two fragments together with
      WP6's, WP7's, WP9's and WP10's. Verify with `git diff` that the
      combined edit to `routers.py` contains exactly these lines plus the
      siblings' — no accidental double-registration of the `"http"` key.
- [ ] `ruff format` && `ruff check --fix` on the merged `routers.py`.
- [ ] Commit (at the merge, not before): "gateways: wire WP6/7/8/9/10 into
      entrypoints/routers.py".

## Checkpoint A verification (acceptance, after M2 deploy)

- [ ] Deploy the merged stack (WP1 migration applied, WP5 fake MCP server
      running as a compose service).
- [ ] `POST /gateways/mcps/agenta/<fake-slug>` with `tools/list` returns the
      fake server's own tool list unchanged.
- [ ] The same call, `tools/call` on an in-policy tool, returns the fake
      server's own result unchanged.
- [ ] The same call, `tools/call` on a tool outside the fake endpoint's
      `tool_policy`, returns 403 (`McpToolNotAllowedError`).
- [ ] `GET`/`DELETE` on any of the three relay paths returns 405.
- [ ] File any acceptance-test failure as a finding, not a silent fix —
      this suite is shared with WP9; a failure may belong to either
      package.

## Definition of done

Feeds **Checkpoint A**. Plan.md's stated done condition, verbatim: *"list
and call both relay unchanged and a tool outside the allowlist is
refused."* WP8 is done when: `parse_mcp_call_context` and `HttpMcpAdapter`
pass their unit tests with no real network or database; the three proxy
routes dispatch to the right handler with the right parsed segments,
verified against a fake service; the two `routers.py` diff fragments are
ready to hand to the M2 merge; and the Checkpoint A acceptance assertions
above pass against the deployed stack.
