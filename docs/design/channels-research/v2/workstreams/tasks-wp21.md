# WP21 — tasks

Spec: [specs-wp21.md](specs-wp21.md). Design: `channel-connections.md`,
`agenta-channel.md`.

This package edits a frozen file. Do it first, in one pass, and merge before WP22
starts.

## The request context

- [ ] `ChannelRequestContext` in `core/channels/dtos.py` — `headers`, `path`, `body`.
      A plain DTO; no FastAPI import anywhere in `core/`.
- [ ] Replace `installation_hint(*, body)` with
      `connection_locator(*, request: ChannelRequestContext) -> Optional[Dict[str, Any]]`.
      Abstract, never defaulted.
- [ ] Slack: read `team_id` flat **and** `team.id` nested — the interactivity shape
      the current extractor misses.
- [ ] Bridge: read the envelope's `source`, normalised to the bare id, as today.
- [ ] Mock: return its fixed installation locator.
- [ ] `_ingest` builds one `ChannelRequestContext` from the FastAPI request and
      passes it to both `connection_locator` and `verify_signature`.

## verify_signature

- [ ] Interface declares `(*, request: ChannelRequestContext, connection: ChannelConnection) -> str`.
      `connection` is **required**.
- [ ] All three adapters match it. Delete the `connection or self._connection`
      fallback and the constructor-held connection it existed for.
- [ ] Slack's `parse_event` no longer reads `self._connection` for the bot user id —
      it takes what it needs from the call. Bot-echo filtering silently does nothing
      today under the shared registry instance; check it works after.
- [ ] Docstring states the widened meaning: prove the caller may speak for this
      connection, return the id it speaks for. Not "verify an HMAC".

## fetch_capabilities

- [ ] Interface takes `connection: Optional[ChannelConnection] = None`.
- [ ] `ChannelsService.fetch_capabilities` gains the parameter and passes it through.
- [ ] Update all six call sites across the three files; a per-connection declaration
      wins where stored, the channel default otherwise.
- [ ] Bridge stops baking capabilities into the constructor — that is what makes two
      bridges share one declaration.

## The guards

- [ ] AST check walks `ast.FunctionDef` and `ast.AsyncFunctionDef`.
- [ ] Expected count derived from `ChannelAdapterInterface.__abstractmethods__`, not
      a literal. Adding a method updates the guard instead of evading it.
- [ ] Contract suite builds each adapter **as `routers.py` builds it** — no
      constructor connection — and passes the connection per call.
- [ ] `normalise_capabilities` applied to first-party declarations. Slack's
      `fetch_slack_capabilities` goes through it rather than `model_validate`.
- [ ] Slack's declared `text.max_chars` becomes 3000. `capabilities.md` explains
      why: 4000 is client-side guidance, 3000 is the enforced Block Kit ceiling and
      the number the renderer must respect.

## Tests

- [ ] Keyword-only check fails on a sync method with a positional parameter.
- [ ] Count check fails when a method is added without updating nothing else.
- [ ] Contract suite green against Slack, bridge and mock, composition-root shaped.
- [ ] A locator resolved from a header only (no body identity) — the Telegram shape,
      written against the mock adapter since Telegram does not exist yet.
- [ ] A locator resolved from the path only.
- [ ] Slack interactivity payload (`team` nested) resolves; today it returns nothing.
- [ ] Normalised Slack declaration reports `max_chars == 3000`.

## Done when

- [ ] `grep -rn "installation_hint"` returns nothing.
- [ ] No adapter signature differs from the interface's.
- [ ] `F49`, `F48` and the open half of `F45` are closed in `review-findings.md`,
      with the verification recorded rather than the intent.

## Watch for

- **The mock adapter is the canary.** It has no real credential, so an interface
  change that quietly makes non-participation possible shows up there first — that
  is exactly how the defaulted `installation_hint` slipped through.
- **Do not fix `F50`/`F28` here.** The vestigial locators are CU-A's, and mixing
  them into an interface change makes the checkpoint conversation about two things.
