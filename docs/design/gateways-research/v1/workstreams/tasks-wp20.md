# WP20 — tasks

Read [`specs-wp20.md`](specs-wp20.md) first. Branch from WP17 (`feat/gateways-wp17`).

## Phase 1 — the detector and the identity document

- [ ] `core/gateways/mcps/oauth/registration.py`: `client_metadata_url`,
      `client_metadata_document`, `identity_document_client_info`,
      `is_publicly_resolvable(api_url, *, resolve=...)` per specs-wp20.md's "The
      detector" — conservative `all()`, never raises, `https`-only.
- [ ] Unit: public address resolvable; private not; mixed public+private not;
      resolution failure/empty answer/http-scheme all not; document carries no
      `client_secret`; `identity_document_client_info()` deterministic.
- [ ] Commit: "gateways(mcp): the client registration detector and identity document".

## Phase 2 — the route

- [ ] `apis/fastapi/gateways/mcps/oauth_router.py`: `MCPOAuthClientMetadataRouter`,
      `GET /oauth/client-metadata.json`, no auth, no path parameter.
- [ ] Wire into `api/entrypoints/routers.py` under the existing `/gateways/mcps` prefix.
- [ ] Add the path (both `/gateways/...` and `/api/gateways/...` forms) to
      `middlewares/auth.py`'s `_PUBLIC_ENDPOINTS`.
- [ ] Unit: `TestClient` against a bare app carrying only this router — serves the
      document, no `client_id` field inside it, `redirect_uris` matches
      `callback_redirect_uri()`.
- [ ] Commit: "gateways(mcp): serve the oauth client identity document".

## Phase 3 — the strategy swap

- [ ] `core/gateways/mcps/oauth/state.py`: add `strategy: "document" | "outbound"` to
      `MCPOAuthStatePayload` and `make_state()`, defaulting existing callers to
      `"outbound"`.
- [ ] `core/gateways/mcps/oauth/service.py`: `MCPOAuthConnectService` gains an optional
      `resolve` constructor param; `_resolve_client_info()` implements the three-step
      order in specs-wp20.md ("The strategy, in order"); `begin()` records the chosen
      strategy in `state`; `complete()` reads it back and branches — never re-probes.
- [ ] Update `test_gateways_mcp_oauth_service.py`'s `_service()` helper to inject a
      private-address `resolve` by default, so WP17's existing tests keep exercising the
      outbound path unchanged and none of them touches real DNS.
- [ ] Unit (new file): `begin()` prefers the document when resolvable, no registration
      call, no `oauth_provider` row; `begin()` falls back to outbound when not
      resolvable; a second `begin()` on the same server keeps using the document; `complete()`
      via the document needs nothing stored beforehand.
- [ ] Unit — wrong in each direction: a test pinning that a public-classified address is
      treated as resolvable regardless of true reachability (direction 1, documented
      blind spot); a test proving a misdetected-as-internal domain still completes a full
      authorization via the outbound path (direction 2, harmless).
- [ ] Commit: "gateways(mcp): swap client registration for the two-strategy version".

## Phase 4 — close out

- [ ] `ruff format` && `ruff check --fix` in `api/`.
- [ ] Run the full API unit test suite; confirm no regression outside this package,
      and confirm no test in the suite performs a real DNS lookup or network call.
- [ ] Commit: "gateways(docs): close WP20 with the registration fallback".

## Definition of done

- A deployment whose `AGENTA_API_URL` is not publicly resolvable completes a full MCP
  OAuth authorization via the outbound path, exactly as WP17 already did, with no
  configuration flag involved in reaching that path.
- A deployment whose `AGENTA_API_URL` is publicly resolvable completes one via the
  client identity document instead, with no outbound registration call made.
- `complete()` never re-evaluates `is_publicly_resolvable()`; the strategy travels in
  `state`.
- No test reaches a real authorization server, a real MCP server, or performs a real DNS
  lookup.
