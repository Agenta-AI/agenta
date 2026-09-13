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
| `cleanups.md` | The twelve things that become possible only once the gateways run. Never a prerequisite. |
| `qa.md` | The manual dashboard procedure. The complement to the automated matrix, and the only check that exercises the product path. |
| `workstreams/specs-wpN.md` and `workstreams/tasks-wpN.md` | One pair per work package: the target, and the ordered checklist. `workstreams/README.md` holds the file-ownership table and the parallel-work rules. |

The remaining documents are the design itself: `decisions.md`, `architecture.md`, `entities.md`,
`secrets.md`, `policy.md`, `contract.md`, `mcp.md`, `models.md`, `mocks.md`, `libraries.md`,
`notes.md`, `out-of-scope.md`, and `raw/` for the research they grew out of.

## Current state

**The branch is not mergeable as of 2026-09-13.** A security review of the credential boundary
found thirty-three defects that every green suite ran straight past, and closing one of them turned
up a thirty-fourth, OR69. Seventeen are now fixed and closed: request headers travel by allowlist
rather than pass-through, so the caller's session no longer reaches a tenant's upstream (OR36,
OR37); a response echoing the injected key is refused (OR39); every credential field is redacted
rather than the first per kind (OR43); the migration declares the secret kind the OAuth code writes
(OR46); three ways a request escaped its endpoint's limits are shut (OR44, OR50, OR60); a mock
endpoint is callable only while the mock flag is on (OR57); every outbound call resolves, checks and
pins its address through one shared module that enforces by default (OR40, OR64); the sandbox holds
a gateway-audience credential the vault rejects (OR38); the OAuth state is an opaque single-use
handle over a server-side attempt record, which is also what made the callback's middleware
exemption safe (OR41, OR47); discovery pins the authorization server and both its endpoints to the
server the tenant registered (OR42); an expired grant is refreshed before use (OR55); and Postgres
arbitrates the registration write instead of a read-modify-write race (OR61).

**Seventeen remain open, and OR69 is the largest.** The Daytona runner writes the user's real
provider keys and a granted platform credential into the sandbox's environment at creation, which
reaches by a different road the secret OR38 just took away from the agent's credential. Nothing
waits on a decision any more: OD24 to OD27 in `open-designs.md` are all decided, OD26, OD24 and
OD27 have landed, and OD25 is being built now. The open set is OR45, OR48, OR49, OR51 to OR54,
OR56, OR58, OR59, OR62, OR63, OR65, OR66, OR67, OR68 and OR69. Read `open-reviews.md`
before planning work here. Green suites are not evidence on this branch, and `OR65` says why.

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
- **Fixed and closed, 2026-09-13.** Seventeen of the thirty-four: **OR36** and **OR37** (headers
  travel by allowlist, and the injected credential replaces the caller's in any casing),
  **OR39** (a response echoing the injected key is refused), **OR43** (every credential field is
  redacted), **OR44**, **OR50** and **OR60** (the three escapes from an endpoint's limits),
  **OR46** (the missing secret-kind enum value), **OR57** (mocks gated on their flag), **OR40**
  and **OR64** (one shared egress module resolves, checks and pins every outbound call, and it
  enforces by default), **OR38** (the sandbox holds a gateway-audience credential with no
  grants, which the vault routes refuse), **OR41** and **OR47** (the state is an opaque
  single-use handle over a server-side attempt record, and the callback's middleware exemption
  rests on that record), **OR42** (discovery is pinned to the registered server, at the cost of
  split-origin authorization servers), **OR55** (an expired grant is refreshed before use) and
  **OR61** (Postgres arbitrates the registration write).
- **Open.** Seventeen findings: **OR45**, **OR48**, **OR49**, **OR51** to **OR54**, **OR56**,
  **OR58**, **OR59**, **OR62**, **OR63**, **OR65** to **OR69**.
  Two are P0, blocking on security (OR45 and OR69); five are debt (OR63,
  OR65 to OR68); the remaining ten are correctness repairs. None waits on a decision.

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
**The seam between them is not built.** Nothing in this branch records usage, and `plan.md` says
why — WP11 and WP22 ship together with the pricing model, deliberately after the three waves,
because no real traffic passes before C3 and so nothing can be lost by waiting. The wallets side
states its expectations of that seam in `docs/design/wallets-research/v1/seams.md`; read it before
changing anything on the gateway's metering surface, and read it on the wallets branch, since it
does not exist on this one.

## Next steps

The blocking set comes first, and nothing in it waits on a decision.

**OR69, before anything else.** It is the only open finding that puts the user's real provider key
somewhere a caller can read it, and it does so outside the gateway entirely. OR38 shut the road
through the agent's credential; this is the other road. The gateway's guarantee cannot be stated
without qualification while it is open. Whoever takes it has to say which credential the OTLP export
gets in place of the run's granted one.

**Then OR45**, the one P0 left beside it. It puts a permission check on the credential issuer, so a
caller stops choosing its own narrowing.

**Then the correctness repairs and the debt**, in `open-reviews.md` order. Each entry states the
closure that would settle it and the test that would prove it.

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
