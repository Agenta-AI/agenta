# WP26 — tasks

Read [`specs-wp26.md`](specs-wp26.md) first. Branch from `feat/gateways-c2`.

## Phase 1 — widen the tool contract

- [ ] `static_catalog.py`'s `_client_tool_revision()`: add the `target` object
      (`plane: "llm"|"mcp"`, `name`) to `input_schema.properties`; drop `required` from
      `["integration"]` to `[]`; update the tool and workflow descriptions to name both
      paths and the "exactly one of" rule.
- [ ] Keep `integration`, `slug`, `mode` byte-identical in shape — only their descriptions
      gain a one-line note about being ignored for a gateway target.
- [ ] Unit: the widened schema still coerces through `coerce_tool_config` to a
      `ClientToolConfig` (mirrors the existing embed-resolution test), for both an
      `integration`-only call and a `target`-only call.
- [ ] Unit: schema shape assertions — `target.required == ["plane", "name"]`,
      `target.properties.plane.enum == ["llm", "mcp"]`, top-level `required == []`.

## Phase 2 — the browser widget's gateway path

- [ ] Add `useGatewayConnectFlow` (new file, sibling to `useConnectFlow.ts`): reads
      `meta.input.target`, exposes the same shape of surface (`phase`, `outcome`, `runConnect`
      equivalents) `ConnectToolWidget` already consumes from `useConnectFlow`, but backed by
      `ProviderDrawer` (llm) or the shared `toolCatalogDrawerOpenAtom` (mcp) instead of the
      OAuth popup machinery.
- [ ] `ConnectToolWidget`: branch at the top on `input.target` presence — gateway path routes
      through the new hook; existing branch is otherwise unchanged (no behavior change for
      `integration` calls).
- [ ] LLM settle: `ProviderDrawer.onSaved` → `{connected: true, target}`; close without save →
      `{connected: false, reason: "cancelled"}`.
- [ ] MCP settle: catalog-drawer open→close transition → `{connected: true, target}}` — see
      spec's "Settle semantics" for why this is optimistic-but-safe.
- [ ] "Not now" settles `{connected: false, reason: "declined"}` before anything opens, both
      planes — same as the existing integration path.
- [ ] Unit (vitest, no real backend, no real drawer render): the pure classification helper
      (`target` present → gateway path; `integration` present → existing path; neither →
      the existing malformed-call handling) and the settle-output shape builders, mirroring
      `useConnectFlow.test.ts`'s style (pure functions extracted and tested directly, not
      through full component render).

## Phase 3 — wire-through check

- [ ] Confirm no other layer hard-requires `integration` on this tool's input: runner
      (`services/runner/src/tools/*`, `protocol.ts`) treats client-tool `input` as opaque
      passthrough — verify by grep, no code change expected there.
- [ ] `ruff format` && `ruff check --fix` (api); `pnpm lint-fix` (web) if touched files need it.
- [ ] Commit: "gateways(workflows): request_connection also asks for a gateway target".

## Definition of done

- An `integration`-only `request_connection` call behaves exactly as before wave 3 (existing
  tests green, unchanged).
- A `target`-only call pauses the same way, and the widget opens the LLM or MCP plane's
  existing registration surface based on `target.plane`.
- The parked call settles on save (llm) or drawer-close (mcp), and the run resumes.
- Neither `integration` nor `target` is required by the schema in isolation; a call with
  neither is handled the same way a malformed call always was (no crash, no unhandled
  branch).
