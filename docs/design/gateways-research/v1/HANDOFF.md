# Handoff

This is the entry point for anyone picking up the gateways work without context. Read it first,
then the reading order in `README.md`.

## What the branch is

`feat/add-gateways` (PR #6049) implements the design in this folder: one policy core with two
protocol surfaces, an LLM gateway and an MCP gateway, through which every outbound model call and
every outbound tool call is meant to travel. It carries the domain and storage layers, the shared
policy plane, both data-plane proxies, endpoint CRUD, the MCP OAuth client and consent flow, the
development-only mock provider topology, the SDK and runner changes that route a managed agent run
through the gateway, and the acceptance matrix that proves the mock routes. It was rebased and
squashed onto `main` on 2026-09-12, so it is now a single commit rather than the work-package
series `plan.md` describes.

## The tracking files

| File | What it is for |
| --- | --- |
| `README.md` | The posture, the reading order, and what is in and out of scope. |
| `plan.md` | The work packages, their dependencies, the three checkpoints, the rebase record, and Wave 4. |
| `implementation-status.md` | What is built per namespace, and the verified state as of 2026-09-12. |
| `open-reviews.md` | Active review findings and the closed record. The live backlog. |
| `open-designs.md` | The historical design-finding record. **Not** a backlog; every entry is resolved or won't-fix. |
| `scope-checklist.md` | Every capability either gateway could have, marked with the wave it lands in. |
| `cleanups.md` | Two registers under one roof. CU1 to CU14 are the twelve things that become possible only once the gateways run, never a prerequisite. CU15 to CU19 are the debt in the gateway code itself, and they are the same five findings as OR63 and OR65 to OR68 in `open-reviews.md`. |
| `qa.md` | The manual dashboard procedure. The complement to the automated matrix, and the only check that exercises the product path. |
| `workstreams/specs-wpN.md` and `workstreams/tasks-wpN.md` | One pair per work package: the target, and the ordered checklist. `workstreams/README.md` holds the file-ownership table and the parallel-work rules. |

The remaining documents are the design itself: `decisions.md`, `architecture.md`, `entities.md`,
`secrets.md`, `policy.md`, `contract.md`, `mcp.md`, `models.md`, `mocks.md`, `libraries.md`,
`notes.md`, `out-of-scope.md`, and `raw/` for the research they grew out of.

## Current state

**The branch is not mergeable as of 2026-09-15.** A security review of the credential boundary
recorded forty-one findings that every green suite ran straight past, OR36 to OR76. Six of them came
out of reviewing the repairs rather than the original code (OR70 to OR75), and OR76 came out of
closing OR49. OR77 came later and from a different direction: it is a product-reach gap on the
playground surface rather than a credential-boundary defect. The record therefore runs OR36 to
OR77, forty-two findings. One of them, OR69, was withdrawn, so forty-one stand. Thirty-five are now
fixed and closed: the agent config's MCP server form can choose OAuth and authorize in place, so
the playground can express an OAuth server (OR77); request headers travel by
allowlist, so the caller's session no longer reaches a tenant's upstream (OR36, OR37); a response
echoing the injected key is refused, in the body and in the header block (OR39, OR70), and a
credential split across two streamed chunks is withheld rather than relayed and regretted (OR71);
every credential field is redacted rather than the first per kind (OR43), and `extras` stop
travelling as authentication headers, which is what let a write-only entry both authenticate and be
read back in plaintext (OR72); the migration declares the secret kind the OAuth code writes (OR46);
three ways a request escaped its endpoint's limits are shut (OR44, OR50, OR60); a mock endpoint is
callable only while the mock flag is on (OR57); every outbound call resolves, checks and pins its
address through one shared module that enforces by default (OR40, OR64), the Vertex credential
document is checked against that module before google-auth reads it (OR73), and pinned connections
are pooled per original origin so two hostnames on one address no longer share a TLS connection
(OR74); the sandbox holds a gateway-audience credential the vault rejects (OR38); the builtin Agenta
credential issuer checks the permission its credential is spent under and bounds the tool list it
signs (OR45); the OAuth state is an opaque single-use handle over a server-side attempt record,
which is also what made the callback's middleware exemption safe (OR41, OR47); discovery fetches the
authorization server's metadata from the issuer itself rather than from the MCP server (OR42); an
expired grant is refreshed before use (OR55); and Postgres arbitrates the registration write instead
of a read-modify-write race (OR61). Eleven more closed on 2026-09-14: the MCP relays scan for the
credential they injected (OR75); an API-key MCP endpoint binds its secret and sends it in the header
the endpoint registered (OR54); a brokered builtin endpoint carries an explicit tool allowlist
(OR58); every component performs MCP discovery with `initialize` (OR56); tool registration tracks
its own names so a warm session's second turn keeps its tools (OR59); streaming cleanup is shielded,
so an aborted stream still meters and still closes its upstream (OR48); a streamed call records
usage on every route that reports it (OR49); a secret save writes only the fields the secret owns
(OR51); the registrar carries the region and the Vertex project (OR52); a standard connection
resolves by its slug (OR53); and endpoint writes refuse a secret the project does not own (OR62).

**Six remain open, and none is a P0 or a P1.** OR45 was the last P0 and OR75 the last P1, and both
are closed. The highest severity open is P2, carried by OR76 alone: an OpenAI Chat Completions
stream records no usage unless the caller itself sent `stream_options.include_usage`, while
Responses and Messages meter on every call. Nothing prices usage yet, so it is a gap the metering
work must settle rather than a defect with a consequence today, and the trade recorded under OR49
says why adding the field was tried and backed out. The other five are debt: OR63 and OR65 to OR68,
which `cleanups.md` also tracks as CU15 to CU19. Nothing waits on a decision any more: OD24 to OD27
in `open-designs.md` are all decided and all four have landed. The open set is OR63, OR65 to OR68,
and OR76. Read `open-reviews.md` before planning work here. Green suites are not evidence on this
branch, and `OR65` says why.

**OR69 was recorded and then withdrawn on 2026-09-13**, after the file it cited,
`sdks/python/agenta/sdk/engines/running/runners/daytona.py`, turned out to be the custom-code
evaluator's sandbox rather than the agent runner. Its entry stays at the top of the active section in
`open-reviews.md`, with the three checks that settle it.

**The dashboard product path works end to end as of 2026-09-13**: a
provider created in the dashboard registers its gateway endpoint, and Pi and Claude Code each
complete both a gateway LLM turn and a gateway MCP tool call, with no API call standing in for any
step.

- **Green.** API gateway acceptance, the mock matrix, API gateway integration, SDK MCP-routing
  acceptance, services gateway-tool integration, and runner gateway-credential acceptance. The
  per-suite counts are in `implementation-status.md`.
- **Green since.** The services acceptance suite `test_agent_gateway_route.py` passes all 27
  cells, the nine Claude ones included. They failed because the mock MCP server never answered
  `initialize`, so no spec-compliant client could finish a handshake against it. This was OR23.
- **Wave 4 closed, 2026-09-13.** **OR26**: the vault registers and deregisters the LLM endpoint
  alongside the `custom_provider` secret. It closed server-side rather than in the browser because
  the endpoint is keyed on a slug the vault derives and the payload builder does not know, and
  because the SDK, direct API callers and the test fixtures write that secret without passing
  through any frontend. **OR31a**: the provider form declares its protocol (`openai` or
  `anthropic`), which becomes the endpoint's `provider_key`, and the harness control filters on it.
  **OR31b**: Pi declares the `mcp.user_servers` capability, so the panel renders the `MCP servers`
  row; the gate was always a capability rather than a frontend harness list. **OR31c**:
  `Add MCP server` registers the custom MCP endpoint that carries its URL and writes the derived
  slug back onto the config item.
- **Reclassified, not closed. OR31d — Codex on a custom endpoint.** The refusal is not a Codex
  limitation. The runner holds no model list; the `Allowed values` text comes from the
  `sandbox-agent` client's pre-check against the options `codex-acp` advertised, and `codex-acp`
  accepts an unknown model id declared in `$CODEX_HOME/config.toml` and then advertises it as the
  session's first option. The repair is one scalar in
  `sdks/python/agenta/sdk/agents/adapters/codex_settings.py` plus one branch in
  `services/runner/src/engines/sandbox_agent/environment.ts`. **It is runner and SDK work, owned
  elsewhere, and no turn has been run against it.** The entry's proposed remedy, withholding Codex
  from custom endpoints, does not follow: Codex's custom-surface family is `openai`, so the OR31a
  filter already offers it on an OpenAI-compatible endpoint and withholds it from an Anthropic one.
- **Closed since.** **OR23** (the mock MCP server answers the `initialize` handshake, which is
  what the nine Claude cells were failing on, and both mock tiers now emit one error envelope),
  **OR27** (the resolve route refuses with the shared
  `{code, message, retryable, next_step, details}` envelope and the SDK resolver carries it, so a
  refusal reaches the user as a 422 with a code and a sentence), **OR28** (every harness preserves
  the refusal envelope, and a refusal a harness folded into its answer fails the run), **OR29** (the
  edit path round-trips `provider_key`; the measured mechanism was that it could not set the field,
  not that it destroyed one, and the closed record says so), **OR30** (both untyped resolve failures
  are typed 422s) and **OR32** (a failed MCP handshake rides a non-fatal `mcp_server_failed`
  notice instead of vanishing).
- **Closed since, and neither was ours.** The two defects found in passing during the 2026-09-13 QA
  both turned out to sit outside this branch. **OR34** (the AI providers drawer closing itself) is a
  development-deployment artefact: the mobile app's hot-reload websocket fails its handshake through
  Traefik and the development client reloads the whole page every 50 to 60 seconds, taking every open
  form with it. **OR35** (no create control on the API keys page) reproduces on `main` and is tracked
  as issue #6803.
- **Fixed and closed, 2026-09-13.** Twenty-three of the forty-one that stand: **OR36** and
  **OR37** (headers travel by allowlist, and the injected credential replaces the caller's in any
  casing), **OR39** and **OR70** (a response echoing the injected key is refused, on the body and
  on the header block), **OR71** (a credential split across streamed chunks is withheld until it
  cannot complete), **OR43** (every credential field is redacted) and **OR72** (`extras` no longer
  travel as authentication headers, so nothing authenticates with a value the projection returns),
  **OR44**, **OR50** and **OR60** (the three escapes from an endpoint's limits), **OR46** (the
  missing secret-kind enum value), **OR57** (mocks gated on their flag), **OR40** and **OR64** (one
  shared egress module resolves, checks and pins every outbound call, and it enforces by default),
  **OR73** (the Vertex credential document is checked against that module before google-auth reads
  it) and **OR74** (clients are pooled per original origin, so a pinned connection is not shared
  across hostnames), **OR38** (the sandbox holds a gateway-audience credential with no
  grants, which the vault routes refuse), **OR45** (the builtin Agenta credential issuer checks the
  permission its credential is spent under, and bounds the tool list it signs), **OR41** and
  **OR47** (the state is an opaque single-use handle over a server-side attempt record, and the
  callback's middleware exemption rests on that record), **OR42** (discovery reads the authorization
  server's metadata from the issuer's own well-known URL, which is what lets its endpoints be
  accepted on any origin), **OR55** (an expired grant is refreshed before use) and
  **OR61** (Postgres arbitrates the registration write).
- **Fixed and closed, 2026-09-14.** Eleven more: **OR75** (all three MCP relays scan the response
  header block and the buffered body for the credential they injected, and an MCP credential header
  is endpoint-named rather than fixed, so each header is normalized and scanned one at a time),
  **OR54** (the key travels in the header the endpoint registered, verbatim and with no scheme
  prefix, which is what the SDK sends when it dials the same server without a gateway), **OR58** (a
  brokered builtin endpoint is built with an explicit list from the connection; nothing writes that
  list yet, so brokered calls refuse everything until the connect flow records the grant),
  **OR56** (the lifecycle is `initialize`, the `initialized` notification, `tools/list`, then
  `tools/call`, and `initialize` is the only method every server must answer), **OR59** (tool
  ownership is tracked per harness instance, so re-registering our own is a no-op and a real
  collision is surfaced rather than swallowed), **OR48** (a shared helper runs each streaming
  cleanup detached and shielded at all four sites), **OR49** (the drain reads forward and merges
  usage field by field, and the audit record carries the counts; one route still reports nothing,
  which is OR76), **OR51** (the secret save names both halves, so flags, the denylist, settings,
  route headers, tags and meta are carried from the stored row), **OR52** (region and the Vertex
  project carry through, and only a region-only Bedrock configuration was ever broken), **OR53** (a
  standard connection is addressable as `standard/<connection slug>`, with the provider family tried
  first) and **OR62** (a check in the persistence layer, called from the four DAO write methods
  where all six write paths funnel, refuses a secret the project does not own).
- **Fixed and closed, 2026-09-15.** One more, and a P2 product-reach gap rather than a credential
  defect: **OR77** (the agent config's MCP server form offered OAuth as a disabled option behind a
  `Soon` badge, so only the settings drawer could register an OAuth server and the playground could
  not express one; OAuth is selectable there now and the row authorizes in place through the same
  flow the settings page runs). The constraint the fix rests on is worth carrying forward: OAuth is
  a registration choice, not a stored credential. The SDK's `MCPCredentials` union accepts only
  `none` and `header_secret_refs` under `extra="forbid"`, so a config carrying
  `credentials.type: "oauth"` would fail validation on every run of that agent. Registration sends
  `auth_mode: "oauth"`, the commit normalizes credentials back to `none`, and the form reads the
  OAuth state off the endpoint row. The connect flow moved out of the app layer into
  `@agenta/entities` and `@agenta/entity-ui`, because the settings dashboard, the agent chat's
  connect widget and this form all drive it.
- **Open.** Six findings: **OR63**, **OR65** to **OR68**, and **OR76**. No P0 and no P1 remain. One
  is P2 (OR76); the other five are debt (OR63, OR65 to OR68), and `cleanups.md` tracks the same five
  as **CU15** to **CU19**, with a **Why it is still open** field on each. None waits on a decision.
- **Withdrawn.** **OR69**, on 2026-09-13. It counts as neither open nor closed.

## The live evidence, 2026-09-13

Measured on the deployed stack (compose project `agenta-ee-dev-gateways`, EE, development mode),
from the dashboard, in a disposable project, through an isolated browser. The per-harness table is
in `implementation-status.md`.

- Saving a provider registers one endpoint row, read back at
  `POST /gateways/llms/endpoints/query`, with a slug matching the secret, a `provider_key` following
  the declared protocol, and an allowlist carrying both the bare model slug and Agenta's qualified
  `<provider slug>/<kind>/<model slug>` key.
- Editing a provider's protocol updates that row in place, same id and slug, with no duplicate.
  Deleting the provider removes the row.
- The `Harnesses` control disables Claude Code with "Incompatible with this provider" on an
  OpenAI-compatible endpoint and enables it on an Anthropic one. Pi and Codex are the reverse.
- Pi completes a turn through `POST /gateways/llms/custom/<slug>/v1/chat/completions`, `200`.
  Claude Code completes a turn through `POST /gateways/llms/custom/<slug>/v1/messages?beta=true`,
  `200`.
- On the MCP leg, for both Pi and Claude Code, the `tools/call` reaches the mock and the assistant
  turn ends with the mock's round-trip confirmation, `mock MCP echo: <marker>`.

Two preconditions make the MCP cells pass, and `qa.md` step 4 now names them. The prompt must carry
an acceptance marker matching `MCP-ACCEPTANCE-[A-Za-z0-9_-]+`, which `_mcp_marker` in the mock
adapter reads. On the Anthropic Messages path the server must be named `mock-mcp`, because
`_default_mcp_echo_tool` returns the hardcoded tool name `mcp__mock-mcp__echo` for that protocol.
Without them the cell looks like a product failure when it is not.

## How to deploy and test

Run this branch as its own stack. Sharing a stack with other work does not survive a `--build`,
because the shared `agenta-ee-dev-*:latest` tags are what every other stack recreates from.

1. **Its own env file, with its own ports.** Copy the EE development source
   (`hosting/docker-compose/ee/env.ee.dev.example`, or an existing `.env.ee.dev`) to
   `.env.ee.dev.<name>` and change `COMPOSE_PROJECT_NAME`, `TRAEFIK_PORT`, `TRAEFIK_UI_PORT`,
   `POSTGRES_PORT`, the Redis ports, and `AGENTA_WEB_URL` and `AGENTA_API_URL` to match the new
   Traefik port. Env files hold secrets; they are gitignored and stay that way.

2. **Its own image tags.** Write a gitignored
   `hosting/docker-compose/ee/docker-compose.dev.<name>.local.yml` that overrides `image:` for
   every service built from this tree — `api` and the four services that share its image
   (`worker-queues`, `worker-streams`, `cron`, `alembic`), the two mock gateway services, `web`
   and `web-mobile`, `services`, and `runner`, plus the `.api`/`.web`/`.services`/`.runner` build
   anchors. `run.sh` auto-includes `docker-compose.<stage>.*.local.yml` from the edition
   directory, so it needs no flag. The same file is where harness subscription mounts for the QA
   procedure belong.

3. **The two flags.** Set `AGENTA_GATEWAYS_MOCKS_ENABLED=true` and, on a plain-HTTP deployment,
   `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED=true` in the env file. The compose files hardcode the
   first on `api` and the mock services only, and declare the second on `runner` only; the
   `services` container runs the SDK resolver and needs the second too, and the env file is what
   reaches every service.

4. **Host permissions, before the first build.** `chmod o+w web/*/public` and
   `chmod -R o+w web/packages`, or the web containers crash-loop in their entrypoint and pnpm
   fails with `EACCES`.

5. **Deploy.**

   ```bash
   bash hosting/docker-compose/run.sh --ee --dev --env-file .env.ee.dev.<name> --build
   ```

6. **Test.** `--logs` is not optional: without it `test.sh`'s `prepare_log` returns 1 under
   `set -e` and the run aborts after the install step with no test output.

   ```bash
   bash hosting/docker-compose/test.sh --ee --dev --env-file .env.ee.dev.<name> \
     --logs=<file> --api -a --all -- oss/tests/pytest/acceptance/gateways/
   ```

   The other suites follow the same shape with `--api -i`, `--sdk -a`, `--services -a`,
   `--services -i` and `--runner -a`. `implementation-status.md` names the target of each.

7. **Manual QA.** Follow `qa.md`. Provider creation registers the endpoint on its own; the API call
   in step 2 is a fallback for a stack that predates that change. Step 4 names the two preconditions
   the MCP cells need.

## Relationship to PR #6050

PR #6050 is the wallets work, and it stacks on top of this one: metering and billing are among the
six concerns the gateway owns (D12), and the wallet is what prices what the gateway meters.
**The seam between them is not built.** The gateway records usage on its audit record since OR49
closed, and nothing prices it. One route still records nothing, which is OR76. `plan.md` says why
the pricing half waits: WP11 and WP22 ship together with the pricing model, deliberately after the
three waves, because no real traffic passes before C3 and so nothing can be lost by waiting. The wallets side
states its expectations of that seam in `docs/design/wallets-research/v1/seams.md`; read it before
changing anything on the gateway's metering surface, and read it on the wallets branch, since it
does not exist on this one.

## Next steps

The correctness repairs are done. What is left is one residual and five pieces of debt, and nothing
in the set waits on a decision.

**OR58's residual, before the brokered MCP route ships.** Brokered builtin endpoints now carry an
explicit tool allowlist and nothing writes it, so a brokered call refuses every tool. That is safe
only while the route has no live caller, and gateway connections resolve through the tools route
instead. The connect flow must record the grant before that changes.

**OR76, with the metering work rather than before it.** An OpenAI Chat Completions stream records no
usage unless the caller asked for it. Read the trade under OR49 first: adding
`stream_options.include_usage` was tried and backed out, because it breaks byte-preserving relay on
that path, re-chunks the response, and risks a `400` from upstreams that reject unknown fields.

**Then the debt**, OR63 and OR65 to OR68, in `open-reviews.md` order. Each entry states the closure
that would settle it and the test that would prove it, and `cleanups.md` carries the same five as
CU15 to CU19 with the reason each is still open.

**Then re-prove it.** OR65 is the reason the suites stayed green through all of this. A fix set that
lands without the end-to-end path it names leaves the branch in the same position: green, and
unproven at the boundary that matters.

Wave 4 is done. What remains from it is OR31d, which is not dashboard work: the SDK's Codex settings
writer must pin the resolved model id in `$CODEX_HOME/config.toml` for a gateway-routed run, and the
runner must stop setting the model that is already the session default. Whoever takes it should run
a turn first, because the mechanism is read off the pinned `codex-acp` bundle and has never been
measured.

OR34 and OR35 are closed and need nothing from this branch. OR34 leaves a hosting follow-up: proxy
the mobile hot-reload websocket in the development compose and Traefik configuration, so a
development stack stops reloading itself and discarding open forms. OR35 is tracked as issue #6803.

Everything else is "After C3" in `plan.md`: usage recording and the wallet that prices it (WP11 and
WP22, which ship together), and per-endpoint configuration (WP21).
