# Gateway live-web QA

> **MCP release scope update (2026-09-15):** Read [confirmed decisions](release-decisions-2026-09-15.md) and the [release-ready handoff](MCP-RELEASE-HANDOFF.md) first. They govern current scope and the target connection UX where this baseline differs. Existing code-review findings remain independent and must be resolved or explicitly dispositioned; no implementation or QA is implied by a product decision.

This is the manual complement to the mock acceptance matrix. It proves that a real managed-agent
run launched through the dashboard reaches the gateway and that each installed harness exposes a
typed gateway failure to the user. Do not replace this check with direct `curl`, a fixture, or an
API-only request: those prove the proxy, not the product path.

## Preconditions

1. In a fresh worktree, create the EE development environment and start it:

   ```bash
   bash hosting/docker-compose/env.sh --ee --dev
   bash hosting/docker-compose/run.sh --ee --dev --build --nuke
   ```

   Set `AGENTA_GATEWAYS_MOCKS_ENABLED=true` in the env file before starting, or the mock
   catalogue and the mock routes do not exist. On a deployment served over plain HTTP, also set
   `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED=true`: the SDK in the `services` container and the
   runner both read it, and without it every gateway resolution is refused (OR24). Setting both in
   the env file reaches every service, which the compose files alone do not.

2. Read `AGENTA_WEB_URL` from `hosting/docker-compose/ee/.env.ee.dev` and open it in a browser.
   Sign in to the local development deployment and create a disposable project named
   `gateway-harness-qa-<date>`.

3. First establish the automated baseline. It must pass before manual QA begins:

   ```bash
   bash hosting/docker-compose/test.sh --ee --dev --api -a -- \
     oss/tests/pytest/acceptance/gateways/test_gateway_mock_matrix_acceptance.py
   ```

   This proves the seven mock-backed rows: LLM builtin `agenta`, LLM builtin `mock`, LLM standard
   `mock`, LLM custom mock; MCP builtin `mock`, MCP standard `mock`, and MCP custom mock.
   `builtin/agenta/run` is not a mock route: it requires an invocation-scoped credential and is
   verified through an agent/runner run with an existing Agenta callback tool.

4. To run the gateway **integration** suites from the host rather than inside the compose
   network, every backing service the suites touch has to be reachable by an address the host
   understands. The application defaults name compose hostnames, which is right for a container
   and unresolvable from outside it, so a host-side run needs all five of these:

   ```bash
   export POSTGRES_URI_CORE="postgresql+asyncpg://<user>:<password>@127.0.0.1:<pg-port>/agenta_ee_core"
   export REDIS_URI_VOLATILE="redis://127.0.0.1:<volatile-port>/0"
   export REDIS_URI_DURABLE="redis://127.0.0.1:<durable-port>/0"
   export AGENTA_MOCK_LLM_GATEWAY_URL="http://127.0.0.1:<mock-llm-port>"
   export AGENTA_MOCK_MCP_GATEWAY_URL="http://127.0.0.1:<mock-mcp-port>"
   export AGENTA_GATEWAYS_MOCKS_ENABLED=true
   export AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN=<the stack's token>
   ```

   Take each port from `docker ps` for the stack. Postgres and the two mock upstreams are
   published by the compose files; **Redis is not published by default** and a stack that wants
   host-side runs has to publish both instances in its local override, the way Postgres already
   is. Without the Redis addresses the symptom is misleading rather than obvious: the cache sits
   in front of the endpoint lookup, so every cache operation fails to resolve and a
   whole-directory run reports a different connection missing on each run while each file passes
   on its own. The mock addresses fail more plainly, as read timeouts.

   The two mock-upstream variables matter for more than `test_mock_upstreams.py`. The OAuth
   endpoint-write and recovery suites relay through the mock MCP server too, and they fail
   without it.

   One residual, unrelated to addressing. The mock upstreams are single-process, so under
   pytest's default `-n auto` the HTTP tests in `test_mock_upstreams.py` occasionally read-time
   out behind the deliberately slow `test_slow_model_hangs_past_a_short_client_timeout`. Add
   `-n0` for a deterministic result; the full directory passes serially every time.

## Dashboard procedure

Use the dashboard's managed-agent creation and run flow. For each harness available in the
deployment — **Pi**, **Claude Code**, and **Codex** — create an otherwise identical disposable
agent/run configuration:

1. Select that harness in the dashboard. Record its displayed version and login/connection state.
2. Give the agent a gateway LLM route. **Use the `custom` namespace, not a builtin route.** The
   builtin mock providers are generated in development only and production never lists them
   (`mocks.md`), so the dashboard is not meant to offer them: the model picker has no
   `builtin/mock` or `builtin/agenta` entry and `Add provider` offers the real providers plus
   `OpenAI-compatible endpoint`. Treat the builtin routes as the HTTP-level precondition proved in
   step 3 of the preconditions, and point a custom endpoint at the compose mock LLM service for
   this step. It still traverses browser → API → runner → harness → gateway, which is what this
   procedure is for.

   **Create one provider per protocol you intend to test.** A harness accepts or refuses the run on
   the endpoint's declared `provider_key`, which the provider form's protocol field sets: Claude
   Code needs `anthropic` and an Anthropic-protocol model, and refuses an `openai` endpoint with
   `422 provider 'openai' is not supported by harness 'claude'`. The `Harnesses` control disables
   the harnesses a declared protocol cannot serve, so an unrunnable pair is no longer offerable.
   Codex is offered on an OpenAI-compatible endpoint, but the model pin that lets it accept a
   gateway model key is runner and SDK work and has not shipped (OR31d), so record its refusal.

   Save a provider in Settings / AI providers with its protocol declared and the harnesses you
   intend to test enabled. That writes a `custom_provider` secret and registers the matching gateway
   endpoint under the same slug (OR26). Confirm it with
   `POST /api/gateways/llms/endpoints/query`, which must return one row per provider.

   If a stack predates that change, the endpoint can still be created by hand. Take the secret's id
   from `GET /api/vault/v1/secrets/`, then, from the signed-in dashboard so the request carries your
   session:

   ```js
   await fetch("/api/gateways/llms/endpoints/?project_id=<project-id>", {
     method: "POST",
     headers: {"Content-Type": "application/json"},
     body: JSON.stringify({
       endpoint: {
         slug: "gw-mock-llm-<suffix>",
         name: "gw-mock-llm",
         deployment_kind: "custom",
         secret_id: "<the custom_provider secret id>",
         flags: {is_active: true},
         data: {
           route: {base_url: "http://mock-llm-gateway:9091/v1"},
           models: {allowlist: ["mock/echo"]},
         },
       },
     }),
   });
   ```

   Set `provider_key` in the endpoint body to the protocol the harness needs. Editing the provider
   in the dashboard afterwards heals the row either way, because registration is an upsert on the
   slug.

   Then use a prompt that produces an unmistakable echo response, for example
   `Reply with exactly: gateway-live-qa`.

3. Run it from the dashboard. Record the run link/id and confirm the response is exactly the
   expected mock response. This proves the browser → API → runner → harness → gateway path.
4. Add an MCP server pointed at the mock MCP route — `<AGENTA_API_URL>/gateways/mcps/builtin/mock/mock`
   — and ask the agent to call its `echo` tool with a unique marker. There is no builtin MCP
   catalogue to select from: `Add MCP server` is a free-form name, URL and authentication form.

   **Three preconditions, or the cell fails for a reason that is not the product.**

   - The mock only echoes a prompt carrying an acceptance marker matching
     `MCP-ACCEPTANCE-[A-Za-z0-9_-]+`, which is what `_mcp_marker` in the mock adapter reads; a
     plain-English prompt gets no echo back.
   - On the ACP harnesses the server must be **named `mock-mcp`**, because
     `_default_mcp_echo_tool` returns a tool name built from that fixed server name — Claude's
     `mcp__mock-mcp__echo` on Messages, Codex's `mcp.mock-mcp.echo` on Responses — so a server
     under any other name exposes a tool the harness cannot call.
   - **Keep the marker to 16 characters or fewer** on any cell that answers an approval, for
     example `MCP-ACCEPTANCE-D`. A longer marker comes back truncated to its first 16 characters on
     the resumed turn, which makes the stored decision key (`toolName#args`) miss, so the gate is
     raised again instead of resolving and the cell reads as a broken resume. Measured on
     2026-09-15 across four runs; the truncation is in the fixture path, not in the approval
     machinery, and has not been traced further because a short marker costs nothing.

   The cell passes when the `tools/call` reaches the mock and the assistant turn ends with the
   mock's round-trip confirmation, `mock MCP echo: <marker>`. A server whose handshake fails now
   rides an `mcp_server_failed` notice rather than vanishing (OR32).

   **Read the transcript against the gateway's own request log, not against the reply.** Until
   2026-09-15 this row could go green with no `tools/call` at all: the round-trip check accepted
   any tool result in the body as the echo, so a harness that called a tool name it did not have
   still produced `mock MCP echo: <marker>`. That check now looks inside the tool result, so the
   failure is visible — but the habit is the safeguard. `docker logs <api container> | grep
   'gateways/mcps'` must show a POST to the MCP route AFTER the model call, and a rejected
   approval must show none.
5. Add an existing Agenta callback tool and the builtin Agenta MCP server. Confirm the tool list is
   scoped to the run and that the selected callback can be invoked.
6. Induce a **typed gateway refusal** using the dashboard-supported configuration — preferably a
   missing/disabled endpoint or an endpoint for which the selected project lacks permission. Do
   not use an arbitrary upstream failure: that is intentionally forwarded as `upstream_error`.
7. In the run transcript and any visible interaction UI, record whether the failure exposes:
   `code`, human message, `retryable`, `next_step`, and `details`. Capture a screenshot and the
   run link/id. Redact credentials and cookies.

## Harness acceptance table

| Harness | Happy LLM | Happy MCP | Typed refusal surfaced | Required evidence |
| --- | --- | --- | --- | --- |
| Pi | echo response, on a custom endpoint of either protocol | echo tool result | record all visible fields | run link/id + screenshot |
| Claude Code | echo response, on a custom endpoint declaring `anthropic` | echo tool result | record all visible fields | run link/id + screenshot |
| Codex | no pass is available yet: it refuses a model id nobody declared to it, and the config pin that fixes this is runner and SDK work (OR31d). Record the refusal. | echo tool result | record all visible fields | run link/id + screenshot |

The required invariant is that every harness preserves the human message and the machine-readable
gateway `code`. Pi or Claude Code may preserve the complete error envelope. Codex is expected to
preserve only `message` plus the embedded code marker, so absent `retryable`, `next_step`, and
`details` is acceptable only if the code reaches the UI and the UI offers the generic recovery
path.

## Connection identity

Verified on 2026-09-15 against the EE development deployment at commit `1762cc19fc`, which the
deployment's API container serves with reload. Driven through the API as a browser drives it: a
disposable account, a real SuperTokens session, the mock issuer's own authorize and token
endpoints, the real callback, and a real `tools/call` through the relay. The vault's non-secret
columns were read directly from Postgres to see which rows exist and under which slugs. No secret
values were read or recorded. Everything created was deleted afterwards.

Two adjustments are needed to drive this deployment from the host, and any later script needs them
too. The session cookie SuperTokens sets is scoped to the deployment's public address, so it must
be re-pinned to the address the script dials. And the callback URL the deployment mints names that
same public address, so the script dials the equivalent path on the direct address instead.

| # | Check | Result |
| --- | --- | --- |
| 1 | A create sending no slug is given one, and it comes back in the response | `name: "Acme, derived name"` returned `slug: "acme-derived-name-ac9527953c85"` |
| 2 | Two connections can be created at one server URL in one project | both created, same `base_url` |
| 3 | Two consents at that URL write two grants, not one | two distinct `secret_id` values, two vault rows |
| 4 | Each grant row is addressed by its own connection | slugs were `oauth-grant-<last twelve hex of each endpoint id>`, one per connection, each referenced by exactly one endpoint |
| 5 | Both connections relay | `200` each, each echoing its own text |
| 6 | Disconnect returns `200` and the endpoint survives | id, slug and name all unchanged |
| 7 | The disconnect body omits `secret_id` rather than sending null | the key is absent from the JSON entirely |
| 8 | Disconnecting one leaves the other working | only the other connection's grant row remained; it relayed `200` |
| 9 | The disconnected connection refuses | `409`, code `secret_missing` |
| 10 | Reconnecting lands on the same connection | same id and slug, a new grant row under the same connection-derived slug |
| 11 | Deleting a connection takes its grant with it | the row was gone; deleting the second left the project with none |

Row 7 is the one the web cache write depends on. The response model excludes nulls, so a cleared
handle arrives as an absent key. Derived connection state already reads a missing `secret_id` as
needing authorization, so nothing downstream has to change.

Row 9 records behaviour rather than endorsing it. A disconnected OAuth connection refuses a relayed
call with `secret_missing` and no reconnect affordance, which is exactly what a never-connected one
has always done — `_resolve_auth` raises `SecretNotFoundError` when an OAuth endpoint holds no
handle, and only a failed *renewal* raises the `needs_auth` affordance with a connect action. The
settings list is unaffected, because its state is derived from the endpoint row. An agent that hits
this mid-run gets no connect action to offer. Pre-existing and not introduced by the disconnect
work; raise it as a finding if the agent path is meant to offer reconnect.

### The migration, run against the deployment's own rows

Applied on 2026-09-15, after the checks above. `alembic_version_oss` now reads
`oss000000032`.

How to apply it, because the obvious way does not work. The API container does **not** run
migrations: its command is plain `uvicorn`, and it reaches a migrated database only through a
`depends_on` on a one-shot `alembic` service with `condition: service_completed_successfully`.
`run.sh --recreate api` runs `up -d --no-deps`, which skips exactly that dependency, so recreating
the API leaves the schema where it was. Recreate the one-shot service instead, which runs the
migration and exits:

```bash
COMPOSE_PROJECT_NAME=agenta-ee-dev-gateways bash hosting/docker-compose/run.sh \
  --ee --dev --env-file .env.ee.dev.gateways --recreate alembic
```

The `COMPOSE_PROJECT_NAME` prefix is not optional from a worktree. Without it Compose derives the
project from the directory name and builds a second stack beside the running one instead of acting
on it.

It exited `0` and reported what it did:

```
Running upgrade oss000000031 -> oss000000032, Move stored MCP OAuth grants onto the connection-derived key.
[oss000000032] rekeyed 3 MCP OAuth grant(s) onto their connection; cleared 6 handle(s) that shared 1 ambiguous grant(s), which now need a reconnect.
```

Three and six are the counts measured before the revision was written, so the deployment held no
case the revision had not been designed against.

| Connection | Server | Before | After |
| --- | --- | --- | --- |
| `linear` | `mcp.linear.app` | connected, grant slugged from the URL | connected, grant slugged from the connection, **no reconnect** |
| `ad` | `mcp.axiom.co` | connected, grant slugged from the URL | connected, grant slugged from the connection, **no reconnect** |
| `oauth-live-1bebe702` | mock | connected, sole owner of its row | connected, re-slugged, **no reconnect** |
| `mock-mcp`, `qa-desktop-oauth`, `qa-mobile-oauth`, `qa-phone-d`, `qa-phone-e`, `qa-phone-f` | mock | six connections sharing one grant row | handle cleared on all six, row deleted, each needs authorization |

The two real-provider connections are the ones that mattered: both migrated silently, keeping the
account they were connected to. Each rekeyed row is addressed by
`oauth-grant-<last twelve hex of its own endpoint id>`, checked against each endpoint's id rather
than taken on trust, and **no grant row is referenced by more than one connection any more**.

The six cleared connections read as needing authorization rather than as broken:
`_connection_state` returns `needs_auth` for a custom OAuth endpoint with no handle, which is the
same state a never-connected one reports, and one Connect restores each. Their shared row held one
account's tokens while all six claimed them, so five of the six were already presenting an account
that was not theirs.

Grant rows that were already orphaned before the revision ran were left in place, as its
`upgrade()` says they are: the total went from eleven rows to ten, which is the one ambiguous row
and nothing else.

## Result and follow-up

Record the date, worktree commit, compose project name, harness versions, run ids, screenshots,
and the field matrix above in the PR QA comment or release evidence. A failure to surface `code`
is a gateway/runner regression. A discrepancy in the richer fields is a harness-compatibility
finding and must be added to `open-reviews.md`; do not silently normalize it in the UI.

Delete the disposable project when the run is complete. Do not place screenshots, tokens, or raw
request headers in the repository.

## MCP permissions: discovery, policy, call, approval, resume

This section is the live evidence for per-tool MCP permissions, and the re-proof of OR79 and OR80.
Unlike the dashboard procedure above it is script-driven, because the thing under test is a
sequence — a gate raised, answered, and resumed — and a person clicking through it cannot show that
a rejected call performed no upstream request.

**Read every cell against the gateway's own request log, never against the reply.** The model's
prose is not evidence and the mock's confirmation is not either: until 2026-09-15 the round-trip
check accepted any tool result in the body as the echo, so a harness that called a tool name it did
not have still produced `mock MCP echo: <marker>`. A `tools/call` is a POST to the MCP route that
lands AFTER the model call; a rejected approval must show none.

### Fixture

- Stack: EE dev, compose project `agenta-ee-dev-gateways`, API `http://127.0.0.1:8680/api`.
- MCP server: the builtin mock route `/gateways/mcps/builtin/mock/mock`, declared on the agent as
  `{"type": "gateway", "namespace": "builtin", "provider": "mock"}` under the name `mock-mcp`. It
  advertises three tools: `echo`, `fail`, `slow`.
- Model: the compose mock LLM behind a custom gateway endpoint (`http://mock-llm-gateway:9091/v1`),
  on the protocol each harness needs. **No real model credential is used anywhere in this section**
  — this deployment has no Anthropic credit, so the Claude rows run against the mock LLM exactly as
  the Pi rows do. That is sufficient here because the mock emits a deterministic tool call when the
  prompt carries an acceptance marker, and what is under test is the gate, not the model.
- Account: a disposable one minted through `POST /admin/simple/accounts/`.
- Flag: `AGENTA_LLM_GATEWAY_ENABLED=true`, because the cells route their model through a custom
  gateway endpoint. It defaults to off for this release.
- Turns are posted to `POST {BASE}/services/agent/v0/invoke`, the URL the playground posts.

Driver: `mcp_permission_proof.py`, with `cell.sh` capturing the API access log for the same window.
Both are QA scratch, not committed. One cell is one command:

```bash
./cell.sh pi-ask-reject --harness pi_core --permission ask --answer deny --marker MCP-ACCEPTANCE-2
```

Keep markers to 16 characters, per the precondition in the dashboard procedure above.

### Results

| Cell | Configuration | Expected | Result |
| --- | --- | --- | --- |
| Pi deny | `permission: deny` | tool not offered, no `tools/call` | PASS |
| Pi ask, rejected | `permission: ask` | gate raised, rejection performs no `tools/call` | PASS |
| Pi ask, approved | `permission: ask` | gate raised, approval resumes and returns the result | PASS |
| Pi allow | `permission: allow` | runs unattended, no gate | PASS |
| Pi per-tool over server | `permission: allow`, `tool_permissions {echo: ask}` | `echo` asks despite the server allowing | PASS |
| Pi per-tool deny | `permission: allow`, `tool_permissions {echo: deny}` | `echo` not offered | PASS |
| Pi sibling deny | `permission: ask`, `tool_permissions {fail: deny}` | `echo` still offered and still asks | PASS |
| Pi two servers, one rendered name | servers `mock-mcp` and `mock.mcp` | one unambiguous tool, no silent shadowing | PASS |
| Claude ask, rejected | `permission: ask` | `tool-output-denied`, no `tools/call` | PASS |
| Claude ask, approved | `permission: ask` | approval resumes and returns the result | PASS |
| Claude deny | `permission: deny` | tool absent from the catalog | PASS |
| Claude allow | `permission: allow` | runs unattended | PASS |
| Codex ask, rejected | `permission: ask` | gate raised, rejection performs no `tools/call` | PASS |
| Codex ask, approved | `permission: ask` | approval resumes and returns the result | PASS |

### Pi: the OR79 re-proof

Before this change the Pi harness raised no gate for an MCP tool at all, so `policy.permission` was
dead configuration on it in both directions: an `ask` server ran unattended and a `deny` server ran
too.

`deny` — the tool is no longer offered, so nothing reaches the server:

```
frames=['start','start-step','message-metadata','data-agent-status'x4,
        'text-start','text-delta','text-end','finish-step','finish']
```

```
21:03:05.459Z  mcps/builtin/mock/mock -> 200     handshake
21:03:05.475Z  mcps/builtin/mock/mock -> 202     notifications/initialized
21:03:05.485Z  mcps/builtin/mock/mock -> 200     tools/list
21:03:08.877Z  llms/custom/wp4-mock-llm-.../v1/chat/completions -> 200
                                                 <- no MCP POST after the model call
```

No tool-call frame at all, because a denied tool is dropped from the advertised catalog rather than
offered and refused later.

`ask`, rejected — the gate is raised under the new `pi-mcp-tool` kind and the rejection performs no
upstream call:

```
[HITL] pi-gate id=79ae32f6-... {"gate":"pi-mcp-tool","toolCallId":"call_mock_mcp_echo",
       "toolName":"mcp__mock_mcp__echo","executor":"harness"}
[HITL] gate toolName="mcp__mock_mcp__echo" permission=ask outcome=pendingApproval
...
[HITL] gate toolName="mcp__mock_mcp__echo" permission=ask outcome=deny
```

Turn 1 ends `finish=other` with a `tool-approval-request`; turn 2 answers it rejected and the tool
returns the refusal text, so the model loop continues:

```
tool-output-available: "The 'mcp__mock_mcp__echo' call was refused and did not run. That decision
is already made: sending the same call again, or a reshaped version of it, will be refused too."
text='mock MCP tool call failed'
```

Neither turn shows an MCP POST after its model call.

`ask`, approved — the same gate resolves `allow` and the call reaches the server:

```
[HITL] gate toolName="mcp__mock_mcp__echo" permission=ask outcome=pendingApproval
[HITL] cold replay: ... resumeFrame=approval
[HITL] resume state: decisions=["mcp__mock_mcp__echo#{\"marker\":\"MCP-ACCEPTANCE-3\"}"]
[HITL] gate toolName="mcp__mock_mcp__echo" permission=ask outcome=allow
```

```
21:37:32.010Z  mcps/builtin/mock/mock -> 200                       tools/list
21:37:32.049Z  llms/custom/.../v1/chat/completions -> 200
21:37:32.082Z  mcps/builtin/mock/mock -> 200                       tools/call
21:37:32.107Z  llms/custom/.../v1/chat/completions -> 200
```

```
tool-output-available: {"resultType":"complete","content":[{"type":"text",
  "text":"{\"marker\": \"MCP-ACCEPTANCE-3\"}"}],"isError":false,
  "_meta":{"io.modelcontextprotocol/serverInfo":{"name":"agenta-mock-mcp","version":"0.1.0"}}}
text='mock MCP echo: MCP-ACCEPTANCE-3'
```

`allow` resolves without a human — one turn, no approval frame, `outcome=allow`, and the
`tools/call` lands after the model call.

### Pi: per-tool policy

A per-tool entry beats the whole-server permission. With the server set to `allow` and
`tool_permissions {"echo": "ask"}`, the gate reports the tool's own verdict and parks:

```
[HITL] gate toolName="mcp__mock_mcp__echo" permission=ask outcome=pendingApproval
```

with no MCP POST after the model call. This is the property that makes a per-tool table worth
writing: the table is authoritative for its server, so neither the server permission nor the run's
own default permission can widen it.

The table is per tool, not per server. `tool_permissions {"echo": "deny"}` removes `echo` and the
run produces no tool call; `tool_permissions {"fail": "deny"}` removes only `fail`, and `echo` is
still offered and still gated at the server's `ask`. The two cells together show the split.

### Pi: two connections that render one tool name (OR80)

Pi rewrites every character outside `[A-Za-z0-9_]` in both the server and the tool name, so the
distinct connections `mock-mcp` and `mock.mcp` both render `mcp__mock_mcp__echo`. Configured
together on one agent, the run now ends with a single unambiguous tool: the name keeps its first
claimant, the second server's tool is refused, and the registration fails so the operator sees it.
Both servers still complete their handshakes, which is what distinguishes this from a server that
failed to connect:

```
21:03:33.246Z  mcps/builtin/mock/mock -> 200     server 1 handshake
21:03:33.259Z  mcps/builtin/mock/mock -> 202
21:03:33.265Z  mcps/builtin/mock/mock -> 200     server 1 tools/list
21:03:33.273Z  mcps/builtin/mock/mock -> 200     server 2 handshake
21:03:33.280Z  mcps/builtin/mock/mock -> 202
21:03:33.290Z  mcps/builtin/mock/mock -> 200     server 2 tools/list
21:03:33.322Z  llms/custom/.../v1/chat/completions -> 200
```

```
[HITL] pi-gate id=3e0a4e31-... {"gate":"pi-mcp-tool","toolName":"mcp__mock_mcp__echo", ...}
[HITL] gate toolName="mcp__mock_mcp__echo" permission=ask outcome=pendingApproval
```

The per-tool refusal line is written by the in-sandbox extension and does not reliably reach the
runner's container log, so read the outcome — one registered tool, gated once — rather than
grepping for it. The unit case in `services/runner/tests/unit/pi-gateway-mcp.test.ts` asserts the
message directly.

### Claude Code: regression

The ACP path already worked at server granularity and still does. `ask` raises the gate, a
rejection yields `tool-output-denied` with no `tools/call`, and an approval resumes:

```
[HITL] ACP gate id=adaf0906-... {"toolCallId":"toolu_mock_mcp_echo",
       "anchor":"mcp__mock-mcp__echo","executor":"harness","argKeys":["marker"]}
[HITL] gate toolName="mcp__mock-mcp__echo" permission=ask outcome=pendingApproval
[HITL] gate toolName="mcp__mock-mcp__echo" permission=ask outcome=deny
```

`allow` runs unattended with the `tools/call` after the model call. `deny` is enforced one layer
earlier than on Pi: the SDK renders `deny: ["mcp__mock-mcp"]` into `.claude/settings.json`, so
Claude drops the tool from its own catalog and the model is told
`No such tool available: mcp__mock-mcp__echo`. Either way no request reaches the gateway.

Note the two spellings in the logs above: Claude's `mcp__mock-mcp__echo` keeps the hyphen, Pi's
`mcp__mock_mcp__echo` does not. That divergence is why the permission table is keyed on the name
the server advertises rather than on any rendered name.

### Codex: PASS, once the call is shaped the way the harness parses it

Codex took four attempts to drive, and the fixture was wrong in a different way each time. The
sequence is recorded because the wrong turns are the instructive part: three of them were guesses,
and the one that worked came from reading the harness's source.

**It does send its tool catalog.** The first assumption — that the ACP harnesses configure remote
MCP at session start and serialise nothing — is true of Claude on Messages and false of Codex on
Responses. Codex sends 19 to 21 tools, so the mock does not have to know the name: it reads it.

**MCP tools arrive namespaced.** The server appears as a `type: "namespace"` entry whose members
are the tools, and Codex groups its own multi-agent tools the same way:

```json
{ "type": "namespace",
  "name": "mcp__mock_mcp",
  "description": "Tools in the mcp__mock_mcp namespace.",
  "tools": [ { "type": "function", "name": "echo", ... },
             { "type": "function", "name": "fail", ... },
             { "type": "function", "name": "slow", ... } ] }
```

Note `mock_mcp`, underscored: Codex rewrites the server name the way Pi does, not the way Claude
does.

**And the two halves must stay apart on the wire.** Joining them is what kept failing. Every joined
spelling — Claude's `mcp__mock-mcp__echo`, the dotted `mcp.mock-mcp.echo`, the catalog-derived
`mcp__mock_mcp.echo`, and the bare `echo` — came back as `unsupported call: <name>`. The reason is
in the harness, not in the catalog. Codex's `ResponseItem::FunctionCall` carries `name` and an
optional `namespace` as SEPARATE wire fields
(`codex-rs/protocol/src/models.rs`), and `ToolRouter::build_tool_call` rebuilds the identity itself:

```rust
ResponseItem::FunctionCall { name, namespace, arguments, call_id, .. } => {
    let tool_name = ToolName::new(namespace, name).with_default_namespace();
```

`codex-rs/core/src/tools/router.rs`. A name with no `namespace` field is placed in the default
namespace, where no MCP tool is registered, and `unsupported_tool_call_message` (`registry.rs`)
renders the refusal.

**Which Codex this was measured against, because the obvious probe lies.** The harness the runner
drives is the pinned `@openai/codex 0.145.0` (`services/runner/package.json`), and these cells were
re-run against it on 2026-09-15 after review finding D8 questioned the provenance. The trap is that
the container also holds a standalone binary that reports a different version:

```
# The artifact an operator naturally probes -- and NOT what runs:
$ docker exec <runner> /root/.local/share/sandbox-agent/bin/codex --version
codex-cli 0.154.0

# The one codex-acp actually spawns:
$ docker exec <runner> node \
    /root/.local/share/sandbox-agent/bin/agent_processes/codex/node_modules/@openai/codex/bin/codex.js --version
codex-cli 0.145.0
```

`codex-acp`'s launcher (`bin/agent_processes/codex-acp`) execs the copy inside its own pinned
install, and its `startAcpServer` spawns `createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js")`
unless `CODEX_PATH` overrides it. `CODEX_PATH` appears nowhere in `services/runner/src` and is
unset in the container, so the bundled pin is what runs. An earlier revision of this section cited
the standalone binary and concluded the pin had drifted; it had not.

The wire shape is the same in both versions, so nothing here depends on which one is running:
`ResponseItem::FunctionCall` carries the separate `namespace` field and `build_tool_call` rebuilds
the identity with `ToolName::new(namespace, name)` at both `rust-v0.145.0` and `rust-v0.154.0`.

So the mock now emits the namespace as its own field:

```json
{ "type": "function_call", "call_id": "...", "name": "echo", "namespace": "mcp__mock_mcp",
  "arguments": "{\"marker\": \"MCP-ACCEPTANCE-C\"}" }
```

and the cell passes. `ask` raises the gate and parks:

```
[HITL] ACP gate id=be1f4d34-... {"toolCallId":"call_mock_mcp_echo","anchor":"mcp.mock-mcp.echo",
       "kind":"execute","executor":"harness","argKeys":["marker"]}
[HITL] gate toolName="mcp.mock-mcp.echo" permission=ask outcome=pendingApproval
```

```
21:40:48.591Z  mcps/builtin/mock/mock -> 200            tools/list
21:40:48.728Z  llms/custom/.../v1/responses -> 200
                                                        <- no MCP POST after the model call
```

Rejecting yields `tool-output-denied` with no `tools/call` in either turn; approving resolves
`outcome=allow`, the `tools/call` lands at `21:41:15.006` after the model call, and the turn ends
`mock MCP echo: MCP-ACCEPTANCE-A`.

**Codex uses a third spelling again at the gate, and the lookup handles it.** The name on the ACP
permission frame is `mcp.mock-mcp.echo` — dotted, with the server name HYPHENATED — while the
model-facing catalog said `mcp__mock_mcp` plus `echo`. Three surfaces, three spellings, one
configured server. The runner resolves the gate by letting the configured server names arbitrate
rather than the punctuation (OR80), so `mcp.mock-mcp.echo` still finds `mock-mcp` and its policy.
This is the clearest argument for keeping the permission table keyed on the name the SERVER
advertises: every other name in this section is a harness's private rendering of it.

One precondition the other cells did not need: the MCP permission cells drive their model through a
custom LLM gateway endpoint, so they require `AGENTA_LLM_GATEWAY_ENABLED=true`. That flag now
defaults to OFF for this release, and a cell run without it fails at endpoint creation with
`llm_gateway_disabled` rather than anything to do with MCP.

### A disconnected MCP connection offers the way back (OR85)

The permission cells above all run against a connected server. This one runs against a connection
that was connected and then disconnected, because that is the journey where a refusal has to carry
more than a cause: the agent cannot proceed, and the only useful thing to say is where to reconnect.

Setup, all API, no browser. Mint a grant, register an OAuth endpoint against the mock MCP server,
and prove it works before breaking it — a refusal from a connection that never worked proves less:

```
POST /api/secrets/                       kind=oauth_grant, access_token=<mock upstream token>
POST /api/gateways/mcps/endpoints/       auth_mode=oauth, secret_id=<id>, base_url=mock MCP

--- CONNECTED: tools/call
HTTP 200: {"jsonrpc":"2.0","id":1,"result":{"resultType":"complete",
           "content":[{"type":"text","text":"{\"text\": \"or85\"}"}],"isError":false, ...}}

--- DELETE /api/gateways/mcps/endpoints/{id}/connect      (disconnect)
HTTP 200

--- DISCONNECTED: tools/call
HTTP 409: {"jsonrpc":"2.0","id":null,"error":{"code":-32000,
  "message":"Authorization required for custom/or85-oauth-8c3491eb ⟦agenta_code:auth_required⟧",
  "data":{"cause":"auth_required","requirement":{"target":"custom/or85-oauth-8c3491eb",
    "state":"needs_auth","connect":{"endpoint":"/gateways/mcps/endpoints/<id>/connect","body":{}}}}}}
```

Then one agent turn on Pi with that connection as its only MCP server
(`{"type": "gateway", "namespace": "custom", "slug": "or85-oauth-8c3491eb"}`). The turn succeeds —
a server that will not connect is a notice, not a failure — and the notice now carries the remedy:

```json
{
  "type": "data-mcp-server-failed",
  "data": {
    "serverName": "mock-mcp",
    "reasonCode": "handshake_http_error",
    "status": 409,
    "message": "MCP server mock-mcp failed to connect: 409",
    "detail": {
      "code": "auth_required",
      "message": "Authorization required for custom/or85-oauth-8c3491eb ⟦agenta_code:auth_required⟧",
      "retryable": false,
      "details": {
        "cause": "auth_required",
        "requirement": {
          "target": "custom/or85-oauth-8c3491eb",
          "state": "needs_auth",
          "connect": { "endpoint": "/gateways/mcps/endpoints/<id>/connect", "body": {} }
        }
      }
    }
  }
}
```

Everything above `detail` is what the run produced before the fix, and it is worth looking at on its
own: `failed to connect: 409` is true, unactionable, and indistinguishable from a server that is
simply down.

**Where to look when this regresses.** The refusal crosses three layers and was dropped at each of
them in turn, which is the useful part of this cell:

1. `parseGatewayErrorDetail` (`services/runner/src/gateway-error.ts`) declined the JSON-RPC shape,
   because its body path required `error.code` to be our string rather than the protocol's `-32000`.
2. `probeMcpServerHandshake` (`services/runner/src/engines/sandbox_agent/mcp-handshake.ts`)
   discarded the response body before any parser saw it. This is the layer a live run finds and a
   unit test of the parser does not: a disconnected connection fails the HANDSHAKE, so no
   `tools/call` ever happens and the `tools/call` path is never the one under test.
3. `_mcp_server_failed_part` (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`) projects
   the notice through a field allowlist, so `detail` reached the browser only once it was named
   there.

A cell that shows `detail` absent should check all three before assuming the gateway stopped sending
the requirement; the API half is easy to confirm on its own with the `tools/call` above.

### The harness matrix suite, and the nine cells that were passing without testing anything

`services/oss/tests/pytest/acceptance/test_agent_gateway_route.py` is the release gate's harness
matrix: three harnesses crossed with three mock LLM gateway namespaces and three mock MCP gateway
namespaces, twenty-seven cells, each asserting that the assistant's final message is exactly
`mock MCP echo: <marker>`. Its own comment says that string "proves discovery and invocation rather
than merely prompt echoing".

For the nine Codex cells it proved neither, and had not for as long as the suite has existed.

**What the suite did at `6df148cb39`.** Green, 27/27 — and nine of those were false. The mock named
the echo tool `mcp__mock-mcp__echo` on the Responses protocol, which is Claude's spelling; Codex has
no such tool and answers `unsupported call: mcp__mock-mcp__echo`. The round-trip check then accepted
that refusal as a success, because it asked only whether the marker appeared anywhere in the body
(it does — in the user prompt) and whether any tool result existed (it did — the refusal). Run
against the baseline helpers directly:

```
$ git show 6df148cb39:.../mock/adapter.py > old_adapter.py   # then call its helpers
marker found                  : MCP-ACCEPTANCE-codex-abc123def456
has tool result               : True
BASELINE: echo 'succeeded'    : True
```

So the assertion passed on a call that never left the sandbox. Tightening that check
(`_contains_successful_mcp_echo_result` now looks for the marker INSIDE a tool result) is what
turned the nine cells red, and red was the correct reading.

**Why they stayed red after the Codex call shape was fixed.** Reading the tool name out of the
harness's own catalog is the right primary source, and it works — but a Responses request that
carries no catalog has nothing to read, and the Codex fallback had been removed on the grounds that
every value tried for it had been a guess. With neither source, the mock had no tool to call, so it
answered with the turn's own text and the suite saw the session preamble:

```
E       assert '## This sess...e its result.' == 'mock MCP ech...-3ca33cf2726d'
E         - mock MCP echo: MCP-ACCEPTANCE-codex-3ca33cf2726d
E         + ## This session
E         + Current facts for this turn:
E         + This is the first turn of the session.Use the echo tool with marker ...
```

The fallback is now restored with the pair that was MEASURED rather than guessed — namespace
`mcp__mock_mcp`, tool `echo`, the two halves apart on the wire because that is how
`ResponseItem::FunctionCall` carries them. A catalog, when the request has one, still wins.

**What was not the cause,** checked because all three were plausible: the D2/D10 ambiguity refusal
is not reachable here (every cell configures exactly one server, `mock-mcp`, so no two candidates
can match), and the Pi handshake-overlap refactor is not implicated (all nine Pi cells were green
throughout). Both were suspects worth eliminating rather than assuming.

**Result.** 27 passed, 0 failed, in 322s, with every cell reaching the mock MCP server for real:

```
$ cd services && AGENTA_API_URL=... AGENTA_AUTH_KEY=... AGENTA_GATEWAYS_MOCKS_ENABLED=true \
    AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN=... \
    uv run --no-sync python -m pytest oss/tests/pytest/acceptance/test_agent_gateway_route.py -q
...........................                                              [100%]
27 passed in 322.66s (0:05:22)
```

The Codex snapshot question this turned on is answered by the result itself. Codex connects its MCP
servers asynchronously at session start, so the tool catalog on the model request can be taken
before the connection completes — twelve tools, no `mcp__mock_mcp` namespace among them — while the
server IS registered by the time the model's call is dispatched. That is why a fallback is needed
at all, and why reading the catalog alone is not enough: the catalog is a snapshot, the dispatch is
later. Had the tool still been missing at dispatch, the cell would have failed with
`mock MCP tool call failed` rather than the preamble, and the fix would have belonged in the suite
(wait for registration) rather than in the adapter.

**Do not read a green row here as proof on its own.** This suite asserts one string, and that
string was reachable for nine cells without any tool call for as long as the suite existed. When a
row here matters, read it beside the gateway's own request log the way the cells in this section
do: a `tools/call` is a POST to the MCP route that lands after the model call.
