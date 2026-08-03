# Coverage: the cells and the journeys

The gate is the product of two lists: **cells** (the configurations under test) and **journeys**
(the user actions run against each cell). `qa_product.py` defines both; this file is the reference.

## Cells (harness × sandbox × auth)

The core axis is harness × sandbox. Provider is a sub-matrix run inside the Pi cells only, because
that is an authentication question, not a sandbox one — re-running it in all four core cells would
test the same code twice. **Auth mode is not** delegated that way: each harness assembles
subscription credentials differently (Claude reads a config dir, Pi reads its own login, Codex
assembles a `.codex` home inside the durable working directory), so every harness that supports a
subscription has its own cell — C1, S1, S2.

| Cell | Harness | Sandbox | Model | Auth mode | Why this cell exists |
|---|---|---|---|---|---|
| C1 | `claude` | `local` | `sonnet` (alias) | subscription (OAuth) | Claude on the local sandbox; the default "use my subscription" path. A full model id gets dropped to the default on the Claude ACP path, so the gate pins the `sonnet` alias (finding F-007). |
| C2 | `claude` | `daytona` | `sonnet` | vault key | Claude in a cloud sandbox. Daytona rejects subscription auth by design, so this cell genuinely needs a funded Anthropic vault key. |
| C3 | `pi_core` | `local` | `gpt-5.6-luna` | vault key (OpenAI) | Pi on the local sandbox with a managed OpenAI key. |
| C4 | `pi_core` | `daytona` | `gpt-5.6-luna` | vault key (OpenAI) | Pi in a cloud sandbox; the remote-mount path that surfaced the silent file-loss finding (F-7). |
| P1 | `pi_core` | `local` | `openrouter/deepseek/deepseek-v4-flash` | vault key (OpenRouter) | OpenRouter as a first-class native provider. |
| S1 | `pi_core` | `local` | `gpt-5.6-luna` | subscription (Pi, `openai-codex` provider) | **Pi** authenticating from a ChatGPT/Codex subscription through the sidecar, independent of any vault key. Not the Codex harness — see S2. |
| X1 | `codex` | `local` | `gpt-5.6-luna` | vault key (OpenAI) | The native Codex harness with a managed key. Since the D-008 amendment (2026-07-31, patched bridge), Agenta-tool calls raise codex-native approval gates that park warm, and the `approve`/`deny` journeys RUN for codex with an MCP-shaped probe (the `list_connections` platform tool, per-tool `ask`) instead of the builtin-shell probe. Only `mcp` (Claude-only) and `mount` still SKIP (see below). |
| X2 | `codex` | `daytona` | `gpt-5.6-luna` | vault key (OpenAI) | Codex in a cloud sandbox. Exists for the continuity tiers: a `cold2` resume can only COMPLETE on a remote sandbox (on local it correctly refuses), so without this cell the gate can never observe a finished codex cold 2. Verified out of band during the v0.108.0 release run; promoted into the gate. |
| S2 | `codex` | `local` | `gpt-5.6-luna` | subscription (Codex OAuth, `runtime_provided`) | **The genuine Codex-subscription cell**: the codex harness with the operator's mounted ChatGPT/Codex login. The only cell that exercises the subscription file assembly — `CODEX_HOME` pointed at `<cwd>/.codex` and `auth.json` symlinked into the **durable** working directory. That link is the one credential path an object-store round trip can destroy (#5692). Local-only (Daytona rejects `runtime_provided`), and needs the subscription sidecar. |
| P2 | `pi_core` | `local` | `<slug>/custom/deepseek/deepseek-v4-flash` | custom OpenAI-compatible provider | OpenRouter reached as a custom OpenAI-compatible endpoint — the path every self-hoster with a proxy or local vLLM uses, and the least-travelled one. Needs a `custom_provider` vault slug; pass `--custom-slug` (the driver then sends the full `<slug>/custom/<model>` key and connection mode `agenta`, which is what v0.107.x resolver semantics require). |

The Codex cells (`X1`, `X2`, `S2`) run `chat`, `tool`, `commit`, `warm`, `cold1`, `cold2`,
`approve`, and `deny`; `mcp` SKIPs (Claude-only) and `mount` SKIPs with a codex-specific reason:

- `approve` / `deny` RUN for codex with an MCP-shaped probe. The shared shell probe cannot park a
  codex run — codex only raises exec (shell) approval when its filesystem sandbox is restricted,
  and the default `agent-full-access` is not — but codex MCP/Agenta TOOL calls raise codex-native
  `tool-approval-request` frames that park warm since the D-008 amendment (2026-07-31, the
  patched codex-acp preset). So on codex the journey drives the self-contained
  `list_connections` platform tool with per-tool `ask` instead of the `bash` builtin; the flow
  and assertions are identical. Background QA:
  `docs/design/codex-harness/reports/warm-approvals-qa.md` (driver:
  `spike/scripts/codex-approval-matrix-qa.py`).
- `mount` reads its token from a builtin-shell `tool-output-available` payload. Codex runs shell
  through native ACP exec frames whose output is not in that payload field, so the probe cannot
  extract the token even when the file persisted. A codex-shaped mount probe is a follow-up.

The pinned models and connection modes are the gate's **fixtures**: each is chosen for a reason
(alias vs full id on Claude, subscription vs vault where the sandbox forces it, a healthy provider
for the long-context probe). The inline comments in `qa_product.py` carry the specific reason per
cell — keep them in sync if a cell changes.

## Journeys (run in every applicable cell)

| Journey | What it does | Passes when |
|---|---|---|
| `chat` | Create an agent, send one message. | The turn completes with a `finish` frame, not an `error`. |
| `mount` | Write a file in turn 1, read it back in turn 2. | The file survives across turns — proof the durable mount is real, not a throwaway `/tmp` cwd. |
| `tool` | Call a tool whose return bakes in an unguessable token. | The token appears in the reply, so the tool provably ran (the model cannot guess it). |
| `approve` | Raise an approval, then approve it. | The approved tool call continues via the in-band approval protocol the browser uses. |
| `deny` | Raise an approval, then deny it. | The denied path is handled cleanly (no phantom failure, no re-parking forever). |
| `commit` | Save an agent config as a new workflow revision, then fetch it back. | The changed parameter survives the round trip and the version bumps (v0 seed → v1; see LESSONS #14). Harness-agnostic — it drives the config REST API, not a turn. |
| `warm` | Continuity tier 1: three turns on one live daemon, over a store-backed cwd. | The durable token written in turn 1 comes back in the last turn, and the turn ledger shows one harness session and one sandbox (a second id means the turn was not warm). |
| `cold1` | Continuity tier 2: the pooled session is **evicted** (the client changes the agent's instructions, which changes the config fingerprint) and the runner rebuilds it — unmounting and remounting the durable cwd. | The token survives the store round trip AND the agent can read a file the client wrote directly into the object store. |
| `cold2` | Continuity tier 3: the runner **replica is replaced** (operator hook: SIGKILL, then wait out the owner TTL plus a margin). | On a **local** sandbox the resume must REFUSE (the runner's `… is not the owner of session …`, the substring the driver asserts); on a remote sandbox it must complete with both files intact. SKIPs without `--cold2-replace-cmd`. |
| `mcp` | Deliver an MCP server in the agent config and call one of its tools. | A `tool-output-available` frame fires for an `mcp__*` tool. **Claude only** — Pi rejects user MCP, so this `SKIP`s on every Pi cell. Uses the public DeepWiki server by default; override with `--mcp-url`. |
| `rule_deny` | Policy `allow`, plus a `deny` rule for `Bash`. Ask for a bash command. | The model still attempts the call (the tool is not hidden), the call never executes, no approval card appears, and no real shell token reaches the reply. **Pi only.** |
| `rule_allow` | Policy `ask`, plus an `allow` rule for `Bash`. Ask for the same command. | No approval card fires and the call executes — the rule overrode the policy. **Pi only.** |
| `rule_case` | The same as `rule_allow` with the rule written `bash`. | Identical result: the runner matches built-in names case-insensitively. **Pi only.** |
| `builtin_grep` | Policy `allow_reads`. Write a file with bash, then grep it. | A `grep` call executes with no approval card — grep is one of the three built-ins Pi does not activate on its own, and it is read-only, so it runs unattended. **Pi only.** |

The four rule journeys are the only coverage of `harness.permissions`. Built-in tools are always
active and are never listed in `tools`, so those three lists are the only lever over them: if they
stop being honored, nothing else in the gate notices.

Triggers are deliberately **out of scope** for this gate.

## Continuity: the third dimension (warm / cold 1 / cold 2)

The tier names are the ones the codex approvals QA already uses
([`docs/design/codex-harness/reports/warm-approvals-qa.md`](../../../../docs/design/codex-harness/reports/warm-approvals-qa.md)):
**warm** = same daemon, same live mount; **cold 1** = session evicted, runner alive; **cold 2** =
runner replica replaced. `warm`, `cold1` and `cold2` run in EVERY cell — every harness, every
credential mode — because the tier is a property of the runtime, not of a harness.

**The object store is a precondition, not a detail.** The session working directory is a geesefs
mount over S3, and it only makes the round trip through the store when something unmounts and
remounts it. That round trip is what a continuity cell exists to exercise: anything the store
cannot represent (a symlink — #5692; SQLite WAL, already designed around via `CODEX_SQLITE_HOME`;
hard links) comes back wrong on the far side. On a deployment with no store configured, the
runner degrades **silently** to an ephemeral directory (`mount.ts`: "running without this mount"
→ `mount degraded kind=session_cwd`) and every turn still looks fine. So the journeys resolve the
session's durable mount through `GET /api/sessions/mounts/?session_id=…` first and refuse to
report a pass without one: **SKIP** by default, **FAIL** with `--require-store`. Pass
`--require-store` on any deployment that is supposed to have a store — it is what stops "the
store was not in play" from reading as green.

**What proves the tier.** Nothing about warm-vs-cold reaches the SSE stream, so the journeys
layer four kinds of evidence and the results carry all of them:

1. The client reads `qa-cwd.txt` (written by the agent, content generated by the sandbox's own
   shell) straight out of the store via `GET /api/mounts/{id}/files?read=…` — proof the cwd is
   durable, and how the client learns a token the transcript never carried.
2. The agent reads that same token back after the transition — proof the directory survived it.
3. The client writes `qa-store.txt` into the store; on the cold tiers the agent must be able to
   `cat` it — content that only ever existed as an object cannot reach the agent unless that
   turn's cwd resolves to that store prefix.
4. The turn ledger (`POST /api/sessions/turns/query`) reports `agent_session_id` and `sandbox_id`
   per turn. `warm` asserts they did not change; the cold tiers report them as corroboration.

Every result also carries the runner-log grep that settles the tier definitively —
`[keepalive] hit-continue` (warm), `[keepalive] mismatch (config) …; evict + cold` (cold 1), a
fresh `[keepalive] miss …; cold` from a replica id you have not seen before (cold 2) — and any
**0-byte objects** found in the durable cwd, which is the store-side fingerprint of an entry S3
cannot represent.

**The cold-2 method, stated (the wrong method measures the wrong thing).** `--cold2-replace-cmd`
must SIGKILL the runner replica (`docker kill -s KILL <runner>`), never `docker stop`/`restart`:
on SIGTERM the runner runs its shutdown handler and destroys every sandbox it owns, including the
session under test. The driver then waits `--owner-ttl` seconds (default 120,
`AGENTA_SESSIONS_REDIS_OWNER_TTL_SECONDS`) because the killed replica never released
`owner:session:<id>` and `claim_owner` never steals from an owner that still looks live; resuming
inside that window fails for an unrelated, misleading reason (#5611). The driver waits the TTL
**plus a 20s margin**, because the key lapses at the boundary and the replacement replica may
still be starting; the hook itself is bounded (3 minutes) and must return once the replacement is
serving. Expected results differ per
sandbox: a **local** sandbox lives inside the runner process, so a replacement replica genuinely
cannot adopt it and the correct outcome is a loud refusal; a **remote** sandbox resumes cold. If
the deployment pins `AGENTA_RUNNER_REPLICA_ID`, the replacement replica is not a *different*
replica as far as the owner key is concerned and the local cell will resume instead of refusing —
unset it for a genuine cold 2.

## What each cell needs beyond the three env vars

| Requirement | Cells |
|---|---|
| Store-backed deployment (`AGENTA_STORE_*` set) for `warm` / `cold1` / `cold2` | all — the journeys SKIP without it, FAIL with `--require-store` |
| Daytona configured | C2, C4, X2 |
| Funded Anthropic vault key | C2 |
| OpenAI vault key | C3, C4, X1, X2 |
| OpenRouter vault key | P1 |
| `custom_provider` vault slug (`--custom-slug`) | P2 |
| Subscription sidecar — Claude login mounted (`CLAUDE_CONFIG_DIR`) | C1 |
| Subscription sidecar — ChatGPT/Codex login mounted (Pi's `~/.pi/agent/auth.json`) | S1 |
| Subscription sidecar — ChatGPT/Codex login mounted read-write with `CODEX_HOME` naming it | S2 |
| Operator hook that SIGKILLs the runner (`--cold2-replace-cmd`) | `cold2` in every cell |

## Optional probes (`qa_longctx.py`)

Separate from the gate, these need live **Gmail and GitHub Composio connections** in the target
project. Skip them if the project has none.

| Probe | What it catches |
|---|---|
| `memory` | Plant a token, flood the context with bulky tool output across many turns, then ask for the token back. Catches compaction dropping early context. |
| `gmail` | The Gmail/GitHub gateway tools resolve and actually execute. Read-only actions only — writes (SEND/REPLY/CREATE/…) are filtered before they reach an agent. |
| `concurrent` | N sessions run at once, each holding a different token. Catches cross-session bleed a single-session test can never see. |
