# Pre-release QA — STATUS

Live status doc. Kept current so a cold successor (or a post-crash restart) can resume without
re-deriving anything. Last updated: 2026-07-14.

## The goal

Product-level sanity QA before the agent-workflows release. The question is not "is every detail
right" — it is "**if a user opens the product and does the obvious first things, do they work?**"
Detail bugs get caught later by the playground test suite. This is the gate.

## The system under test

- **Deployment**: `https://bighetzner.agenta.dev` — compose project `agenta-oss-team-*`,
  deployed from `/home/team/agenta` (owned by user `team`, NOT readable by us; env changes go
  through the agent that owns it).
- **Runner**: `agenta-oss-team-runner-1`, image `agenta-allharness-sidecar:latest` (both
  harnesses baked; Claude Code is never distributed, this image is local-only).
- **Credentials**: `~/.agenta-bighetzner.env` (mode 600) — project API key, workspace/project id.
- **Logs**: `docker logs agenta-oss-team-{runner,api,web}-1` — we have read access. This is how
  we see truths the UI hides (cold sessions, mount failures).
- **Vault keys set by Mahmoud in the project**: Anthropic, OpenAI, OpenRouter.

## The matrix

Core = harness x sandbox. Provider/auth is a sub-matrix run inside the Pi cells only (it is an
auth question, not a sandbox question — re-running it in all four cells tests the same code twice).

| Cell | Harness | Sandbox | Model |
|---|---|---|---|
| C1 | `claude` | `local` | sonnet (alias; a full model id gets dropped to default on the Claude ACP path — F-007) |
| C2 | `claude` | `daytona` | sonnet |
| C3 | `pi_core` | `local` | `gpt-5.6-luna` (OpenAI) |
| C4 | `pi_core` | `daytona` | `gpt-5.6-luna` |
| P1 | `pi_core` | `local` | `openrouter/deepseek/deepseek-v4-flash` — OpenRouter as a native provider |
| P2 | `pi_core` | `local` | OpenRouter as a **custom OpenAI-compatible provider** (base_url `https://openrouter.ai/api/v1`) — the least-travelled path, most likely broken |

## The journeys (run in every core cell)

| | Journey | Passes when |
|---|---|---|
| J1 | Create agent, send one message | Turn completes; `finish` frame, not `error` |
| J2 | Write a file, then read it back **in a second turn** | File exists in the mount; content survives across turns |
| J3 | Call a tool | An unguessable token baked into the tool's return appears in the reply |
| J4 | Approval: **approve** one, then **deny** another | Approved path continues; denied path is handled cleanly, no phantom failure |
| J5 | Commit (save an agent config as a new revision) | The new revision, fetched back over the wire, carries the changed parameter AND the version bumped (see below — this is the playground's `POST /api/workflows/revisions/commit`, NOT the in-stream `data-committed-revision` frame) |
| J6 | Warm/cold | Turns 2-3 faster than 1; runner log confirms session **loaded**, not silently cold; conversation continues coherently after a forced cold restart |
| J7 | MCP smoke test | An MCP server declared in the agent config is delivered to the harness and one of its tools executes — a `tool-output-available` frame for an `mcp__*` tool (Claude only; see below) |

Triggers are explicitly out of scope for this gate.

## How we assert (never on model prose)

1. **Wire** — the SSE frame types (`tool-approval-request`, `data-committed-revision`, `finish`).
   Structural, not textual.
2. **Side effects** — the file is really in the mount; the revision really incremented.
3. **Logs** — the only source of truth for warm/cold and for silent mount failures.

Where the model must prove something in text, we bake an unguessable constant into a tool's
return value, so a matching reply *proves* the tool ran. The model cannot guess it.

## Key wire facts (verified in code, do not re-derive)

- Turn: `POST {origin}/services/agent/v0/invoke?project_id=…` — **not** an `/api` route.
- Auth: `Authorization: ApiKey <key>`; `project_id` goes in the **query string**, never the body.
- Headers: `Accept: text/event-stream`, `x-ag-messages-format: vercel`. SSE, `data: [DONE]`
  terminated, `: keepalive` comment lines must be ignored.
- **There is no create-session endpoint** — the session id is minted client-side and materialized
  lazily on first invoke.
- **Approvals are in-band.** The browser approves by re-POSTing the whole message history to
  `/invoke` with the tool part set to `state: "approval-responded"`, `approval: {id, approved}`.
  The REST route `/api/sessions/interactions/{id}/respond` is the *out-of-band* (Slack/trigger)
  path and is NOT what the UI does — testing it would test the wrong code path.
- **"Commit" = a workflow revision commit, not a git commit.** There is no git surface in the
  runner at all.
- Config selectors: `parameters.agent.harness.kind` (`pi_core`|`pi_agenta`|`claude`) and
  `parameters.agent.sandbox.kind` (`local`|`daytona`). Flat `model`/`agents_md` at the template
  root are rejected — use `llm.model` and `instructions.agents_md`.
- A **paused** turn (approval) finishes with `finishReason: "other"`, so "turn ended" does not
  mean "turn completed".

## Status

| Item | State |
|---|---|
| Docker log access | DONE |
| Daytona env fix (other agent) | DONE — `local,daytona`, snapshot `agenta-agent-sandbox-v1`, target `eu` |
| Object-store fix (other agent) | DONE — SeaweedFS up, `mounts/sign` = 200, real durable cwd. F-1 closed. |
| Playwright testability backlog | DONE — `playwright-testability.md` |
| Programmatic driver | DONE — `scripts/qa_product.py` |
| C3/C4/P1 (Pi cells) | DONE — see matrix below. NOTE 2026-07-14 ~21:45: the **OpenAI vault key is out of quota** (C3/C4 chat now FAIL with a clean "insufficient credit" error — external, needs a top-up; see runs/20260714-214326). The error surfaces correctly, so the #5317 fix is live. |
| C1/C2 (Claude cells) | **DONE** — Anthropic key funded 2026-07-14; C2 ran the full six-journey set on the vault key, all green (see matrix below) |
| S1 (Pi + Codex subscription) | **DONE** — chat/tool/approve green (see matrix below) |
| P2 (custom OpenAI-compatible provider) | **BLOCKED — needs the raw OpenRouter key or a custom_provider slug** |
| UI end-to-end pass | PARTIAL — approval dock verified end-to-end; rest blocked on credit |
| J5 commit journey | **DONE** — PASS on P1; `commit` journey added to the driver (see below) |
| J7 MCP smoke test | **DONE** — PASS on C1 (Claude/local, subscription) against public DeepWiki MCP; `mcp` journey added (see below) |

**RESUMED 2026-07-14 ~21:20: the deployment settled (runner healthy, SeaweedFS up, `chat` green
on P1 and C1). The 18:05 pause is lifted. The two new journeys below ran against this settled
stack.**

## Matrix (last good run: runs/20260714-175715, Pi cells; Claude from runs/20260714-174932)

| cell | harness | sandbox | model | chat | mount | tool | approve | deny | warm |
|---|---|---|---|---|---|---|---|---|---|
| C1 | claude | local | sonnet | PASS | — | PASS | PASS | PASS | — |
| C2 | claude | daytona | **haiku** (vault key) | PASS | **PASS** | PASS | PASS | PASS | PASS |
| C3 | pi_core | local | gpt-5.6-luna | PASS | PASS | PASS | PASS | PASS | PASS |
| C4 | pi_core | daytona | gpt-5.6-luna | PASS | **FAIL** (pre store-exposure; see C2 mount) | PASS | PASS | PASS | PASS |
| P1 | pi_core | local | openrouter/deepseek-v4-flash | PASS | PASS | PASS | PASS | PASS | PASS |
| S1 | pi_core | local | gpt-5.6-luna (**openai-codex subscription**) | PASS | — | PASS | PASS | — | — |

### C2 full six-journey run (2026-07-14 ~21:53, funded Anthropic vault key) — `runs/20260714-215309`

The never-tested cell. Connection `{"mode": "agenta"}` (the vault key — Daytona rejects
subscription auth by design), model alias `haiku` (accepted on the Claude ACP path exactly like
`sonnet`; probed first on chat, `runs/20260714-215252`). All six journeys PASS.

- **mount PASS is the headline**: the redeploy exposed the store publicly
  (`AGENTA_STORE_ENDPOINT_URL=https://bighetzner-store.agenta.dev` on the api container), and the
  runner log shows the Daytona sandbox REALLY mounting it — `remote mounted agenta-store:mounts/…
  (verified alive)` via geesefs against the public URL, `stage=mounts ms≈2000` (vs the 2ms
  nothing-mounted signature of F-7), and **zero** `mount degraded` / `tunnel discovery failed`
  lines in the window. **F-7 is fixed on this deployment by the store exposure.** (The fail-open
  code path still exists for deployments without a public store — the hardening ask stands.)
- warm: 9497ms → 1721/1453ms, corroborated by two `[keepalive] hit-continue` lines for the
  session (`6b22fca8`) — genuinely warm, not just faster.
- deny outcome is `error` (Claude surfaces a denied tool as tool-output-error), which the driver
  accepts (`outcome != "available"`).

### S1: Pi + Codex subscription (2026-07-14 ~21:53) — `runs/20260714-215322` (chat), `runs/20260714-215335` (tool+approve)

New cell in the driver: `pi_core`/`local`, provider `openai-codex`, model `gpt-5.6-luna`,
connection `{"mode": "self_managed", "slug": null}` (the ChatGPT/Codex OAuth login in the
subscription sidecar, not a vault key). chat, tool, approve: **all PASS** — the subscription wire
path works end to end, including the approval gate. Contrast with C3/C4 (same model via the vault
`openai` key), which now fail on quota — the subscription path is independent of that key.

Warm/cold looks healthy where measured: C3 4444ms -> 1166/1130ms; C4 12189ms -> 1699/1392ms.
(Latency only. The cold/warm TRUTH is in the runner log — see F-2.)

**OpenRouter as a native provider (P1) is fully green.** That answers one of the two provider
questions.

### J5 commit + J7 MCP (added 2026-07-14 ~21:20, settled stack)

| cell | harness | sandbox | model | commit (J5) | mcp (J7) |
|---|---|---|---|---|---|
| P1 | pi_core | local | openrouter/deepseek-v4-flash | PASS (`runs/20260714-212356`) | SKIP (Pi rejects mcps) |
| C1 | claude | local | sonnet (subscription) | PASS | PASS (`runs/20260714-212400`) |

- **commit** is harness-agnostic (it drives the config REST API, not a turn), so it runs and passes
  the same in every cell; P1 is the recorded evidence.
- **mcp** requires a Claude harness and therefore SKIPs on every Pi cell (P1/C3/C4/P2) with a clear
  message; C1 is the recorded pass. Evidence of the SKIP path: `runs/20260714-212423`.

## Journey mechanics (J5 commit, J7 MCP) — the load-bearing facts

**J5 commit — the endpoint and the seed trap.** "Commit" = save the agent config as a new workflow
revision, the playground's Save/Commit button. The driver drives the same REST route the UI does
(`web/packages/agenta-entities/src/workflow/api/api.ts` `commitWorkflowRevisionApi`):

- Create the artifact + variant: `POST /api/workflows/` then `POST /api/workflows/variants/`.
- Commit: `POST /api/workflows/revisions/commit`, body
  `{"workflow_revision": {slug, name, message, workflow_id, workflow_variant_id,
  "data": {"uri": ..., "parameters": {...the agent config...}}}}`. Auth is `ApiKey`, `project_id`
  in the query string. The agent config lives under `data.parameters` (for an agent workflow:
  `data.parameters.agent.{instructions,llm,tools,harness,sandbox}`).
- Fetch back: `GET /api/workflows/revisions/{id}` → `workflow_revision.data.parameters` +
  `.version`.
- **The trap that cost real time:** the FIRST commit on a fresh variant is the **v0 seed**, and the
  DAO force-nulls its `data`/`flags`/`meta` (`api/oss/src/dbs/postgres/git/dao.py`
  `_null_revision_fields`, guarded by `if revision.version == "0"`). A config only persists on the
  **second** commit (v1). The UI does the same seed-then-commit dance. So the journey commits twice
  (seed, then the real change) and asserts v0→v1 plus the changed `agents_md` token surviving a
  fetch-back. `data` is `extra="forbid"` — only `{uri,url,headers,runtime,script,schemas,parameters}`
  are accepted. QA artifacts are namespaced `qa-commit-<hex>` and the workflow is archived
  (`POST /api/workflows/{id}/archive`) in a `finally`, so repeated runs leave nothing behind.

**J7 MCP — what it takes to run, and why it is Claude-only.** The agent config accepts user MCP
servers under the template's `mcps` list. Each entry is a full `MCPServerConfig`
(`sdks/python/agenta/sdk/agents/mcp/models.py`), NOT a bare URL:
`{"name": "<slug>", "connection": {"type": "http", "url": "<https url>", "headers": {...}?,
"credentials": {...}?}, "policy": {"tools": {"mode": "all"}}}`. Only `type: "http"`
(Streamable-HTTP / SSE) is supported; there is no user `stdio`.

Two hard constraints, both verified in the runner:

1. **Claude only.** Pi refuses any run that declares `mcps`
   (`services/runner/src/engines/sandbox_agent/run-plan.ts`, `PI_USER_MCP_UNSUPPORTED_MESSAGE`).
   User MCP needs a harness with `capabilities.mcpTools` (Claude). The journey therefore SKIPs on
   every Pi cell and runs on C1 (Claude/local). C1 uses **subscription** auth (the vault Anthropic
   key is out of credit) — proven working on this stack.
2. **Public HTTPS only — a local MCP server is NOT reachable.** Both the SDK resolver
   (`assert_endpoint_url_allowed`) and the runner (`validateUserMcpUrl`) run an SSRF guard that
   rejects `http://` and private/loopback/metadata hosts unless `AGENTA_INSECURE_EGRESS_ALLOWED`
   (SDK) or `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` (runner) is set. The **harness** dials the URL — on
   `local` from the runner host — so the endpoint must be a public HTTPS server reachable from the
   deployment's network.

**Infra to run J7:** no infra we host is needed — the journey uses a well-known free public
reference server, **DeepWiki** (`https://mcp.deepwiki.com/mcp`, no auth, tools
`read_wiki_structure` / `read_wiki_contents` / `ask_question`), reachable from bighetzner. Override
with `--mcp-url <public-https-url>` for any other public server. If in future you want to point at
a server that is not publicly reachable (a local one, or an intranet one), you would need to set
`AGENTA_AGENT_MCPS_HOST_ALLOWLIST`/`AGENTA_INSECURE_EGRESS_ALLOWED` on the runner AND make the URL
reachable from the runner host — neither is set today, so a local server will be rejected by the
SSRF guard. Assertion is wire-level: a `tool-output-available` frame for a tool named `mcp__*`
(the runner namespaces MCP tools `mcp__<server>__<tool>`, e.g. `mcp__deepwiki__read_wiki_structure`);
the runner log corroborates with an `[HITL] gate toolName="mcp__deepwiki__..." outcome=allow` line.

## Triage: product bug vs deployment artifact

The question that decides what blocks the release. "Deployment-independent" means the defect is in
code that behaves the same everywhere; it cannot be configured away.

| # | Finding | Class | Reasoning |
|---|---|---|---|
| F-5 | `tool-input-available` streams a PARTIAL command; toolName flips case | **BUG, deployment-independent** | Pure wire behavior from `stream.py`. Same on every stack. |
| F-6 | Permission Policy control does not govern Claude's builtins | **BUG, deployment-independent** | `claude_settings.py:134` only emits rules for MCP-delivered tools, never for Claude's own Bash/Write/Edit. Not configurable. |
| F-8 | `/tools/discover` output is rejected by the agent config | **BUG, deployment-independent** | Schema contradiction: discovery attaches `input_schema`/`description`; `GatewayToolConfig` forbids extra keys. |
| F-3 | Pi permission layer fails OPEN (ask/deny become no-ops) | **BUG (fail-open) + image-specific TRIGGER** | The `try/catch` swallow in `pi-assets.ts:349` is on every deployment. The trigger here is the image (no `/pi-agent`, non-root). Expect NOT to reproduce on our root-ful dev image — which does not make it safe: a read-only rootfs, a k8s securityContext, or a custom `PI_CODING_AGENT_DIR` re-arms it. **It was live on the stack we are shipping from.** |
| F-7 | Daytona durable mount silently skipped -> files never persist | **FIXED on this deployment (store exposure, 2026-07-14); fail-open hardening still open** | Was CONFIRMED, see below. After the redeploy exposed the store publicly (`AGENTA_STORE_ENDPOINT_URL=https://bighetzner-store.agenta.dev`), C2 mount PASSES with `remote mounted … (verified alive)` in the runner log. The silent-skip code path still exists for any deployment whose store is not publicly reachable — the "fail loud" ask stands. |
| F-1 | Mounts 503 -> agent runs in a throwaway `/tmp` cwd | FIXED (config) + BUG (fail-open) | Store was simply not deployed. The fail-open half is the same defect as F-3/F-7. |
| F-9 | Claude harness resuming its native session | **DOWNGRADED / PARTIALLY RETRACTED — was a blocker, now a residual resilience risk** | See below. The 72h `mode=create`-only observation predates a redeploy that pulled recent upstream fixes; a 2026-07-14 decisive experiment against the redeployed stack shows native session resume now working (4/4 runs, both harnesses, `mode=load` + `loaded=true`). The lossy 4000-char rebuild path still exists as the fallback when native load fails. |
| F-10 | Daytona sandbox destroyed ~2s after a 120s park | **UNKNOWN — not config** | Config is byte-identical across both stacks (all Daytona vars empty -> code defaults). The runner has **no code path that deletes a parked sandbox** (`deleteSandbox` is defined and never called). Local Daytona sandboxes park correctly (`state: stopped`, autostop 15m). So the 1.8s destruction on bighetzner is a platform anomaly or a create->park race — needs a live re-test with tighter logging. |
| — | Claude + Daytona rejects subscription auth | **BY DESIGN, well surfaced** | `"Daytona sandboxes do not support runtime-provided (subscription) authentication. Use a managed API key … or run this harness on the local sandbox."` Not a bug. It does mean C2 genuinely needs a funded Anthropic key. |
| F-11 | **Every Pi provider error is swallowed into "The agent produced no output."** | **REGRESSION (2 days old), deployment-independent — CONFIRMED, one-line fix** | See below. Commit `42075a5e9f` disarmed `findSwallowedPiError`. Dead key, exhausted quota, rate limit, bad model — all surface to the user as "no output". |
| — | The OpenAI account is OUT OF QUOTA | **EXTERNAL — needs a top-up** | Pi's transcript: `"You exceeded your current quota…"`, `stopReason:"error"`, `totalTokens:0`. Affects EVERY OpenAI model, not `gpt-5.6-luna`. **Our own QA burned it.** No runaway spend. |

## Findings

**F-1 (CONFIRMED, blocker) — no object store => mounts 503 => the agent silently loses every file.**

Reproduced on the first QA run (session `c43cafde`), and it is happening on *every* run:
```
[sandbox-agent] sign HTTP 503 session=c43cafde… name=cwd — running without this mount
[sandbox-agent] mount degraded kind=session_cwd cause=sign_returned_no_mount
[sandbox-agent] harness=pi_core sandbox=local cwd=/tmp/agenta-sandbox-agent-JBGK1o
```
API side: every `POST /sessions/mounts/sign` and `POST /mounts/agents/sign` returns **503**.

Root cause chain:
1. `MountsService` raises `MountStorageUnavailable("Mount storage backend is not configured.")`
   (`api/oss/src/core/mounts/service.py:388,405`) because the S3-compatible store is not enabled.
   `StoreConfig.enabled = bool(access_key and secret_key)` (`api/oss/src/utils/env.py:1117`).
2. The bighetzner API container has **no `AGENTA_STORE_*` env vars at all** — verified via
   `docker inspect`.
3. And there is nowhere for them to point: **the published `gh` compose ships no object store.**
   `seaweedfs` exists only in `docker-compose.dev.yml` (OSS *and* EE); both `docker-compose.gh.yml`
   files have no store service. `env.oss.gh.example:360` marks ACCESS_KEY/SECRET_KEY as required
   with a `replace-me` placeholder, while `AGENTA_STORE_ENDPOINT_URL` defaults to
   `http://seaweedfs:8333` — a host that does not exist in a `gh` deployment.

Two distinct defects, and the second is the one that scares me:

- **(a) Hosting gap.** A self-hoster using the published compose has no store unless they bring
  their own S3. If bring-your-own-S3 is intended, the default endpoint pointing at a nonexistent
  `seaweedfs` host is a trap.
- **(b) Silent data loss.** When signing fails, the runner **continues anyway** with a throwaway
  `/tmp` cwd. The turn succeeds, the UI renders a perfectly normal answer, and every file the
  agent wrote is gone. Nothing surfaces to the user. This should fail loudly or at minimum show a
  degraded state. As shipped, a self-hoster's agent appears to work and silently cannot persist
  anything.

Blocks J2 and J5 in **all four cells**. Until a store exists, matrix results for those journeys
are meaningless.

**F-3 (CONFIRMED, security blocker) — the Pi permission layer FAILS OPEN. `ask` never prompts and
`deny` never blocks.**

Proven on C3 (pi_core/local) before the workaround below: with
`runner.permissions.default = "deny"`, the bash tool **executed anyway** (wire showed
`tool-output-available`), and with `"ask"` no approval gate ever fired. The entire Layer-2
permission posture was a no-op.

Root cause chain:
1. Pi's builtin permissions are enforced by an **extension** the runner installs into
   `PI_CODING_AGENT_DIR` (`run-plan.ts:212 permissionPlanCouldGatePiBuiltin`).
2. Installing it does `mkdirSync(join(agentDir, "extensions"))`
   (`services/runner/src/engines/sandbox_agent/pi-assets.ts:346-351`).
3. That call is wrapped in a try/catch that **swallows the failure and logs `pi extension install
   skipped: …`** — then the run proceeds with no enforcement at all. **The security boundary
   fails open.**
4. Trigger on this deployment: `PI_CODING_AGENT_DIR=/pi-agent` (the compose default), but
   `/pi-agent` **does not exist** in `agenta-allharness-sidecar:latest` and the runner runs as
   **uid 1000 (node)**, so it cannot create a directory at `/`. Our EE dev runner image runs as
   **root** and ships `/pi-agent`, which is why this never showed up locally.

Causal link verified: after `docker exec -u 0 … mkdir -p /pi-agent && chown 1000:1000 /pi-agent`,
the gate fires correctly (`[HITL] gate toolName="Bash" permission=deny outcome=deny`) and both
approve and deny pass.

The image is only the trigger. **The defect is the fail-open.** Any deployment where that dir is
not writable — non-root user, read-only rootfs, a k8s `securityContext`, a custom
`PI_CODING_AGENT_DIR` — silently loses ask/deny with nothing surfaced to the user. The fix is to
**fail closed**: if the permission plan needs extension enforcement and the extension cannot
install, the run must error, not proceed.

NOTE: all C-cell results below were obtained WITH the manual `/pi-agent` workaround applied to the
running container. That workaround is lost on container recreate.

**F-11 (CONFIRMED, regression from `42075a5e9f`, one-line fix) — every Pi provider error is
swallowed and shown to the user as "The agent produced no output."**

The OpenAI account is out of quota (external, needs a top-up — our own QA burned it). Pi recorded
the real cause on disk:
```json
{"stopReason":"error","provider":"openai","model":"gpt-5.6-luna","usage":{"totalTokens":0},
 "errorMessage":"You exceeded your current quota, please check your plan and billing details. …"}
```
The user saw: **"The agent produced no output."** The runner log said only
`[sandbox-agent] prompt stopReason=end_turn`.

The runner HAS a helper for exactly this — `findSwallowedPiError`
(`services/runner/src/engines/sandbox_agent/pi-error.ts`, wired at `sandbox_agent.ts:2151`). It
reads `join(piAgentDir, "sessions")` (`pi-error.ts:103`). But commit **`42075a5e9f` "fix(agent):
persist Pi transcripts in session workspaces" (2026-07-13)** moved Pi's transcripts to
`<cwd>/agents/sessions/pi/` (`pi-assets.ts:31-33`, `piSessionWorkspaceDir`) and **never updated the
callsite**. On the live runner:
```
$ docker exec … ls /pi-agent/sessions
ls: cannot access '/pi-agent/sessions': No such file or directory
```
`readdirSync` throws -> the helper returns `undefined` -> the engine falls through to the empty-turn
path. **The error-surfacing mechanism was silently disarmed two days ago.**

Fix: pass the transcript root, not the agent dir — `join(plan.cwd, "agents")`, so the existing
`join(piAgentDir, "sessions")` resolves. Add a regression test asserting the callsite's dir matches
`piSessionWorkspaceDir`. Note the Daytona path was never covered by this helper by design
(`pi-error.ts:18-19`), so C4 keeps swallowing until the error is surfaced over ACP.

Consequence for users: a dead key, an exhausted quota, a rate limit, or a bad model id all present
as "the agent produced no output" — the single least actionable message we could show.

**F-9 (DOWNGRADED / PARTIALLY RETRACTED 2026-07-14 — was "CONFIRMED on both stacks, likely THE
long-conversation bug") — the Claude harness never resumes its native session. Every turn is
rebuilt from a lossy hand-rendered transcript.**

**Original claim, kept for the record.** Evidence from our OWN dev stack (not bighetzner), over
72h of real dogfooding traffic:

| harness | `create_session mode=create` | `mode=load` |
|---|---|---|
| claude | **96** | **0** |
| pi_core | 21 | 50 |

and the `[continuity] session/load attempted … harness=…` line **never once names claude** (48
`loaded=true` events, all `pi_core`). So this is not a bighetzner artifact and not our driver's
history bug — the claude path never even *attempts* to reload its session.

**Why this matters more than it looks.** There are two different mechanisms:
- the **keepalive pool** (an in-memory warm process, TTL 60s) — Claude DOES hit this, which is why
  our C1 warm journey passes (3847ms -> 1772ms);
- **session load from disk** (`mode=load`) — resuming the harness's OWN native session. Claude
  **never** does this.

So the moment the 60s pool TTL lapses — or the runner restarts, or the pool evicts under load — a
Claude conversation does not resume. It is reconstructed from the runner's hand-rendered
transcript (`transcript.ts buildTurnText`), which **hard-truncates every tool result at 4000 chars**
and blind tail-slices the whole history at 100k. Lossy, verbatim character deletion, re-applied on
every cold turn.

That is a very strong candidate for the reported "long conversations with lots of tool output lose
information" — and it predicts the loss is **worse on Claude than on Pi**, which matches a
tool-heavy Claude session degrading over time. Worth confirming with a long Claude conversation
that crosses the 60s pool TTL between turns.

**What the decisive experiment showed (2026-07-14, `runs/coldctx-20260714-201002/`).** The
prediction above was directly testable: plant an EARLY token near the start of a ~7.3k-char bash
output and a LATE token past the 4000-char truncation cap, wait 75s (past the 60s keepalive pool
TTL) so the session goes cold, then ask for both tokens back in the same session via a faithful
history replay (full assistant `parts`, tool calls included — see LESSONS.md #1). If F-9 as
written were still true, `claude` should recall EARLY but lose LATE.

It did not. Run against the redeployed bighetzner stack — 2 runs on `claude/local` (subscription
auth) and 2 runs on `pi_core/local` (`openrouter/deepseek/deepseek-v4-flash`) — **both tokens came
back in all 4/4 runs**, and the runner log confirms the session genuinely went cold and then
genuinely reloaded natively for both harnesses:

```
[sandbox-agent] [continuity] session/load attempted session=3aa4d192… harness=claude loaded=true
[sandbox-agent] [timing] stage=create_session ms=1480 sandbox=local/… session=3aa4d192… mode=load
```

(and the matching pair for `pi_core`). Claude native session resume works on this build. The
`mode=create`-only signature from the 72h dogfooding window is gone.

**Residual risk (this is now a resilience concern, not an every-cold-turn data-loss bug).** The
lossy 4000-char rebuild path described above still exists in code and is still real — it is just
no longer the routine outcome of crossing the 60s pool TTL. It remains the fallback whenever
native load genuinely fails: sandbox recreated, a Daytona teardown, or a runner restart. Those
cases still deserve hardening (fail loud instead of silently truncating), but they are no longer
"every long Claude conversation eventually loses information" — they are "a conversation that
survives an infrastructure event may lose information," a materially smaller and rarer blast
radius.

**Likely cause of the change.** The most plausible explanation is the redeploy the other agent ran
tonight against bighetzner, which pulled in recent upstream fixes to the runner/session-continuity
path (see the STATUS PAUSED note above — QA was explicitly paused because the deployment was
mid-repair). The original 96/96 `mode=create` observation predates that redeploy and was never
re-run against the rebuilt stack until tonight's experiment. See LESSONS.md for the general rule
this produced: re-run any blocker-level finding after a redeploy before trusting it.

**F-8 (open, DX blocker) — `/api/tools/discover` returns a tool object that the agent config
REJECTS. The discover -> configure round trip is broken.**

Discovery hands back a ready-looking gateway tool:
```json
{"type":"gateway","provider":"composio","integration":"gmail","action":"FETCH_EMAILS",
 "connection":"gmail-79x","input_schema":{...},"description":"..."}
```
Feeding that straight back into `parameters.agent.tools` fails the run with HTTP 500:
```
Invalid tool configuration: [{'type':'extra_forbidden','loc':('gateway','input_schema')},
                             {'type':'extra_forbidden','loc':('gateway','description')}]
```
`GatewayToolConfig` (`sdks/python/agenta/sdk/agents/tools/models.py:105`) accepts only
`type/provider/integration/action/connection/name` (+`permission`). `input_schema` and
`description` are legal on a **client** tool but forbidden on a **gateway** tool — and discovery
attaches them anyway.

So the obvious flow — "discover a capability, put it on your agent" — 500s. Our own builder agent
and any SDK user hits this. Fix: either have discovery emit the config-shaped object, or have
`GatewayToolConfig` ignore the two informational keys.

Second, smaller trap in the same area: **the action name has no integration prefix.** It is
`FETCH_EMAILS`, not `GMAIL_FETCH_EMAILS`. Guessing the prefixed name (which appears inside the
tool's own description text) fails the run with
`Gateway tool resolution failed: Action not found: composio/gmail/GMAIL_FETCH_EMAILS (HTTP 404)`.

Once the extra keys are stripped, Gmail AND GitHub gateway tools resolve and execute correctly on
`pi_core`/`local`.

**F-7 (CONFIRMED, blocker for Daytona) — on Daytona, the durable mount is SKIPPED when the object
store is in-network, so files do not persist across turns. Silently.**

Confirmed at the log level on the settled stack (session `226c563d`):
```
[sandbox-agent] tunnel discovery failed: fetch failed
[sandbox-agent] [timing] stage=mounts ms=2            <- 2ms: nothing was mounted
[sandbox-agent] harness=pi_core sandbox=daytona cwd=/home/sandbox/agenta/mounts/...  <- unbacked
```
And separately: `reconnect failed sandbox=daytona/… from state 'destroyed', creating fresh` — the
Daytona sandbox is being destroyed between turns, so there is no fallback either.

### Why this hits EVERY self-hoster, and why we could never have seen it in dev

The full chain, all verified in the repo:

1. A **remote** sandbox can mount the store directly only if the store is **publicly reachable**
   (`mount.ts:181`). Otherwise the runner needs a **tunnel** (`mount.ts:505-537`).
2. The tunnel is **ngrok**, and ngrok is a service in **`docker-compose.dev.yml` ONLY** — both
   `gh` composes (OSS and EE — the ones self-hosters actually run) have **no tunnel service**.
3. PR **#5315** ("bundle SeaweedFS store in gh.local and gh.ssl") just added the store to `gh`,
   bound to **loopback** with **`traefik.enable=false`**:
   ```yaml
   ports:  ["${AGENTA_STORE_PORT:-127.0.0.1:8333}:8333"]
   labels: ["traefik.enable=false"]
   # "In-network services reach it directly at seaweedfs:8333, no publish needed."
   ```
   Correct for the API and runner. **A Daytona sandbox is not in-network.**
4. So on a `gh` deployment + Daytona + the bundled store: sandbox cannot reach the store ->
   tunnel discovery finds nothing -> `mount.ts` **skips the mount, "not fatal"** -> the agent runs
   in an unbacked directory -> **every file it writes is lost**, silently, with a normal-looking UI.

**The fix for F-1 (bundling the store) is what makes F-7 universal.** And the reason it survived
until now: **dev ships ngrok, `gh` does not** — our development environment contains a component
our shipping environment lacks, so this class of bug is invisible to us by construction. That is
the process finding, and it is worth more than the bug.

Options: publish the store to the sandbox (route it through Traefik with auth), ship a tunnel in
`gh`, document "Daytona requires a publicly reachable S3", or — at minimum, and regardless —
**stop failing open**: a remote sandbox that cannot attach its durable mount must ERROR, not
silently degrade to an ephemeral cwd.

C4 (pi_core / **daytona**) failed the mount journey while C3 (pi_core / **local**) passed it, same
driver, same model. Turn 1 wrote a token to `qa-mount.txt` and reported WROTE; turn 2's `cat` came
back **empty**.

Mechanism, from `services/runner/src/engines/sandbox_agent/mount.ts`:
- `:181` — a remote sandbox can mount the store directly only if the store is **publicly
  reachable**; an in-network store needs a **tunnel**.
- This deployment's store is `AGENTA_STORE_ENDPOINT_URL=http://seaweedfs:8333` — in-network. A
  Daytona sandbox out on `daytonaproxy01.eu` cannot reach that host.
- `:505` — when no tunnel is up, "the remote mount is **skipped, not fatal**".

So the Daytona agent runs with an ephemeral cwd inside the remote sandbox, the turn succeeds, the
UI looks normal, and the files are gone at the next turn. **This is F-1 all over again — the same
fail-open shape, one layer down.** F-1 is fixed for `local`; the Daytona half was still broken
after the store landed.

NOT YET CONFIRMED at the log level: I was about to grep the runner for the tunnel/skip lines when
QA was paused for the deployment repair. Confirm with:
`docker logs agenta-oss-team-runner-1 | grep -iE 'tunnel|remote mount|skipped'` on a fresh Daytona
run, then re-run `uv run qa_product.py --cell C4 --only mount`.

If confirmed, the fix is one of: expose the store publicly to Daytona sandboxes, stand up the
tunnel, or — at minimum — **stop failing open**: a skipped durable mount on a remote sandbox must
surface, not silently degrade to an ephemeral cwd.

**F-6 (open, moderate) — the generic permission Policy control does not govern Claude's builtin
tools.** The playground's Permissions section shows a **Policy** select (`allow_reads` / `allow` /
`ask` / `deny`) that is NOT conditional on harness, with the help text "Deny all — Every tool call
is refused" and "Ask — A human approves every tool call". On Claude, `runner.permissions.default`
only renders rules for tools delivered over the internal `agenta-tools` MCP server
(`sdks/python/agenta/sdk/agents/adapters/claude_settings.py:134`); it renders **nothing** for
Claude's own builtins (Bash/Terminal, Write, Edit). Those are governed only by `harness.permissions`
(the separate Claude-only control) plus Claude Code's own command classifier.

Measured on C1 (claude/local), holding the tool fixed and varying only the policy:

| Policy | read-only `echo` | mutating `echo > file` |
|---|---|---|
| unset (`allow_reads`) | runs, no gate | gate fires (correct) |
| `ask` | **runs, no gate** | gate fires |
| `deny` | **runs, no gate** | refused (correct) |

So the dangerous operations ARE gated correctly on Claude — via Claude's own classifier, not via
our policy. The defect is narrower than it first looked: **a user who selects "Deny all" on Claude
still gets read-only shell commands executing**, contradicting the UI's own help text. Fix by
either making the Policy control harness-aware (hide/annotate it for Claude) or by translating the
policy into Claude builtin rules.

**Same mechanism explains a UI-exploration finding filed as a HIGH persistence bug.**
`ui-exploration-20260714.md` bug 1 originally read "one Terminal approval becomes a permanent
grant; Policy=Ask not enforced." A follow-up investigation (2026-07-14, live probes + code trace)
found no persisted grant: approvals are answered once-only, no settings file is written, and a
mutating command re-gates every time including in new sessions. The "Terminal never asked again"
runs were read-only commands auto-approved by Claude Code's own classifier under Ask — this table's
`ask` / read-only `echo` row. Downgraded from HIGH (security persistence) to MEDIUM (policy-label
gap), same family as F-6 above; entry corrected in place with the original observation kept for the
record.

**RETRACTED (was reported as a Claude permission bypass):** an earlier reading of this — "`ask`
silently drops the tool call on Claude" — was **model non-determinism**, not a defect: the model
simply chose not to call bash on that run. On rerun the gate fired correctly. Recorded here
because it is exactly the failure mode this driver exists to prevent, and I nearly shipped it as a
finding.

**F-4 (open, minor) — `code` tools are accepted by the SDK and rejected at run time by the sidecar.**
`CodeToolConfig` exists in the SDK, but the product path hard-fails with "Code tools are not
supported by the sidecar." (`services/runner/src/tools/code.ts`). The playground UI does not offer
code tools, so a UI user cannot hit this — but an SDK user can configure one and only find out at
run time. Either reject at config time or support them.

**F-5 (open, wire hygiene) — `tool-input-available` carries INCOMPLETE input, and `toolName`
changes case mid-stream.**
The frame is emitted repeatedly for a single tool call with a progressively-built partial input:
```
toolName "bash"  input {"command": "echo \"QA-BASH-"}          <- partial
toolName "bash"  input {"command": "echo \"QA-BASH-$(hostname"}
toolName "Bash"  input {"command": "echo \"QA-BASH-$(hostname)\""}   <- complete; name case flips
```
A client that reads the first frame — a reasonable reading of "available", given
`tool-input-start` already exists for the streaming phase — approves a **truncated command under
the wrong name**. The runner keys approval decisions by name+args, so the decision then misses the
parked gate and the approval **re-parks forever** (the agent asks for the same approval on every
turn). This cost real debugging time in the driver and would cost an integrator the same.

**F-2 (open, testability) — warm/cold is not observable from the browser.** The UI has no warm/cold
concept (`sessionStatusAtomFamily` is only running/awaiting/error/idle) and the wire does not carry
it. Only the runner log knows. Means J6 can never be a CI test until the wire carries it. See
`playwright-testability.md`.

## Two things that need Mahmoud

1. **RESOLVED 2026-07-14: Anthropic key funded.** C2 ran the full six-journey set on the vault key,
   all green (`runs/20260714-215309`). Replaced by a NEW ask: **the OpenAI vault key is out of
   quota** — C3/C4 (vault `openai` provider) fail chat with a clean "insufficient credit" error
   (`runs/20260714-214326`). The Codex-subscription path (S1) is unaffected.
2. **P2 needs the raw OpenRouter key** (or a `custom_provider` secret slug created in the UI).
   Secrets are encrypted at rest, so the key already in the vault cannot be read back. P2 tests
   OpenRouter as a **custom OpenAI-compatible provider** (`base_url = https://openrouter.ai/api/v1`)
   — the path every self-hoster with a proxy or a local vLLM uses, and the least-travelled one.

## Phantom failures — do not trust results from a stack mid-restart

A full matrix run at 17:51 showed every Pi cell failing with HTTP 500 (`Could not verify
credentials: … returned unexpected status code 404`, and a JSON decode error). **These were not
product bugs** — the other agent was recreating the api/cron/worker containers at that moment.
Re-running against the settled stack turned them all green. Likewise a UI-visible
`404 on /api/workflows/revisions/resolve` and a burst of
`[sessions/persist] DROPPED … after 3 retries: fetch failed` + `getaddrinfo ENOTFOUND api` in the
runner: all from the same restart window, all unreproducible afterwards. Rule for this pass:
**never diagnose from a run that overlapped a container restart — re-run first.**

(The `DROPPED` behaviour is still worth a look on its own: session records — tool calls, results,
usage — are dropped after 3 retries and the turn proceeds regardless. Fail-open again, though the
trigger here was legitimate.)

## Recovery

If everything is lost: read this file, then `playwright-testability.md`, then
`scripts/qa_product.py` (the driver). The credentials are in `~/.agenta-bighetzner.env`. Nothing
in this pass mutates the deployment except through the product's own API, so there is nothing to
roll back.
