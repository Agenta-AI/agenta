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
| P2 | `pi_core` | `local` | `<name>/custom/deepseek/deepseek-v4-flash` | custom OpenAI-compatible provider | OpenRouter reached as a custom OpenAI-compatible endpoint — the path every self-hoster with a proxy or local vLLM uses, and the least-travelled one. Needs a `custom_provider` vault slug and display name; pass `--custom-slug` plus `--custom-name` (the driver sends the full `<name>/custom/<model>` key and connection mode `agenta`). |
| P2b | `pi_core` | `local` | `<name>/custom/deepseek/deepseek-v4-flash` | custom OpenAI-compatible provider, `provider` SET | P2 with `provider: "openai"` — the shape the PLAYGROUND saves for a named custom connection, which P2 cannot cover because it pins `provider: None`. A set provider prefixes `to_model_string()`, and `Connection.selected_model_id` used to compare only against that, so the `<name>/custom/<model>` namespace was never stripped and the provider got the namespaced id and returned 403. Regression guard: every custom connection picked in the playground rides this path. Needs both `--custom-slug` and `--custom-name` because `model_keys` is built from the display name. |
| H1 | `pi_core` | `local` | `gpt-5.3-codex-spark` | hosted subscription (`self_managed` + slug) | The user's own ChatGPT subscription, signed in ONCE through the product and stored in the project's vault, then delivered to the sandbox that runs the turn. S1 and S2 read a login the OPERATOR mounted into the runner, so they only ever prove the self-hosted case: nothing else in the matrix sees the store, the delivery, the refresh push-back, or the per-project isolation. Needs a connected subscription in state `ready`; both hosted cells SKIP with the reason when there is none. |
| H2 | `pi_core` | `daytona` | `gpt-5.3-codex-spark` | hosted subscription (`self_managed` + slug) | The same connection on a REMOTE sandbox. The delivery is a different mechanism there: the login is written to the sandbox VM's own disk and a refreshed copy is read back by a poll rather than by a file watch, so a local pass says nothing about it. This is also the only hosted cell where the sandbox, not the runner, holds the credential. |
| P3 | `pi_core` | `daytona` | `<name>/custom/deepseek/deepseek-v4-flash` | custom OpenAI-compatible provider | P2 on a REMOTE sandbox. v0.108.1 validates a credentialed connection's endpoint far more strictly on Daytona, because that host is what the credential's Secret is pinned to: plain HTTPS, default port, real fully-qualified hostname. A self-hosted proxy on a non-default port — an ordinary setup — is now refused where it worked in v0.108.0. P2 is local-only and a local sandbox never builds a secret plan, so nothing in the gate could see that rejection until this cell. Needs `--custom-slug` plus `--custom-name`. |

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
| `park` | Continuity tier 3: the session **idles out** with nothing changed, so the pool expires it and the sandbox is PARKED (stopped, not deleted); the next turn must reconnect to that same sandbox. | Both files come back AND the turn ledger shows exactly ONE sandbox id across the turns — a rebuild would show two, which is what `cold1` reports on the same deployment. The harness session id deliberately stays the same (preserving it is what the session-continuity store is for), so it is not a signal here. **Daytona only.** This is the resume users actually hit, because the pool TTL is two minutes, and on Daytona it is the only tier that proves a credential Secret still resolves after a stop/start. Tune the idle with `--park-wait`. |
| `cold2` | Continuity tier 4: the runner **replica is replaced** (operator hook: SIGKILL, then wait out the owner TTL plus a margin). | The resume completes with both files intact, on local and remote alike. On local that is the point: the dead replica took its sandbox with it, so the conversation had to come back from the object store alone. A `… is not the owner of session …` refusal is a FAIL, because it means the owner key outlived the wait and the run measured the wait rather than the product. SKIPs without `--cold2-replace-cmd`. |
| `mcp` | Deliver an MCP server in the agent config and call one of its tools. | A `tool-output-available` frame fires for an `mcp__*` tool. **Claude only** — Pi rejects user MCP, so this `SKIP`s on every Pi cell. Uses the public DeepWiki server by default; override with `--mcp-url`. |
| `rule_deny` | Policy `allow`, plus a `deny` rule for `Bash`. Ask for a bash command. | The model still attempts the call (the tool is not hidden), the call never executes, no approval card appears, and no real shell token reaches the reply. **Pi only.** |
| `rule_allow` | Policy `ask`, plus an `allow` rule for `Bash`. Ask for the same command. | No approval card fires and the call executes — the rule overrode the policy. **Pi only.** |
| `rule_case` | The same as `rule_allow` with the rule written `bash`. | Identical result: the runner matches built-in names case-insensitively. **Pi only.** |
| `builtin_grep` | Policy `allow_reads`. Write a file with bash, then grep it. | A `grep` call executes with no approval card — grep is one of the three built-ins Pi does not activate on its own, and it is read-only, so it runs unattended. **Pi only.** |
| `secret_opaque` | Ask the sandbox to classify its own provider key variable and echo back a verdict word carrying a nonce this run invented. | The verdict says the value begins `dtn_secret_`, so the agent holds a Daytona Secret placeholder and not the real key. **Daytona only** (C2, C4, P3, X2); it `SKIP`s on every local cell, where the harness runs inside the runner container and there is nothing to hide it from. |
| `rotate` | Change the provider key in the vault **mid-conversation** to a decoy no provider accepts, send a turn, then put the real key back and keep talking. | The turn under the decoy must FAIL (a success means the runner kept serving the old credential), and the turn after the restore must succeed with the durable working directory intact. Skips on subscription cells, which have no vault key, and custom-provider cells, whose write-only key cannot be safely restored. The vault is restored in a `finally`. |
| `parallel` | Three sessions at once on ONE hosted connection, two turns each. | All three finish both turns. **Hosted cells only** (H1, H2); SKIPs everywhere else. A partial pass is a FAIL: "two of three worked" is the shape a lock contention bug takes, and one session can never see several sandboxes reading and rewriting one stored login at the same time. |
| `refresh` | Expire the STORED login with a pgcrypto update of its row (and, on a local sandbox, the runner's own copy too), clear the API's cached vault read, then send one turn. | The turn answers AND the stored `login_version` moves. **Hosted cells only.** A refresh that stays inside the sandbox is the same as no refresh: the next sandbox gets the dead token. SKIPs without `--db-container` and `--stack-env` (or `--subscription-expire-cmd`). |
| `dead` | Break the sandbox's copy of the login with garbage tokens at the CURRENT stored version, so there is nothing newer to fall back to and the refresh is genuinely refused. | The run reports the code `subscription_login_required` and the connection moves to `needs_login`. **H1 only** (H2 SKIPs: the copy lives on the remote VM's disk, which the driver cannot reach). A generic error would satisfy a human reader and leave the client with nothing to render. **Leaves the connection needing a human sign-in, so run it last.** |
| `relogin_needed` | Nothing. It always SKIPs. | It is a marker: signing in again is a device-code flow that needs a person, and a gate that skipped it silently could end with a connection nobody can use and no note saying so. Its reason reports the connection's current state and names the steps. **Hosted cells only.** |

The four rule journeys are the only coverage of `harness.permissions`. Built-in tools are always
active and are never listed in `tools`, so those three lists are the only lever over them: if they
stop being honored, nothing else in the gate notices.

`secret_opaque` is the only journey that checks a **security property** rather than checking that
the product works. It exists because the rest of the gate cannot see this one: a plaintext provider
key works exactly as well as a placeholder does, so if credential hiding silently stopped working,
every other journey would stay green and nothing would notice. Two details are deliberate. The classification happens INSIDE
the sandbox and only a verdict word comes back, so no key material can ever reach the results file
— an earlier version asked for the first 11 characters, which is safe only while hiding works and
would have written a slice of a real key into the transcript on the exact failure this journey
exists to catch. And the verdict word carries a per-run nonce, so it cannot pass on an absence: a
refused call, an unset variable, or a model that declined all read as FAIL, not as "no key was
leaked". Carrying the proof in the nonce rather than in a tool-call frame is also what lets it run
on the codex harness, whose shell goes through native exec frames the tool-call probe cannot read.

`rotate` is the other security-shaped journey. Credential VALUES are deliberately excluded from the
session config fingerprint and live only in a separate credential epoch, so that epoch check is the
only thing standing between a rotated key and a warm sandbox that goes on using the old one. Nothing
else in the gate would notice if it stopped working, because a stale key still answers.

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
| Daytona configured | C2, C4, P3, X2 |
| Funded Anthropic vault key | C2 |
| OpenAI vault key | C3, C4, X1, X2 |
| OpenRouter vault key | P1 |
| `custom_provider` vault slug and display name (`--custom-slug`, `--custom-name`) | P2, P2b, P3 |
| Subscription sidecar — Claude login mounted (`CLAUDE_CONFIG_DIR`) | C1 |
| Subscription sidecar — ChatGPT/Codex login mounted (Pi's `~/.pi/agent/auth.json`) | S1 |
| Subscription sidecar — ChatGPT/Codex login mounted read-write with `CODEX_HOME` naming it | S2 |
| Operator hook that SIGKILLs the runner (`--cold2-replace-cmd`) | `cold2` in every cell |
| A hosted subscription connection in the project, signed in and `ready` (`--subscription-slug`, default `chatgpt`) | H1, H2 |
| A reachable runner replica for `docker exec` (`--runner`) | `refresh` and `dead` on H1 |
| The stack's postgres container and its env file, for the pgcrypto expire of the stored login (`--db-container`, `--stack-env`, and `--db-name`/`--db-user` when they are not the defaults) | `refresh` on H1, H2 |
| The stack's redis container, so the expiry is not hidden by the API's cached vault read (`--redis-container`) | `refresh` on H1, H2 |

**The hosted cells end a run with a human step, and that is deliberate.** `dead` proves the
failure a user actually meets, and proving it means killing the login. There is no way back
without a person: the sign-in is a device code approved inside the subscription account. So run
the hosted journeys in this order, `dead` last, and read `relogin_needed`'s reason before closing
the run:

```bash
STACK="--db-container <postgres> --redis-container <redis> --stack-env <env file>"
uv run resources/qa_product.py --cell H1 --only chat --only parallel --only refresh \
  --runner <runner> $STACK
uv run resources/qa_product.py --cell H2 --only chat --only parallel --only refresh $STACK
uv run resources/qa_product.py --cell H1 --only dead --only relogin_needed --runner <runner>
```

`refresh` expires the stored login itself: it decrypts the connection's row with the stack's
`AGENTA_CRYPT_KEY`, moves `login.expires` into the past, and encrypts it again. The key is read
from `--stack-env`, handed to the container through its environment, and never printed or placed
on a command line. Two details decide whether the journey measures the product or measures a
cache. The API caches its vault read for 5 minutes and only invalidates it on a write made
THROUGH the API, so `--redis-container` clears that read; without it, raise
`--subscription-cache-wait` past 300 seconds. On a local sandbox the runner's own copy is expired
too, because the materialize rule correctly prefers the newer stored copy and no refresh would
ever happen.

Where the driver cannot reach the database, `--subscription-expire-cmd '<hook> {secret_id}'`
replaces both flags with an operator hook that does the same thing. It wins when both are given.

## Standalone interaction-card lifecycle cells

These cells run beside the harness matrix because they pin durable interaction-row composition,
not a harness, sandbox, or provider model axis.

| Cell | Tier | What it pins | Extra requirement |
|---|---|---|---|
| `matrix_i1_settlement.py` | coached, mechanism-level | The 3 card kinds x complete/decline/walk-away table against the live API. Answered form/connect rows must be `responded` with their exact resolution; approvals must be `resolved` with a strict verdict; abandoned rows must be swept from `pending` to `cancelled` without an invented answer; non-approval `resolved` attempts must return 409. The script sends the atomic transition itself because that write belongs to the browser. | none beyond the three gate environment variables |
| `matrix_gw1_gateway_tools.py` | coached, one mechanism-blind leg | The gateway tool surface against a real provider, in three legs. **search**: `search_tools` offers the allowed and ask tools and the DENIED key never appears in the payload the model reads. **allow_run**: the allowed tool executes unattended and returns a genuine provider result, asserted on the wire rather than on the model's word for it. **ask_run**: the SAME tool, re-gated to `ask` so policy is the only variable, parks; its stored row names the right integration and tool key; it is answered through the **interactions API**, the durable plane a reloaded browser uses and the one no other cell exercises; the row ends `resolved`/`approved`. Every leg folds `check_no_silent_turn`. | one valid Composio connection (defaults to the no-auth `text_to_pdf`; `--integration` / `--connection` to move it) and a working model provider |
| `matrix_i2_card_journeys.py` | coached, mechanism-level | The six scripted journeys from `docs/design/client-tool-interaction-lifecycle/qa.md`: compound form/reload/connect-decline/schedule, form then connect, two connects, close/reopen, real Telegram create/remove/re-create, and decline/retry. Reload and reopen are fresh row/record reads, not browser automation; each journey names its wire-level limit. The Telegram journey validates a real bot against Telegram's own API and drives Agenta's connection lifecycle, but STOPS before entering the credential on the provider's hosted page — that step is browser-only, so the connection never reaches `is_valid` and the journey reports the gap in `not_covered`. Run qa.md journey 5 by hand in exploratory QA. | a funded model connection for the two same-session/record probes; `TELEGRAM_BOT_TOKEN` for the real Telegram journey |

I2 reports an unset `TELEGRAM_BOT_TOKEN` as a loud journey `SKIP` and makes the aggregate cell
`SKIP`. Five passing wire-level journeys must never make the untested real-provider claim look
green. The token is read from the process environment only and is never printed or stored in the
result.

## Session-context cell (`matrix_n1_session_context.py`)

The per-turn session facts are the agent's display name, the session's name, and the first-turn
flag. They reach the harness only as prompt text (`turnContext`), so no SSE frame carries them and
no stored row records them. Every cell above reads frames and side effects, which is why the whole
matrix stayed green while the playground delivered no facts at all (#6661).

| Cell | Tier | What it pins | Extra requirement |
|---|---|---|---|
| `matrix_n1_session_context.py` | journey, with two controls | A rename between two turns must reach the agent on the path the playground posts (`{BASE}/services/agent/v0/invoke`), the agent's own display name must reach it too, and a client-supplied `meta.session_context` must be ignored. | a working model provider for the selected harness |

**Why this cell asserts on model prose, which the gate otherwise refuses.** There is no
deterministic surface. `turnContext` is a prompt string on the service-to-runner `/run` payload,
the runner prepends it and logs nothing, and it is deliberately excluded from `request.messages`
and from persisted user input so a replay cannot duplicate it. The stored turn row carries harness,
sandbox, and timing only. The transport half is pinned by unit tests instead
(`sdks/python/oss/tests/pytest/unit/agents/test_wire_contract.py` for the payload field,
`services/runner/tests/unit/sandbox-agent-orchestration.test.ts` for the prepend); the cell owns
the journey. If a later change ever exposes the text on the wire or in a row, assert on that and
demote the prose half to corroboration.

**What makes the prose evidence honest.** Every fact the cell asks for carries a random token
minted for the run and spoken nowhere in the conversation, so a transcript-derived answer cannot
match. The second ask is the exact shape of #6661: by then the FIRST name is in the transcript,
from the agent's own previous reply, and the second name exists only in the stored header.

**Two controls, so a FAIL cannot be blamed on the model.** An echo probe opens the session and
must come back with a literal token from its own user message, or the cell reports INCONCLUSIVE.
Every rename is read back from `GET /sessions/streams/` before the ask, so a rename that did not
land fails as a rename rather than as a transport defect.

**The forged step is the security half.** `meta` is client input on this path, so a browser can
hand the agent forged facts. The API's stamp drops a caller-supplied `session_context` on purpose:
a client must not be able to tell the agent an unnamed session is already named. Before #6667 the
service believed the forgery.

```bash
uv run resources/matrix_n1_session_context.py                 # pi_core on a local sandbox
uv run resources/matrix_n1_session_context.py --sandbox daytona   # the shape staging accepts
uv run resources/matrix_n1_session_context.py --harness-all   # all three harnesses
```

The sandbox is not what this cell tests: the facts are resolved in the agent service, before any
sandbox exists. It is a flag because a deployment can refuse one. Staging enables Daytona only and
answers 403 for a local sandbox, so a cell pinned to local cannot run there at all.

**Verifying a fix before it is deployed.** `AGENTA_SERVICE_BASE` moves the TURNS to an agent
service run by hand, while every API read and write still goes to `AGENTA_BASE`. That is how this
cell was signed: FAIL against the deployed stack, PASS against a service built from the fix, with
the same backend under both. It is a development override, it announces itself on stderr, and each
result records the `service_base` it used. A release run must never set it.

```bash
AGENTA_SERVICE_BASE=http://localhost:8099 uv run resources/matrix_n1_session_context.py
```

## Cross-cutting invariants (fold into every cell's verdict)

These are not cells. They are pure checks in `qa_matrix_lib.py` that a cell folds into its PASS
condition, so a cell cannot report green on a run that violated one. Both exist because a cell's
own assertions are scenario-shaped and can be satisfied for the wrong reason.

| Invariant | What it pins | Wired into |
|---|---|---|
| `check_no_blank_success_on_refusal(turns, log_lines)` | No `tool_result` with empty output and `isError:false` may exist for a call the runner logged as `[commit-auth] refused`. A refusal must reach the wire as an error or a denial, never as a blank that reads as success. | `matrix_invariant_commit_auth_refusal.py` |
| `check_no_silent_turn(turns)` | No turn may come back completely bare — no text, no tool call, no approval gate, no file or data payload, no error. That is a swallowed provider failure (ASD-EST100) arriving as a clean empty finish: the user sees a blank bubble with no reason anywhere. | `matrix_w7.py`, `matrix_w7_daytona.py`, `matrix_w7_per_harness.py`, `matrix_t8_saved_files.py`, `matrix_t9_agent_tools.py`, `matrix_b1_builtin_find.py`, `matrix_invariant_commit_auth_refusal.py`, `matrix_l3_abandoned_approval.py`, `matrix_w3.py`, `matrix_w4.py`, `matrix_w5.py`, `matrix_n1_session_context.py` |

The silent-turn check matters most in cells whose PASS depends on something NOT appearing (no
error, no leak, no blank success): a turn that produced nothing satisfies those by doing nothing
at all. Its definition of content deliberately mirrors `content_parts_emitted` in the product's
own Vercel egress, so it never fires on a turn whose only output was a file or a data payload —
and reasoning does not count, so a turn that only thought is still a violation. A cell must
exclude any turn it deliberately aborted or interrupted, which legitimately ends bare;
`matrix_w5.py` shows the pattern by checking only its post-interrupt turns. When you add a cell,
add `and not silent["violations"]` to its verdict — `resources/test_qa_matrix_lib_silent_turns.py`
fails if a wired cell drops it.

## Path-scoped cells: coverage the release's own diff demands

Everything above is fixed. It runs identically for every release, which means a release that
rewrote a subsystem gets the same coverage as one that never touched it — and the cell that would
have caught the regression sits unrun, because running it depends on somebody remembering.

`path_triggers.py` removes the remembering. It is one dict of path glob to cells. When the driver
is given the release's diff (`--release-base <ref>`, or `--changed-path` for a checkout that is
not the release branch), every rule whose glob matches a changed path contributes its cells, and
those cells are MANDATORY for that release.

| Rule | Cells it makes mandatory | Why this subsystem needs its own cell |
|---|---|---|
| `api/oss/src/core/tools/**`, `sdks/python/agenta/sdk/agents/platform/gateway.py`, `sdks/python/agenta/sdk/agents/tools/gateway_policy.py`, `services/runner/src/tools/**`, `services/runner/src/engines/sandbox_agent/gateway-gate.ts` | `matrix_gw1_gateway_tools.py` | The gateway chain — the API's catalog and resolve, the SDK's two model-facing tools and its permission compiler, the runner's policy and semantic gate. `tool`, `approve`, and `deny` prove the approval machinery with a BUILTIN, never with a gateway tool, so nothing in the fixed matrix notices when a compiled policy and an enforced policy drift apart. Proposed in [`docs/design/composio-tools-rework/release-gate-changes.md`](../../../../docs/design/composio-tools-rework/release-gate-changes.md). |
| `services/runner/src/engines/sandbox_agent/subscription-*`, `services/runner/src/subscription-*`, `api/oss/src/core/secrets/subscription_*`, `api/oss/src/apis/fastapi/vault/**`, `web/packages/agenta-entities/src/secret/**` | `H1` | The hosted-subscription chain — the runner half that materializes a login and pushes a refreshed copy back, the runner's device-login and status surface, the API half that stores and versions the login, the vault routes the browser signs in through, and the client shapes that render the connection state. Every other cell authenticates from a vault key or from a login an OPERATOR mounted, so a break here is invisible to the whole fixed matrix. |
| Custom-secret vault/workflow paths, `sdks/python/agenta/sdk/agents/{sandbox_credentials.py,wire_models.py,utils/wire.py}`, and runner credential validation/composition/identity/redaction paths | `matrix_s1_custom_secrets.py` | A normal model turn can stay green while the credential is missing, stale, leaked, or injected into only one sandbox provider. This cell checks the saved-reference boundary, both providers, secret rotation, removal, and SSE non-disclosure through durable side effects. |
| `services/runner/src/engines/sandbox_agent/**`, `services/runner/src/providers/daytona*` | Cells `C2`, `C4`, `X2`; journeys `burst` and `crosstalk` | The sandbox engine and the Daytona provider: sandbox creation, the secret plan, the credential preflight, and the retry the runner does when a first model call is refused. A fault here appears only when many sandboxes start at once, which no other journey does. Production hit it as one first message in five failing with a credential error (AGE-4249 / #6485) while the sequential gate stayed green. `P3` is a Daytona cell too but is deliberately not named: it needs `--custom-slug` and `--custom-name`, and the driver exits when a selected custom cell has no slug, so the rule would stop every release run that did not pass them. |
| `sdks/python/agenta/sdk/agents/platform/session_context.py`, `sdks/python/agenta/sdk/agents/platform_instructions.py`, `sdks/python/agenta/sdk/agents/handler.py`, `api/oss/src/core/sessions/context.py` | `matrix_n1_session_context.py` | The per-turn session facts: the agent's display name, the session's name, and the first-turn flag. They reach the harness only as prompt text, so no SSE frame and no stored row reflects them and every frame-level cell is blind to them going missing. That is how #6661 shipped through a green gate: the API stamped the facts in its invoke prelude, the SDK and the runner consumed them correctly, and the playground posts straight to the agent service, where the prelude never runs. |

What the driver does with a mandatory cell depends on which kind it is:

- **A `qa_product.py` cell** (`C3`, `X1`, …) is added to the run, even when `--cell` did not ask
  for it. Nothing more is needed.
- **A standalone `matrix_*.py` cell** is a separate process the driver cannot observe. It is
  printed at the start, written to `mandatory.json`, and listed in `summary.md`. The release is
  not green until that cell has a recorded result of its own.
- **A cell that does not exist** stops the run before a single journey, naming the rule. The
  release changed code the rule protects and the coverage was never written; a SKIP there would
  be the exact false green this mechanism exists to prevent.

Rules are data and unordered: matches are unioned, so two rules naming the same cell is fine.
Matching is `fnmatch` over the whole repo-relative path, which means `*` crosses directory
separators — `a/b/*` and `a/b/**` both mean the whole subtree. Write `**` for a subtree so the
intent reads correctly, and name a file exactly when only that file should trigger.

## Optional probes (`qa_longctx.py`)

Separate from the gate, these need live **Gmail and GitHub Composio connections** in the target
project. Skip them if the project has none.

| Probe | What it catches |
|---|---|
| `memory` | Plant a token, flood the context with bulky tool output across many turns, then ask for the token back. Catches compaction dropping early context. |
| `gmail` | The Gmail/GitHub gateway tools resolve and actually execute. Read-only actions only — writes (SEND/REPLY/CREATE/…) are filtered before they reach an agent. |
| `concurrent` | N sessions run at once, each holding a different token. Catches cross-session bleed a single-session test can never see. |
