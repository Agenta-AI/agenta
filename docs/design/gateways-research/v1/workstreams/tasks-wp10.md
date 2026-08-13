# WP10 tasks — Endpoint CRUD API

Ordered so each item is one reviewable commit. Depends on the seed commit
and on merge M1 (WP1's DAO implementations, WP3's six new `Permission`
members) having landed.

## exceptions.py — NOT this package's file any more (R1)

- [ ] **Do not write `apis/fastapi/gateways/exceptions.py`.** R1 moved it to the
      seed, so it is already on the branch: three packages need
      `handle_gateway_exceptions()` — this one and both proxies (WP6, WP8) — and
      the three are siblings in the dependency graph, so no one of them could own
      it. Import it and verify the mapping matches `specs-wp10.md`; report a
      mismatch rather than editing a seed file.

## SSRF gate on custom MCP endpoint registration (D28)

- [ ] `from oss.src.core.webhooks.utils import validate_url_format_and_literal_ip`
      — the **no-DNS** variant. Write no new guard.
- [ ] Call it on the URL in `McpEndpointCreateRequest` / `McpEndpointEditRequest`
      for the `custom` namespace only. `agenta` and `builtin` URLs are not
      user-supplied. The precedent to copy exactly is
      `api/oss/src/core/secrets/dtos.py:140`, which gates `custom_provider.url`
      the same way and re-raises naming the field.
- [ ] Surface a rejection as a 400 through the domain-exception path, never a
      leaked `ValueError`; the message names the field and the reason.
- [ ] Check whether the LLM `custom` endpoint DTO carries a base URL. If it does,
      gate it identically; if not, add nothing speculatively.
- [ ] Unit tests **with `AGENTA_INSECURE_EGRESS_ALLOWED=false` set explicitly** —
      it defaults to `true`, so a test that omits it passes while proving
      nothing: create with `http://169.254.169.254/mcp` → 400; with
      `http://127.0.0.1/mcp` → 400; with `http://10.0.0.1/mcp` → 400; plain
      `http://` to a public host → 400; `https://` to a public hostname →
      accepted **without a DNS lookup happening** (that is the whole point of
      this variant — assert no resolution is attempted).
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): SSRF gate on custom endpoint registration".

## llms/models.py

- [ ] `apis/fastapi/gateways/llms/models.py`: add
      `LlmEndpointCreateRequest`, `LlmEndpointEditRequest`,
      `LlmEndpointQueryRequest`, `LlmEndpointResponse`,
      `LlmEndpointsResponse` — field names, types and defaults exactly as
      `entities.md` §6. `Field(default_factory=list)` for the list default,
      not bare `[]`.
- [ ] Unit test: instantiate every class above with representative values.
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(llm): CRUD wire models".

## mcps/models.py

- [ ] `apis/fastapi/gateways/mcps/models.py`: add `McpEndpointCreateRequest`,
      `McpEndpointEditRequest`, `McpEndpointQueryRequest`,
      `McpEndpointResponse`, `McpEndpointsResponse`, `McpGrantQueryRequest`,
      `McpGrantResponse`, `McpGrantsResponse`, `McpConnectRequest`,
      `McpConnectResponse` — exactly as `entities.md` §6.
- [ ] Confirm no `McpGrantCreateRequest`/`McpGrantEditRequest` exist
      anywhere in this file or are imported elsewhere — grants have no
      create/edit wire model by design (§6).
- [ ] Unit test: instantiate every class above with representative values.
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): CRUD + grant wire models".

## llms/router.py

- [ ] `apis/fastapi/gateways/llms/router.py`: `LlmGatewayRouter.__init__(self,
      *, llm_gateway_service: LlmGatewayService)`, `self.router = APIRouter()`.
- [ ] Add `async def _check(self, scope: AuthScope, permission: Permission) ->
      None`, factored (following `TriggersRouter._check`, adapted to take
      `scope` not `request`), calling `check_action_access(user_uid=str(scope.user_id),
      project_id=str(scope.project_id), permission=permission)` and raising
      `FORBIDDEN_EXCEPTION` on denial.
- [ ] Register the six routes exactly as `entities.md` §9: `POST /endpoints/`
      (create, `EDIT_LLM_ENDPOINTS`), `GET /endpoints/` (list,
      `VIEW_LLM_ENDPOINTS`), `POST /endpoints/query` (query,
      `VIEW_LLM_ENDPOINTS`), `GET /endpoints/{endpoint_id}` (fetch,
      `VIEW_LLM_ENDPOINTS`), `PUT /endpoints/{endpoint_id}` (edit,
      `EDIT_LLM_ENDPOINTS`), `DELETE /endpoints/{endpoint_id}` (delete,
      `EDIT_LLM_ENDPOINTS`). Every route: `operation_id` matching the
      table, `response_model_exclude_none=True` (except delete, which
      returns no body per the tools/triggers delete precedent).
- [ ] Implement each handler: `get_auth_scope()`, `self._check(...)`,
      service call, envelope. `fetch_endpoint`/`edit_endpoint` raise
      `LlmEndpointNotFoundError` on a `None` service return;
      `delete_endpoint` raises it on `False`.
- [ ] Decorate every handler `@intercept_exceptions()` then
      `@handle_gateway_exceptions()`.
- [ ] `ruff format` && `ruff check --fix`; fix all errors.
- [ ] Commit: "gateways(llm): LlmGatewayRouter CRUD".

## llms/router.py tests (unit)

- [ ] TestClient + mock `LlmGatewayService` + mockd `get_auth_scope()` /
      `check_action_access()`: each of the six routes reaches the right
      handler with the right operation_id/method/path.
- [ ] A denied `_check` short-circuits before the mock service is called —
      assert the mock's call count is zero.
- [ ] `None` from `fetch_endpoint`/`edit_endpoint` → 404; `False` from
      `delete_endpoint` → 404.
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(llm): LlmGatewayRouter tests".

## mcps/router.py

- [ ] `apis/fastapi/gateways/mcps/router.py`: `McpGatewayRouter.__init__(self,
      *, mcp_gateway_service: McpGatewayService)`, `self.router = APIRouter()`,
      its own `_check(self, scope, permission)` helper (do not share one
      instance between the two router classes).
- [ ] Register the same six endpoint-CRUD routes as the LLM router, with
      `VIEW_MCP_ENDPOINTS`/`EDIT_MCP_ENDPOINTS`.
- [ ] Register `POST /grants/query` (`query_mcp_grants`, `VIEW_MCP_ENDPOINTS`)
      and `DELETE /grants/{grant_id}` (`revoke_mcp_grant`,
      `EDIT_MCP_ENDPOINTS`) — both untagged in `entities.md`'s route table,
      both this package's to wire even though the service bodies they call
      raise `NotImplementedError` until wave 3.
- [ ] Do NOT register `POST /endpoints/{endpoint_id}/connect` or
      `GET /connect/callback` — tagged `(WP18)`, out of scope for this
      package.
- [ ] Decorate every handler `@intercept_exceptions()` then
      `@handle_gateway_exceptions()`.
- [ ] `ruff format` && `ruff check --fix`; fix all errors.
- [ ] Commit: "gateways(mcp): McpGatewayRouter CRUD + grant reads".

## mcps/router.py tests (unit)

- [ ] TestClient + mock `McpGatewayService`: each of the eight routes
      (six CRUD + two grant) reaches the right handler.
- [ ] Confirm `POST /endpoints/{id}/connect` and `GET /connect/callback`
      are NOT registered on this router (a 404 from FastAPI's own routing,
      not a handled response) — a deliberate absence test, not just an
      omission.
- [ ] A denied `_check` short-circuits before the mock service is called.
- [ ] Calling `query_mcp_grants`/`revoke_mcp_grant` against a mock service
      whose methods raise `NotImplementedError` propagates as an unhandled
      500 (confirms the mapping table correctly does NOT catch it — this
      is expected wave-1 behavior, not a bug to fix here).
- [ ] `ruff format` && `ruff check --fix`; run tests; fix failures.
- [ ] Commit: "gateways(mcp): McpGatewayRouter tests".

## entrypoint wiring (coordinate at M2)

- [ ] Add `llm_gateway_router = LlmGatewayRouter(llm_gateway_service=llm_gateway_service)`
      and `mcp_gateway_router = McpGatewayRouter(mcp_gateway_service=mcp_gateway_service)`
      to `api/entrypoints/routers.py` as a diff fragment — coordinate with
      WP7's and WP9's service-construction fragments landing first, or
      raise at the merge if they have not.
- [ ] Add the two `app.include_router(...)` mounts
      (`prefix="/gateways/llms", tags=["Gateway: LLM"]` and
      `prefix="/gateways/mcps", tags=["Gateway: MCP"]`).
- [ ] Raise the `exceptions.py` cross-dependency (WP6/WP8 importing
      `handle_gateway_exceptions` from this package's file) explicitly at
      the merge — confirm both proxies' imports resolve cleanly against
      what this package actually wrote, not just the documented signature
      they coded against.
- [ ] At the M2 merge: apply this fragment together with WP6's, WP7's,
      WP8's and WP9's. Verify with `git diff` that the combined edit
      contains exactly the expected lines.
- [ ] `ruff format` && `ruff check --fix` on the merged `routers.py`.
- [ ] Commit (at the merge, not before): "gateways: wire WP6/7/8/9/10 into
      entrypoints/routers.py" (shared commit — one commit for the whole
      merged file).

## Checkpoint A verification (acceptance, after M2 deploy)

- [ ] Deploy the merged stack.
- [ ] `POST /gateways/mcps/endpoints/` with a NONE-scheme custom endpoint
      returns 200 with a UUID `id`.
- [ ] `DELETE /gateways/mcps/endpoints/{that id}` removes the row; a
      subsequent `GET` on it returns 404.
- [ ] `PUT /gateways/mcps/endpoints/{any UUID not present in
      mcp_gateway_endpoints}` returns 404 — confirming no request can
      reach a generated (builtin/agenta) entry through this router.
- [ ] Repeat the create/delete/edit-404 sequence for the LLM router against
      `/gateways/llms/endpoints/`.
- [ ] File any acceptance-test failure as a finding.

## Definition of done

Feeds **Checkpoint A**. Plan.md's stated done condition, verbatim: *"a
custom endpoint can be created and deleted, and a standard one cannot be
edited."* WP10 is done when: every wire model instantiates; every mapped
exception produces the right status and body shape; both routers' routes
dispatch correctly against mocks with no real database; the `(WP18)`-tagged
routes are absent by construction; and the Checkpoint A acceptance
assertions above pass against the deployed stack.
