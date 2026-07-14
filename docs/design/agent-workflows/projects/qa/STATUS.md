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
| J5 | Commit | `data-committed-revision` frame + revision version bumps |
| J6 | Warm/cold | Turns 2-3 faster than 1; runner log confirms session **loaded**, not silently cold; conversation continues coherently after a forced cold restart |

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
| C3/C4/P1 (Pi cells) | DONE — see matrix below |
| C1/C2 (Claude cells) | **BLOCKED — Anthropic key out of credit** |
| P2 (custom OpenAI-compatible provider) | **BLOCKED — needs the raw OpenRouter key or a custom_provider slug** |
| UI end-to-end pass | PARTIAL — approval dock verified end-to-end; rest blocked on credit |
| J5 commit journey | NOT STARTED |

**PAUSED 2026-07-14 ~18:05: the deployment is being repaired by the other agent (mounts work in
flight, "some things got screwed up"). Do NOT run anything against bighetzner until Mahmoud says
go — a stack mid-restart produces phantom failures (see the retracted 500s note below).**

## Matrix (last good run: runs/20260714-175715, Pi cells; Claude from runs/20260714-174932)

| cell | harness | sandbox | model | chat | mount | tool | approve | deny | warm |
|---|---|---|---|---|---|---|---|---|---|
| C1 | claude | local | sonnet | PASS | — | PASS | PASS | PASS | — |
| C2 | claude | daytona | sonnet | PASS | — | PASS | PASS | PASS | — |
| C3 | pi_core | local | gpt-5.6-luna | PASS | PASS | PASS | PASS | PASS | PASS |
| C4 | pi_core | daytona | gpt-5.6-luna | PASS | **FAIL** | PASS | PASS | PASS | PASS |
| P1 | pi_core | local | openrouter/deepseek-v4-flash | PASS | PASS | PASS | PASS | PASS | PASS |

Warm/cold looks healthy where measured: C3 4444ms -> 1166/1130ms; C4 12189ms -> 1699/1392ms.
(Latency only. The cold/warm TRUTH is in the runner log — see F-2.)

**OpenRouter as a native provider (P1) is fully green.** That answers one of the two provider
questions.

## Triage: product bug vs deployment artifact

The question that decides what blocks the release. "Deployment-independent" means the defect is in
code that behaves the same everywhere; it cannot be configured away.

| # | Finding | Class | Reasoning |
|---|---|---|---|
| F-5 | `tool-input-available` streams a PARTIAL command; toolName flips case | **BUG, deployment-independent** | Pure wire behavior from `stream.py`. Same on every stack. |
| F-6 | Permission Policy control does not govern Claude's builtins | **BUG, deployment-independent** | `claude_settings.py:134` only emits rules for MCP-delivered tools, never for Claude's own Bash/Write/Edit. Not configurable. |
| F-8 | `/tools/discover` output is rejected by the agent config | **BUG, deployment-independent** | Schema contradiction: discovery attaches `input_schema`/`description`; `GatewayToolConfig` forbids extra keys. |
| F-3 | Pi permission layer fails OPEN (ask/deny become no-ops) | **BUG (fail-open) + image-specific TRIGGER** | The `try/catch` swallow in `pi-assets.ts:349` is on every deployment. The trigger here is the image (no `/pi-agent`, non-root). Expect NOT to reproduce on our root-ful dev image — which does not make it safe: a read-only rootfs, a k8s securityContext, or a custom `PI_CODING_AGENT_DIR` re-arms it. **It was live on the stack we are shipping from.** |
| F-7 | Daytona durable mount silently skipped -> files never persist | **BUG — RELEASE BLOCKER, hits every self-hoster on Daytona** | CONFIRMED, see below. Our dev stack structurally cannot reproduce it. |
| F-1 | Mounts 503 -> agent runs in a throwaway `/tmp` cwd | FIXED (config) + BUG (fail-open) | Store was simply not deployed. The fail-open half is the same defect as F-3/F-7. |
| F-9 | **Claude harness NEVER resumes its native session** (`mode=create`, always) | **BUG, deployment-independent — CONFIRMED on BOTH stacks** | See below. Reproduced on our own dev stack across 72h of real traffic: **96 claude sessions, 96 `mode=create`, ZERO `mode=load`**, and the `[continuity]` line never once names claude. `pi_core` on the same stack: 50 loads / 21 creates. This is the strongest candidate for the "long conversations lose information" report. |
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

**F-9 (CONFIRMED on both stacks, likely THE long-conversation bug) — the Claude harness never
resumes its native session. Every turn is rebuilt from a lossy hand-rendered transcript.**

Evidence from our OWN dev stack (not bighetzner), over 72h of real dogfooding traffic:

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

1. **Anthropic key is out of credit.** The UI reports "Credit balance is too low — claude: the
   model provider account has insufficient credit". Blocks C1/C2 (Claude mount + warm/cold are
   untested). Credit where due: that error message is clear, specific, and names the key to check.
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
