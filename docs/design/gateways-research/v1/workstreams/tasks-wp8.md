# WP8 tasks — MCP ingress and proxy

Ordered so each item is one reviewable commit. Depends on the seed commit
(`core/gateways/{dtos,types}.py`, `core/gateways/mcps/{dtos,types,interfaces}.py`)
already existing on the base branch, and on merge M1 (WP1 domain/storage,
WP2 secret resolution, WP3 policy core, WP5 fakes) having landed.

## south port

- [x] `core/gateways/mcps/providers/http/adapter.py`: add `HttpMcpAdapter(McpUpstreamInterface)`
      with `async def relay(self, *, route: McpResolvedRoute, auth: McpRelayAuth,
      context: McpCallContext, body: bytes, headers: Dict[str, str]) -> McpRelayResult`,
      signature copied verbatim from `entities.md` §7.1. Added a keyword-only
      `__init__(self, *, transport: Optional[httpx.BaseTransport] = None)` beyond the
      interface's bare signature — an injectable seam for `httpx.MockTransport` in unit
      tests; `HttpMcpAdapter()` (zero-arg, per the wiring diff below) is unaffected.
- [x] Implement the POST: send `body` untouched to `route.url`; merge
      `route.headers` under the caller's forwarded `headers`. Judgment call: "merged
      under" is implemented as `{**route.headers, **headers}` — the caller's header wins
      on a name collision (test:
      `test_caller_header_wins_on_collision_with_route_header`, docstring states the
      choice). The caller's own `Host` header is always dropped (it named this gateway,
      not the upstream); a fresh `Host` is set only when the guard pins to a literal IP.
- [x] Implement the `auth` branch: `isinstance(auth, McpBrokeredAuth)` — raises
      `TypeError` (this adapter is only ever reached via `custom`, by construction of
      WP9's registry routing, not by a namespace check inside this class). When
      `auth.credential` is `None`, no authorization header is added. When present,
      `Authorization: {token_type} {access_token}` is built from the resolved grant —
      read via `getattr` on `auth.credential.secret.data.grant`, NOT imported, because
      `OAuthGrantSettingsDTO` (entities.md §4.5) is WP16 seed / wave 3 and does not exist
      in this codebase yet; this needs no change once it lands.
- [x] Map a transport failure (connection refused, timeout, DNS failure) to
      `McpUpstreamError`; do NOT raise on a non-2xx HTTP status or a
      JSON-RPC error body — return it as `McpRelayResult` untouched (D16
      pass-through rule).
- [x] **SSRF guard, before the POST (D28).** `from oss.src.core.webhooks.utils
      import resolve_validated_webhook_ip`; call it on `route.url` for `custom`
      targets only. Write no new guard — that module is the one three other
      call sites already use. Implemented as unconditional inside `HttpMcpAdapter.relay`
      (no namespace parameter exists on the port to branch on — see §7.1's frozen
      signature); correctness rests on WP9's registry routing only `custom` to the
      `"http"` adapter key, per specs-wp8.md's own framing of this adapter.
- [x] Translate its `ValueError` into `McpUpstreamError`, keeping the two
      messages distinct: a "could not be resolved" DNS failure must not read as
      a security rejection (the runner's guard makes the same distinction,
      `services/runner/src/engines/sandbox_agent/mcp.ts:191`).
- [x] **Connect to the returned literal IP, not the hostname** — the whole
      reason the function returns a value. Copy the pinning from
      `api/oss/src/core/webhooks/delivery.py::send_webhook_request`: literal IP
      in the URL (bracket IPv6, keep an explicit port), `Host` header set back
      to the original authority, `extensions={"sni_hostname": parsed.hostname}`
      so TLS validates against the real name. Re-resolving in the client
      reopens the rebind window.
- [x] Add the host-allowlist escape hatch to `api/oss/src/utils/env.py` and read
      it through the shared `env` object — never `os.getenv` in feature code
      (`api/AGENTS.md`). Mirrors the runner's `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`,
      so a self-hoster can permit one internal server without disabling the
      guard globally. Landed as `McpGatewayConfig.host_allowlist` (env var
      `AGENTA_MCP_GATEWAY_HOST_ALLOWLIST`, comma-separated), field `mcp_gateway` on
      `EnvironSettings` — alphabetically between `loops` and `mounts`, per the file's
      ordering. A listed host bypasses the guard entirely (both the range block and the
      literal-IP pin), mirroring the runner's `if (allowed) return undefined;`.
- [x] `ruff format` && `ruff check --fix` from the repo root; fix all
      errors.
- [x] Commit: "gateways(mcp): HttpMcpAdapter south-port implementation".

## south port tests (unit)

- [x] Unit test: body passed through byte-for-byte to the fake upstream
      (assert on what the fake received, not just what came back).
- [x] Unit test: `route.headers` present in the outbound request; caller
      `headers` also present; no collision case needs resolving since
      `entities.md` does not specify one — assert whichever ordering the
      implementation picks and note it in the test docstring.
- [x] Unit test: `auth.credential is None` → no `Authorization` header sent.
- [x] Unit test: `auth.credential` present (a fake `ResolvedCredential`
      wrapping an `OAuthGrantSettingsDTO`) → `Authorization: Bearer <token>`
      (or the configured `token_type`) sent. Since `OAuthGrantSettingsDTO` doesn't exist
      yet, the fake credential is a `types.SimpleNamespace` shaped like its future
      `.secret.data.grant.{access_token,token_type}`, injected via
      `McpDirectAuth.model_construct(credential=...)` to bypass pydantic validation.
- [x] Unit test: fake upstream refuses the connection → `McpUpstreamError`
      raised, carrying `target` and no false `status_code`.
- [x] Unit test: fake upstream returns HTTP 200 with a JSON-RPC `error`
      object in the body → `McpRelayResult` returned with that body intact,
      no exception.
- [x] **SSRF unit tests, all with `AGENTA_INSECURE_EGRESS_ALLOWED=false` set
      explicitly** — it defaults to `true`, so a test that omits it passes while
      proving nothing: a `custom` route at `http://169.254.169.254/` is refused;
      at `http://127.0.0.1/` refused; at `http://10.0.0.1/` refused; a plain
      `http://` public host refused; an unresolvable hostname produces the
      resolution message, not the blocked-range one. Implemented by monkeypatching
      `oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE = False` directly (the same
      technique `unit/webhooks/test_webhooks_utils.py` already uses, since the flag
      resolves once at import time into that module constant) — this repo's whole test
      suite additionally pins this constant `False` by default via an autouse fixture
      (`oss/tests/pytest/utils/egress.py`), so these cases are secure-by-default even
      without the module-local fixture; the local fixture makes that explicit rather than
      relying on the suite-wide default.
- [x] Unit test: with a public hostname resolving to a public IP (patch the
      resolver, as `api/oss/tests/pytest/unit/webhooks/test_webhooks_utils.py`
      does), the outbound request goes to the **literal IP** while the `Host`
      header carries the hostname.
- [x] Unit test: an `agenta` route to a private address is NOT refused — the
      guard is namespace-scoped, and WP5's fakes live on a compose host. Implemented
      against `FakeMcpAdapter` (WP5, read-only import) directly, since `agenta` routes to
      that adapter, not to `HttpMcpAdapter` — the guard lives only on the latter, so the
      former never runs it regardless of `route.url`.
- [x] `ruff format` && `ruff check --fix`; run the new unit tests; fix
      failures.
- [x] Commit: "gateways(mcp): HttpMcpAdapter unit tests".

**Finding, not fixed here (out of WP8's file ownership):** the pre-existing WP5 contract
test `oss/tests/pytest/unit/gateways/test_fake_adapters_contract.py::test_relay_returns_mcp_relay_result[*-HttpMcpAdapter]`
now fails now that `HttpMcpAdapter` exists. It builds a zero-arg `HttpMcpAdapter()` (no
`MockTransport`) and calls `.relay()` against `route=McpResolvedRoute(url="http://fake-mcp-gateway:9092/")`
— plain `http`, a compose-only hostname. This repo's test suite pins
`AGENTA_INSECURE_EGRESS_ALLOWED` secure-by-default for every test
(`oss/tests/pytest/utils/egress.py`'s autouse `secure_egress_by_default` fixture, opt out
via `@pytest.mark.allow_insecure_env`), so the guard now correctly rejects the bare-`http`
URL with "must use https" before any DNS lookup — this is D28's guard working as
designed, not a defect in `HttpMcpAdapter`. Any conforming implementation of the guard
would reject this exact call under this suite's default posture. The contract test needs
one of: the `allow_insecure_env` marker plus an actually-reachable `https` fake-gateway
target, an injected `MockTransport`, or a host-allowlist entry — a call for whoever owns
that file (WP5) or the M2 merge coordinator, not WP8.

## utils.py

- [x] `apis/fastapi/gateways/mcps/utils.py`: implement
      `parse_mcp_call_context(*, headers: Dict[str, str]) -> McpCallContext`,
      reading the method and target routing headers per the 2026-07-28
      MCP revision (`mcp.md`). Pin the exact header names in this file's
      module docstring, since `entities.md` explicitly defers the choice
      here. Pinned against `docs/design/gateways-research/v1/raw/mcp-2026-07-28.md`
      ("Header-based routing"): `Mcp-Method` (required) and `Mcp-Name` (target for
      `tools/call`/`resources/read`/`prompts/get`; absent for target-less methods).
      Lookup is case-insensitive.
- [x] Raise a typed, documented error (do not invent a new exception class
      not in `entities.md` — reuse an existing domain exception or a plain
      `ValueError` translated at the proxy boundary) when a required header
      is missing or malformed. Implemented as a plain `ValueError`; `proxy.py`'s
      `_relay` catches it and raises `HTTPException(400)` inline (the "Example 2" inline
      pattern in `api/AGENTS.md`), since `handle_gateway_exceptions()` doesn't cover it
      and mustn't be extended for a non-domain, request-shape error.
- [x] Unit test: representative header sets (both present; target absent
      for a method that does not need one; method missing entirely) each
      produce the expected `McpCallContext` or the expected raise.
- [x] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [x] Commit: "gateways(mcp): parse_mcp_call_context".

## proxy.py

- [x] `apis/fastapi/gateways/mcps/proxy.py`: `McpGatewayProxy.__init__(self,
      *, mcp_gateway_service: McpGatewayService)`, `self.router = APIRouter()`.
      `McpGatewayService` is not on this branch yet (WP9 unmerged) — imported only under
      `TYPE_CHECKING` with `from __future__ import annotations`, so the module loads with
      no runtime dependency on WP9 and picks up the real type the moment it lands.
- [x] Register the three POST routes exactly as in `entities.md` §9:
      `/agenta/{slug:path}` → `relay_agenta`, operation_id
      `mcp_gateway_relay_agenta`; `/builtin/{provider}/{integration}/{connection}`
      → `relay_builtin`, operation_id `mcp_gateway_relay_builtin`;
      `/custom/{slug}` → `relay_custom`, operation_id `mcp_gateway_relay_custom`.
      Confirm `{slug:path}` (not `{slug}`) on the agenta route — this is the
      one detail that silently breaks nested agenta identifiers if missed.
- [x] Register `reject_stream_verbs` on the same three paths for `GET` and
      `DELETE`, `include_in_schema=False`, returning 405.
- [x] Implement `relay_agenta`/`relay_builtin`/`relay_custom`: each calls
      `get_auth_scope()`, calls `parse_mcp_call_context(headers=...)`, reads
      the raw request body, and delegates to
      `self.service.relay(scope=..., namespace=..., name=..., provider=...,
      integration=..., context=..., body=..., headers=...)` — `namespace`
      is the literal `GatewayEndpointNamespace` matching the route;
      `provider`/`integration` are set only in `relay_builtin`. Judgment call: the
      proxy strips its own `Authorization` header (the caller's platform token) from
      `headers` before it reaches `parse_mcp_call_context`/`service.relay` — an upstream
      `custom` server must never see the secret that authenticated the caller to us;
      `interfaces.py`'s docstring says `headers` arrive at the adapter "already stripped
      of authorization" but does not say which layer strips them, and the proxy is the
      first code to hold the raw `request.headers`.
- [x] Translate the returned `McpRelayResult` into a raw `Response` with the
      relayed `status_code`, `headers`, and `body` — no wrapping envelope
      (§6: the data plane has no wire models).
- [x] Decorate each handler with `@intercept_exceptions()` and
      `@handle_gateway_exceptions()`, importing the latter from
      `apis/fastapi/gateways/exceptions.py` — a **seed** file (R1), already on
      the branch. Import it; never write a local copy.
- [x] `ruff format` && `ruff check --fix`; fix all errors.
- [x] Commit: "gateways(mcp): McpGatewayProxy routes".

## proxy.py tests (unit)

- [x] Unit test (TestClient + fake `McpGatewayService` + faked
      `get_auth_scope()`): `POST /agenta/tools/search` reaches
      `relay_agenta` with `name="tools/search"` — proves the catch-all
      nests.
- [x] Unit test: `POST /builtin/composio/notion/my-notion` reaches
      `relay_builtin` with `provider="composio"`, `integration="notion"`,
      `name="my-notion"`.
- [x] Unit test: `POST /custom/acme-notion` reaches `relay_custom` with
      `name="acme-notion"`.
- [x] Unit test: `GET` and `DELETE` on all three paths return 405.
- [x] Unit test: the fake service raising `McpToolNotAllowedError` maps to
      403 through `handle_gateway_exceptions`; raising
      `McpEndpointNotFoundError` maps to 404; raising `McpUpstreamError`
      maps to 424 (or 502 when the upstream answered ≥500, per the mapping
      table).
- [x] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [x] Commit: "gateways(mcp): McpGatewayProxy routing tests".

## entrypoint wiring (coordinate at M2)

- [x] Add the `"http": HttpMcpAdapter()` entry to the `McpUpstreamRegistry`
      adapters dict in `api/entrypoints/routers.py`, as a diff fragment —
      do not edit the file directly if WP9's surrounding construction
      block has not landed; raise it at the merge instead (per
      `workstreams/README.md` rule 1: own your paths).
- [x] Add `mcp_gateway_proxy = McpGatewayProxy(mcp_gateway_service=mcp_gateway_service)`
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

**WP8's two fragments, as-written (not applied — `routers.py` stays untouched by this
package; current placeholders read at commit time are quoted for context).**

Fragment 1 — the import (currently commented at `api/entrypoints/routers.py:181`):

```diff
-# from oss.src.apis.fastapi.gateways.mcps.proxy import McpGatewayProxy     # WP8
+from oss.src.apis.fastapi.gateways.mcps.proxy import McpGatewayProxy
+from oss.src.core.gateways.mcps.providers.http.adapter import HttpMcpAdapter
```

Fragment 2 — the adapter registry entry, into WP9's `McpUpstreamRegistry` construction
(the block does not exist on this branch yet; shown relative to its shape in
`specs-wp9.md` / `entities.md` §9's wiring block):

```diff
     upstream_registry=McpUpstreamRegistry(adapters={
-        # WP9 constructs this dict; WP8, WP5 and (later) the Composio
-        # adapter each contribute one entry, combined at the M2 merge.
+        "http": HttpMcpAdapter(),          # custom: McpDirectAuth
     }),
```

Fragment 3 — the proxy construction, next to WP9's `mcp_gateway_service` construction:

```diff
+mcp_gateway_proxy = McpGatewayProxy(mcp_gateway_service=mcp_gateway_service)
```

Fragment 4 — the mount (currently commented at `api/entrypoints/routers.py:1519`,
alongside WP10's `mcp_gateway.router` line on 1518, which this package does not touch):

```diff
-# app.include_router(router=mcp_gateway.proxy,  prefix="/gateways/mcps", include_in_schema=False)
+app.include_router(
+    router=mcp_gateway_proxy.router,
+    prefix="/gateways/mcps",
+    include_in_schema=False,
+)
```

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
