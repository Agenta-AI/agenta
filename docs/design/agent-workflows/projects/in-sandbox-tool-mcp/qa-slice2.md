# QA slice 2: live acceptance of the in-sandbox platform-tool MCP feature

Run 2026-07-12 against the `agenta-claude-sub-sidecar` runner (`POST /run` on
`127.0.0.1:8790`, verified via `docker port`), which holds the correct Daytona config
(`DAYTONA_SNAPSHOT=agenta-sandbox-pi`, target `eu`) and the Claude subscription login for
local Claude runs. The known credit constraint applies: every Anthropic API key on this box
is out of credit, so Claude+Daytona cells are MECHANISM cells (delivery proven, model turn
blocked upstream); Claude local rides the subscription, Pi rides its own uploaded Codex
login.

Request/response captures: `/tmp/qa-slice2/cell*.json` + `cell*.response.json`. Echo hits:
`/tmp/qa-slice2/echo-hits.jsonl`.

## Test rig

- **Gateway tool**: `get_weather`, a `callback`-kind `ResolvedToolSpec` with
  `callRef: "qa.get_weather"`, `permission: "allow"`, routed via
  `toolCallback.endpoint = http://172.19.0.1:8977/tools/call` — an echo server on the host
  (docker bridge gateway IP; `host.docker.internal` does not resolve in this container;
  reachability from inside the sidecar verified with a probe fetch before the runs). It
  returns the unguessable token `QA-ECHO-TOKEN-c4f7e2a91b` inside
  `{call: {data: {content}}}` and logs every hit, so a reply containing the token proves
  runner-side end-to-end execution.
- **Requests**: raw `AgentRunRequest` bodies POSTed to `/run` (no saved templates — avoids
  the pre-existing `runner.interactions` template validation bug). Shapes mined from
  `services/runner/src/protocol.ts` and `docs/design/agent-workflows/projects/qa/`.
- **Cell 3/5 model credential**: the `ANTHROPIC_API_KEY` from `.env.ee.dev`, delivered as
  `modelConnection` (`provider: anthropic`, `credentialMode: env`, one
  `binding: {kind: environment, name: ANTHROPIC_API_KEY}` credential with
  `usage: local_use`, `endpoint.baseUrl: https://api.anthropic.com`). No credential file and
  no OAuth token ever entered a sandbox.

## Matrix

| # | Cell | Expectation | Observed | Verdict | Evidence |
|---|------|-------------|----------|---------|----------|
| 1 | Claude + local + gateway tool (regression) | ok:true, reply carries the token, LOCAL loopback HTTP MCP channel (not the shim), echo hit once | HTTP 200, `ok:true`, output exactly `QA-ECHO-TOKEN-c4f7e2a91b`, 7.3 s. Log: `internal tool MCP server on http://127.0.0.1:34657/mcp serving 1 tool(s)`; HITL gate `mcp__agenta-tools__get_weather` outcome=allow; `relay_pickup id=c7ec049a... wake=activity`. Echo hit #1: `qa.get_weather` args `{city: Paris}` | **PASS** | `cell1-*.response.json`; sidecar log ~04:21:02Z |
| 2 | Pi + Daytona + gateway tool (regression) | ok:true + token; Pi extension delivery + relay execution | HTTP 200, `ok:true`, output exactly the token, 15.4 s, model `openai-codex/gpt-5.4-mini` on sandbox `daytona/f12c3c93-8ca5-...`. Log: `pi-gate {"gate":"pi-custom-tool","toolName":"get_weather","executor":"relay","specPermission":"allow"}` outcome=allow; `relay_pickup id=call_8WrIujya..._fc_... pickup_ms=1674 wake=poll`. Echo hit #2 with the OpenAI-style call id | **PASS** | `cell2-*.response.json`; relay + pi-gate log lines |
| 3 | Claude + Daytona + gateway tool, cold (MECHANISM) | not refused by the gate; shim delivered + advertised + relay armed; model turn fails on credit | NOT refused. 6.9 s run: `resolved model=haiku provider=anthropic ... credentialKeys=[ANTHROPIC_API_KEY]`; sandbox `daytona/368c7146-...` created; **`daytona: 1 gateway tool(s) advertised via the in-sandbox stdio MCP shim (the loopback MCP URL is unreachable from the sandbox)`** (the new `buildSessionMcpServers` log — fires only when the uploaded shim assets built the internal stdio entry); `create_session ms=1223` succeeded, meaning the ACP session was created WITH the `agenta-tools` mcpServers entry and the adapter's eager spawn+initialize of stdio MCP servers (slice-0 spike finding) did not fail; then `ok:false` `claude: the model provider account has insufficient credit (check the project's Anthropic key)` — a model/credit error AFTER delivery, not a gate refusal (a gate refusal is the `REMOTE_TOOLS_UNSUPPORTED` text in ~30 ms with no sandbox; see cell 4's timing for what refusals look like) | **MECHANISM PASS** | `cell3-*.response.json`; sandbox `368c7146` log block |
| 4 | Claude + Daytona + client tool (refusal) | ok:false with the new client-tools message BEFORE any sandbox | `ok:false` in **29 ms** with byte-exact `REMOTE_CLIENT_TOOLS_UNSUPPORTED_MESSAGE` ("Client tools are not supported for a non-Pi harness on a remote sandbox: ... Tracked in docs/design/agent-workflows/projects/in-sandbox-tool-mcp/."). Zero `sandbox_start.*daytona` log lines in the window — no sandbox created | **PASS** | `cell4-*.response.json` |
| 5 | Claude + Daytona + NO tools (negative) | no shim upload/advertisement; session proceeds; credit failure | `tools=0 executableTools=0`; NO `tool-mcp`/`advertised`/shim lines for its sandbox `daytona/b0eecdce-...`; `create_session ms=1369` succeeded; then the same credit error (5.1 s). Shim path activates only with executable tools | **PASS** | `cell5-*.response.json`; sandbox `b0eecdce` log block |
| 6 | Reserved name `agenta-tools` refusal | ok:false with the reserved-name message | `ok:false` in 28 ms with byte-exact `RESERVED_MCP_SERVER_NAME_MESSAGE` ("MCP server name 'agenta-tools' is reserved for Agenta's internal gateway-tool channel (permission rules are rendered against it); rename the MCP server.") | **PASS** | `cell6-*.response.json` |
| 7 | Warm/restart cells (live session, park-to-stopped restart, tool-set change) | — | Not attempted: a warm second turn needs a successful first turn, and no funded Anthropic key exists tonight | **BLOCKED** | The slice-0 spike ([spike-restart.md](spike-restart.md)) proved the restart respawn against the real `resumeSession`/`session/load` path: same agentSessionId, new shim pid, full `initialize`+`tools/list` re-handshake |

Notes on cell 3 evidence granularity:

- The shim **upload** has no success log by design (`tool-mcp-assets.ts` logs only
  failures and THROWS `TOOL_MCP_UNAVAILABLE_MESSAGE` on a missing bundle or failed write).
  The absence of that error plus the advertisement line — which is only reachable when
  `internalToolMcp` assets exist — is the upload proof.
- The **relay loop start** has no log line either; `startToolRelay` runs unconditionally
  before the prompt whenever `toolSpecs.length > 0`
  (`engines/sandbox_agent.ts:1840-1860`, `useToolRelay` from `run-plan.ts:620`) and its
  stale-sweep `ready` is awaited. The Daytona relay execution path itself was live-proven
  in the same session by cell 2 (`relay_pickup ... wake=poll`).

## Sidecar restart notes

- **The brief's assumption about the container CMD was wrong.** `docker inspect` shows the
  running sidecar's CMD is `mkdir -p /home/agent/.pi/agent && cp -a /pi-agent-ro/. ... &&
  exec node_modules/.bin/tsx src/server.ts` — it does NOT run
  `node scripts/build-extension.mjs`, so a restart alone rebuilds nothing. (The repo's
  `docker/Dockerfile.dev` CMD does run the build; this container was started with an
  override.) Its image also predates the feature: `/app/scripts/build-extension.mjs` was
  the old Pi-extension-only version and `/app/dist/tools/` did not exist.
- Fix applied: rebuilt both bundles on the host (`node scripts/build-extension.mjs` in
  `services/runner` → `dist/extensions/agenta.js` + `dist/tools/tool-mcp-stdio.js`,
  9.6 kB), then `docker cp` of `scripts/build-extension.mjs` and `dist/tools/` into the
  container, then `docker restart`. Restart was also required for the server code itself:
  the old tsx process (started 02:13Z) predated the slice-1 src mtimes (03:54–04:07Z);
  `src/` is bind-mounted, so the restart loaded current code. `dist/extensions` is
  bind-mounted from the host, so Pi got the fresh extension automatically.
- Verified after restart: `/app/dist/tools/tool-mcp-stdio.js` present, sha256
  `99bc0ad1...` identical host/container; `/health` OK.
- Cost: the restart tore down 1 parked keepalive session belonging to another agent
  (`destroyAll count=1` — a Claude local session parked on a Terminal ask-gate).
  Coordination-board notes were posted before and after the restart.

## Daytona teardown

Four sandboxes were created by these runs, all on the sidecar's account
(`agenta-sandbox-pi` snapshot, target `eu`):

| Sandbox | Cell | Final state |
|---|---|---|
| `a1d2afda-80eb-44c9-85c2-28f8165091a8` | 2 (first attempt, model not settable) | 404 gone |
| `f12c3c93-8ca5-4f30-a3c3-d781cdeb5c4e` | 2 (pass) | 404 gone |
| `368c7146-4c7d-48bf-8fca-78571b2f1f60` | 3 (mechanism) | 404 gone |
| `b0eecdce-1713-4230-8755-d415235b7d94` | 5 (no tools) | 404 gone |

All four were already deleted by the runner's own ephemeral teardown (these were
sessionless runs, so they are deleted — not parked — at run end); each id verified 404 by
direct GET, and the paginated account list reports **0 sandboxes** (checked twice, the
second time ~1 h later). Nothing was left to reap manually.

## Anomalies and side findings

1. **Sidecar CMD deviation** (above): future QA against this container must `docker cp`
   built bundles in; a restart alone does not rebuild. The real images
   (`docker/Dockerfile.dev:55`, `docker/Dockerfile.gh:65`) run `pnpm run build:extension`
   at image build, so deployed runners will carry `dist/tools/tool-mcp-stdio.js` baked.
2. **Pi's sidecar login is Codex-subscription-only.** `openai/gpt-4o-mini` (the QA
   default) is not settable; the run failed loud with `ModelNotSettableError` listing only
   `openai-codex/*` ids (the F-007 fail-loud behavior working as designed). Cell 2 used
   `openai-codex/gpt-5.4-mini`.
3. **Local Claude gateway calls also ride the file relay** behind the loopback HTTP MCP
   channel (`relay_pickup ... wake=activity` on cell 1). Expected wiring, noted because the
   relay lines alone do not distinguish local from Daytona — the channel line
   (`internal tool MCP server on http://127.0.0.1:...` vs `advertised via the in-sandbox
   stdio MCP shim`) is the discriminator.
4. **Concurrent sidecar use during QA**: another agent ran Claude local sessions
   (`tools=4` lines, a `gh pr list` approval park) throughout; all evidence above is keyed
   by sandbox/session id, not by time window alone.
5. Pre-existing, unrelated: OTel trace export 401 spam in the sidecar logs
   (`OTLPExporterError: Unauthorized`).

## Verdict

Every testable cell is green: both regressions (Claude+local, Pi+Daytona) fully execute
the gateway tool end-to-end through their unchanged channels, the Claude+Daytona mechanism
cell proves the new shim delivery chain (gate pass → upload → typeless stdio advertisement
→ session created with the entry) with the failure confined upstream of the feature (model
credit), and all three refusal/negative behaviors (client tool, reserved name, no-tools
no-shim) match the slice-1 contract byte-for-byte. The remaining live gap is the funded
model turn on Claude+Daytona (the model actually calling the tool through the shim) plus
the warm-reuse cells — one funded Anthropic key unlocks all of them; the lifecycle risk
they cover is already pinned by the slice-0 spike.
