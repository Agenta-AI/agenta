# Cold-replay failure report: why the agent has no memory

- Author: Claude (session with Mahmoud), 2026-07-07. Updated same day with the architecture analysis and experiments.
- Evidence: `turn-c6de1865-timeline.md` and `turn-6d34b1ea-timeline.md` (repo root, uncommitted), plus three code-research passes over `services/runner`, the `sandbox-agent` and adapter packages, and the design archive.
- Background reading: [how-approvals-work.md](how-approvals-work.md), [plan.md](plan.md), [status.md](status.md).

## TL;DR

The agent is not failing to reason. It never receives its own history in a form it can reason over. Every turn, normal or approval-resume, destroys the harness session and cold-starts a fresh one. The new session receives the whole conversation as one flattened text block: tool calls reduced to bracketed English lines, thinking dropped entirely, the oldest history tail-sliced away at 24,000 characters, and the stale user command re-presented as if just spoken. The structured message history does reach the runner, but it is spent on trace attributes and approval matching; the model never sees it. So the agent that "committed a hundred times" was not looping. It was five fresh agents, each handed a lossy summary, each redoing the task.

This was not the intended design. The original WP-8 decision chose "persisted message history + ephemeral sandbox, continue via ACP `session/load`". The `session/load` half never shipped; text flattening was the stopgap that became the architecture. Both harnesses (Claude Code and Pi) already persist full structured sessions to disk, and both ACP adapters we ship already expose native resume. We call none of it.

Two paths restore memory, and they compose. Short term: keep the session alive for a TTL after each turn, so the next message continues the same live session (this also lets an approval hold its pending permission RPC open, which deletes the whole exact-args matching problem). Long term: persist the harness's own session files in the durable mount and reattach with `session/load`, which keeps the cold zero-idle-cost model at full fidelity.

## Part 1: the two failed turns

### The mechanism, in one paragraph

When a tool call needs approval, the runner sends the harness no reply, destroys the sandbox session, and ends the turn with `stopReason: "paused"` (`pause.ts`, `sandbox_agent.ts:903-911`). No harness state survives. On approval, the frontend resends the conversation and the runner cold-starts a fresh session. It replays the prior transcript flattened to plain text (`transcript.ts:170-188`) and renders the approved-but-unexecuted call as: "[user APPROVED \<tool>; the call has NOT run yet. Call the tool again with the same arguments now to execute it.]" The approval itself waits in a decision map keyed on tool name plus canonical JSON of the exact arguments (`responder.ts:303-318`). If the re-issued call matches the key, it runs. If not, the gate parks again and the user gets a new approval prompt.

That last conditional is where both turns died.

### Turn c6de1865: accidental argument drift

The user asked for one thing: run the `send-run-feedback` skill, which ends in a `curl` to ntfy.sh. The turn took three approval rounds.

1. Round 1: the model composed the curl heredoc and asked for approval. The user approved. The session died.
2. Round 2: the fresh model rebuilt the curl from the text transcript. The rebuilt command dropped one "Blocked On" line, shortened a suggested fix, and changed the description string. Different bytes, different canonical key, no match. The gate parked again.
3. Round 3: the model regenerated the command again, this time byte-identical to round 2. Round 2's stored approval matched and the call finally ran.

The transcript shows the tell directly: the first two curl calls carry `approval-responded` with no output block, and only the third carries `output-available`. Each resume also relaunches the skill, because every resume is a brand-new session.

This is the arg-regeneration risk that `status.md:113-118` flagged as a known unknown. It is now confirmed in production behavior. A model cannot reproduce a 2 KB prose blob byte-for-byte from a lossy text rendering, so any tool whose argument is free text will drift on almost every replay.

### Turn 6d34b1ea: the resume prompt restarts the task

This turn is worse, and the driver is different. The user had asked the agent to add Slack tools ("search for tools and add them if needed use the skill"). The turn ran five cold-replay rounds and executed zero commits.

| Round | Timeline lines | What the model did | commit payload |
|---|---|---|---|
| 1 | 7-773 | Skill, discover_tools, commit #1 (approved, never ran) | 14 ops + SEND_MESSAGE |
| 2 | 776-1234 | Restarted; added FIND_CHANNELS, FIND_USERS | superset of #1 |
| 3 | 1236-2421 | Restarted; probed "create github issue" and "search web"; added GitHub tools | superset of #2 |
| 4 | 2424-3476 | Restarted; swept 7 more use cases; added 4 more tools | superset of #3 |
| 5 | 3479-3525 | Finally tried to re-issue #4 verbatim; passed args as a corrupted JSON string | parked at dump time |

Four distinct payloads means four distinct approval keys. Every approval the user granted keyed on a payload the next round never reproduced. The loop could not converge, because each round changed the target.

Why did the model restart instead of re-issuing? The resume prompt told it to. With no new user text, `resolvePromptText` (`protocol.ts:549-558`) scans backward, finds the original command, and `buildTurnText` (`transcript.ts:184-187`) closes the prompt with "Continue the conversation. The user now says: search for tools and add them if needed use the skill." A cold model reads that as a current instruction and obeys it. The mid-transcript nudge to re-run the approved call loses to the closing frame. Round 2's thought even acknowledges the pending approved commit (line 800), then builds a different one anyway.

Three factors amplified the loop:

- **Goal drift from truncation.** `buildTurnText` renders full tool outputs inline, then tail-slices to 24,000 characters (`transcript.ts:179-183`). One `discover_tools` output here renders at 30-60 KB, so from round 2 onward the replayed history was mostly the latest discovery dump. The original goal (send one Slack message) fell off the front. Left holding only "search for tools and add them if needed," the model generalized. That is the GitHub and websearch tail the user saw.
- **No read path for the current config.** The agent tried to read `agenta://workflow/revision` and got "Server agenta-tools does not support resources" (lines 1270-1285). Without a read op it reconstructed the whole tools list from transcript memory each round, which encouraged composing fresh payloads.
- **A new canonicalization gap.** In round 5 the model finally copied the approved args out of the flattened transcript, but passed `workflow_revision` as a JSON string with one stray trailing `}`. `normalizeJsonish` (`responder.ts:101-109`) tries `JSON.parse` on the whole string, throws on the trailing brace, and falls back to hashing the raw string. The key missed again. Even the honest re-issue failed.

### What the timelines rule out

- Not a model loop within one session. Every repetition sits across a session boundary; each round opens with a fresh "Launching skill" and a verbatim restatement of the user command.
- Not `approvalRenderHints` failing. The hints correctly marked only the last unresolved commit as pending; the pile-up came from the model creating a new commit each round, not from re-running old ones.
- Not the loop-breaker. Turn c6de1865 converged because round 3's command happened to match round 2's byte-for-byte, not because anything auto-allowed it.

## Part 2: how the runner talks to the harness

This section answers the architecture question directly: is stateless-per-turn wrong, and could we not do this without sessions? Sending all messages each turn is not the problem. Every LLM conversation, including a local Claude Code session, resends history every request. The problem is fidelity: what shape the history takes when it reaches the model.

### There are two stop boundaries, and both are cold

The runner destroys the sandbox and session at **every** turn end, not only on approval pauses:

- Each HTTP `/run` calls the engine fresh (`server.ts:186`), which starts a new sandbox (`sandbox_agent.ts:536`), creates a new session with `createSession`, never any resume call (`sandbox_agent.ts:695-699`), and tears everything down in the `finally` (`sandbox_agent.ts:1004-1024`).
- The engine header documents it: "Per invoke (cold): start → createSession → prompt → destroySandbox()".
- There is exactly one engine and one code path for all harnesses (pi_core, pi_agenta, claude). No warm path exists anywhere.

So the "between messages" boundary Mahmoud flagged is real and is the same mechanism as the approval boundary. A three-message conversation is three unrelated agents. Turn 6d34b1ea just made this visible because approvals forced five boundaries inside one logical task.

### What the model actually receives

One ACP text block per turn: `session.prompt([{type: "text", text: plan.turnText}])` (`sandbox_agent.ts:899-901`). The block looks like this (`transcript.ts:120-188`):

```
Conversation so far:
user: <first prompt>
assistant: <answer text> [called commit_revision({...full JSON args...})] [commit_revision returned: {...}]
user: <next prompt>

Continue the conversation. The user now says:
<latest user text>
```

Rendering rules, per block type:

| Block | Rendered as | Ref |
|---|---|---|
| user/assistant text | raw text | transcript.ts:129-130 |
| tool call | `[called <name>({json args})]`, args in full | transcript.ts:131-132 |
| tool result | `[<name> returned: <json>]`, output in full | transcript.ts:151-156 |
| approval (pending) | `[user APPROVED <name>; the call has NOT run yet. Call the tool again with the same arguments now to execute it.]` | transcript.ts:144-146 |
| thinking / reasoning | **dropped, no branch exists** | transcript.ts:120-164 |
| image / resource | `[image]` / `[resource: <uri>]` | transcript.ts:157-160 |

Then the joined string is tail-sliced: `if (transcript.length > maxChars) transcript = transcript.slice(-maxChars)` with `AGENTA_AGENT_HISTORY_MAX_CHARS` defaulting to 24,000 (`transcript.ts:179-183`). The slice is blind: it cuts mid-line, drops the oldest turns first, and has no per-item cap, so one large tool output evicts the conversation's beginning. There is no summarization.

### Where structure dies, hop by hop

The conversation is structured for most of its journey. It dies at the last hop:

1. **Frontend → SDK.** The Vercel adapter (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py`) preserves text, files, and tool parts as structured `ContentBlock`s with `toolCallId`, `toolName`, `input`, `output`. **Reasoning parts are dropped here** (module docstring, lines 82-87). First loss: thinking.
2. **SDK → runner.** Structure survives intact as `messages: ChatMessage[]` (`protocol.ts:437-438`). The wire `ContentBlock` (`protocol.ts:12-27`) was explicitly designed so a resolved tool call "replays as a `tool_call` block plus a `tool_result` block so the model resumes from the result."
3. **Inside the runner.** The structured messages feed two consumers: the OTEL tracer (`run.start({messages: ...})`, `sandbox_agent.ts:728-735` → `llm.input_messages` span attributes) and the approval decision map (`responder.ts`). **Neither sends them to the model.**
4. **Runner → harness.** `buildTurnText` flattens everything to the text block above. Second and final loss: tool structure, role structure, ids, and (via the tail slice) the oldest history.

This explains the trace confusion: the trace shows `llm.input_messages` with the full structured conversation, so it looks like the model received it. It did not. The trace records what the runner *had*, not what the harness *saw*. The two should not be conflated, and today the trace does not record the actual `turnText` at all.

### Why structured replay through the prompt is impossible in-spec

ACP `session/prompt` content blocks are `text | image | audio | resource_link | resource` only (spec and vendored `@agentclientprotocol/sdk@0.26.0` types). There is no client-to-agent tool-history block. The comment in `transcript.ts:115-119` is accurate. The in-spec path to structured history is on the agent side: `session/load` (agent replays its own stored conversation) or the newer `session/resume` (reattach without replay).

### The fidelity bar: what a local Claude Code session has that ours lacks

A local (or natively resumed) Claude Code session sends the API real structured turns: `tool_use` blocks with ids and exact inputs, `tool_result` blocks correlated by id, interleaved thinking, untruncated history managed by the harness's own compaction (summarize-oldest under token pressure, not a byte slice). The model was trained on that shape. It can answer "what tools did I call" trivially. Our replay gives it one user-role text blob in which its own past actions are indistinguishable from quoted text, with no self-attribution, no thinking, and a hole where the oldest history used to be. The observed "cannot reason, cannot improve, no memory" behavior is the expected output of that input.

### The design history: cold replay was a stopgap that shipped

The WP-8 decision table (`docs/design/agent-workflows/archive/wp-8-rivet-acp-runtime/status.md:110-140`) chose ephemeral sandboxes for isolation and cost, with continuation intended via ACP `session/load`: "Session = persisted message history + ephemeral sandbox; continue via ACP session/load." The `session/load` half never shipped. Related artifacts:

- The harness-port redesign proposal (`archive/harness-port-redesign/proposal.md`) planned "continue uses ACP session/load instead of replaying transcript text" as Phase C.
- A `/load-session` endpoint and `SessionStore` port existed and were removed as dead code on 2026-06-24 (nothing wrote to them).
- The `sandbox-agent` package we ship exposes `resumeSession` / `resumeOrCreateSession` and a pluggable `SessionPersistDriver`; the runner instantiates a fresh in-memory driver per run and never calls resume (`sandbox_agent.ts:530-531`). Note: sandbox-agent's own `resumeSession` is also a lossy text replay (12K char cap), so wiring it up as-is would not reach the fidelity bar; it matters as evidence of the intended seam, not as the fix.
- Warm (keep-alive) sessions were explicitly deferred with recorded reasons: no filesystem jail in sandbox-agent (warm multi-tenant daemon = cross-tenant reads), per-session secret isolation, replica routing (finding A-16), and idle sandbox cost across human-timescale approval pauses.

## Part 3: paths to fix it

Four options, ordered by fidelity restored per unit of risk. Options 2 and 3 compose: keep-alive covers the fast conversational loop; native resume covers everything the TTL misses.

### Option 1: better text replay (stopgap, do regardless)

Keeps the architecture, reduces the damage. All small, runner-only:

1. Fix the resume closing frame: when the resume carries a pending approval and no new user text, close with "The user approved the pending \<tool> call above. Execute exactly that call now; do not restart the task," never the stale command (`protocol.ts:549-558`, `transcript.ts:184-187`).
2. Execute the approved call runner-side: the runner holds the exact name and args from the original `tool_call` block; run it directly instead of asking a fresh model to reproduce it (`pause.ts`, `sandbox_agent.ts`, `responder.ts`).
3. Cap per-result rendered size (a few KB with an elision marker) before the 24K tail slice, and raise the default window (`transcript.ts:152-155, 179-183`).
4. Harden `normalizeJsonish` to prefix-parse near-JSON strings (`responder.ts:101-121`).
5. Add a guarded name-level fallback when exactly one unconsumed approval exists for a tool (`responder.ts:303-318`).
6. Add a config read op (`get_revision`) to the build kit so the agent can fetch its current tools list.

Ceiling: cannot restore thinking, self-attribution, or true structure. The agent stays amnesiac, just less destructively so.

### Option 2: TTL keep-alive (the simple solution, validated)

Keep the sandbox and session alive for a short TTL after a turn ends; the next message continues the same live session with just the new user text. The architecture research confirmed this is feasible with today's code and topology:

- **The runner is a long-lived single-replica daemon** everywhere we deploy (compose and Helm both run one replica), so an in-memory `Map<sessionId, LiveSession>` pool works. A pool miss (future multi-replica, restart) degrades to cold replay, never fails.
- **The key already exists on the wire.** The playground sends `session_id` end to end (FE `agentRequest.ts:303` → SDK `handler.py:253` → runner `protocol.ts:386`). No wire change needed.
- **Continuation is validated, not assumed.** Each parked session records a config fingerprint (harness, model, tools, skills, revision) and a history fingerprint (ordered user texts + tool-call ids). Mismatch, edit, or expiry → evict and cold replay.
- **The approval win is the big one.** The session is destroyed on pause today for three recorded reasons (F-040): the HTTP turn must end, the sandbox would leak, and the package blocks manual cancel. A TTL park invalidates the leak and cancel reasons while preserving the turn-end: the turn still ends with `stopReason: "paused"`, but the `LiveSession` parks holding the still-pending `prompt()` promise and the unanswered permission RPC. `session.respondPermission(id, reply)` is callable at any later time; the HTTP layer already disables undici timeouts specifically so held ACP connections survive human delays. On approve, the runner answers the parked RPC and the tool executes with its **original byte-exact arguments**. The entire exact-args matching machinery becomes the fallback path instead of the only path. Both production failures in Part 1 become impossible in the common case.
- **Lifecycle:** flag-gated (`AGENTA_RUNNER_SESSION_KEEPALIVE`), ~60s idle TTL, a longer approval TTL (~10 min; expiry degrades to today's cold path), LRU cap, local-only first (an idle local session costs host RAM; an idle Daytona sandbox costs money, and the existing 15-min auto-stop backstop still reaps leaks).
- **Slices:** (1) keep-alive across normal turns, local, flag-gated, runner-only, ~350-500 LoC; (2) keep-alive across approval pauses (~200-300 LoC, highest correctness value); (3) Daytona after soak.

Limits: memory survives only within the TTL and the replica. A conversation resumed the next morning is still cold. That is what option 3 covers.

### Option 3: harness-native resume (highest fidelity, keeps the cold model)

Both harnesses already persist full structured sessions to disk, and both installed ACP adapters expose resume:

- Claude Code: JSONL sessions under `~/.claude/projects/<cwd>/<session>.jsonl`; `claude-agent-acp@0.23.1` advertises `loadSession: true` and maps ACP `session/load`/`session/resume` onto the SDK's `resume` (full tool calls, results, and thinking).
- Pi: JSONL sessions under `~/.pi/agent/sessions/`; `pi-acp@0.0.29` implements `session/load` with a session-map file.
- The runner already maintains a durable per-session cwd (geesefs FUSE-over-S3 mount) that survives teardowns. The session files just live outside it today; `CLAUDE_CONFIG_DIR` and Pi's `--session-dir` are redirectable into it. Resume is cwd-keyed and our durable cwd is stable per session, so the keying lines up.

The work: redirect harness session dirs into durable storage, record the harness session id on our session row, and call `session/load` instead of `createSession` on turn N+1. One plumbing blocker: sandbox-agent 0.4.2 does not forward `session/load` through its managed session API, so this goes through its raw ACP passthrough (`POST /v1/acp/{server_id}`), an upstream patch, or bypassing the daemon.

This restores the full fidelity bar (structure, thinking, harness-native compaction) while keeping ephemeral sandboxes, zero idle cost, and the existing isolation story. It also survives replica changes and long gaps, which keep-alive does not.

### Option 4: structured replay through the prompt (rejected)

Not possible in-spec; see Part 2. A `_meta`-based extension would be bespoke per adapter and strictly worse than option 3.

## Part 4: experiments to run

Ordered so each one either confirms a mechanism or de-risks a fix. E1-E3 need no code changes beyond logging; E5-E7 are spikes for options 2 and 3.

**E1: Dump the real turnText.** Log (or write to the trace as a new span attribute) the exact `plan.turnText` for one live playground conversation on the dev box. Verify: the flattened shape, where the 24K slice cut, and whether the original goal survived. This also fixes the misleading trace: today it shows `llm.input_messages` (what the runner had), not what the model saw. Effort: one log line plus one span attribute.

**E2: Memory probe on the live agent.** Mid-conversation (3-4 turns in, with at least one big tool output), ask the deployed agent: "List every tool you have called in this conversation with their arguments." Compare against ground truth from the trace. Run once with history under 24K and once over. Prediction: near-total recall under, amnesia about early turns over. This turns "it has no memory" into a measured recall rate.

**E3: Offline fidelity A/B.** Take the turn-6d34b1ea conversation. Feed the same model (direct API call, uv script) the same history in two shapes: (a) our flattened turnText, (b) proper structured `tool_use`/`tool_result` turns. Ask both: "What have you already done, and what should you do next?" This isolates the flattening cost from everything else in the runtime, and quantifies how much option 1 can recover versus options 2/3.

**E4: Truncation knob on the dev box.** Set `AGENTA_AGENT_HISTORY_MAX_CHARS=200000` (env-overridable, no code change) and rerun the Slack-tools scenario. If the GitHub/websearch drift disappears but approval loops remain, that cleanly separates the truncation root cause from the resume-frame and key-matching root causes.

**E5: Multi-prompt session spike (de-risks option 2, slice 1).** In `services/runner`, drive one sandbox-agent `Session` with two sequential `prompt()` calls: turn 1 runs a tool, turn 2 asks "what did you just do?". Verify the harness remembers turn 1 natively and the event stream re-attaches cleanly. This is the keep-alive core in ~50 lines of test.

**E6: Parked permission spike (de-risks option 2, slice 2).** Raise an approval gate, do not destroy the session, hold the pending permission RPC for 60s, then call `respondPermission(id, "once")`. Verify the original `prompt()` promise continues and the tool executes with its original arguments. This proves the whole exact-args machinery is bypassable.

**E7: Native resume spike (de-risks option 3).** Inside a sandbox: run claude-agent-acp with `CLAUDE_CONFIG_DIR` pointed at the durable mount, create a session, run a tool, kill the process, restart, `session/load` by id (via the raw ACP passthrough), and ask "what did you do before the restart?". Repeat for pi-acp. Measures both feasibility and reattach latency.

**E8: Replay-side observability.** Add `[HITL]`-style log lines for every cold replay: rendered length before/after slice, number of turns evicted, whether a pending approval nudge is present. Cheap, permanent, and turns future incidents from timeline archaeology into a grep.

## Recommendation

Run E1-E4 this week; they are near-free and make the failure measurable. Ship option 1 items 1-4 as the immediate stopgap (they directly patch the two production failures). Build option 2 slice 1 behind the flag next; it is the "simple solution" and the spikes E5/E6 bound its risk. Treat option 3 as the target architecture and validate it with E7 in parallel, because it is the only path that restores full fidelity across restarts, replicas, and long gaps.

## Appendix: how to confirm a key miss on a live run

Both sides log the HITL key. Compare these lines from one reproduction:

- Egress key the frontend persists: `stream.py:584-592` (`[HITL] egress approval-request ...`).
- Ingress fold-back: `messages.py:190-198` (`[HITL] ingress approval-responded ...`).
- Live re-raised gate: `responder.ts:258-261` and `acp-interactions.ts:170-187`.
- Decision map on resume: `sandbox_agent.ts:773-776` (`[HITL] resume state: decisions=[...]`).

If the names match and the args differ, the miss is argument drift. If the resumed model never re-issues the call at all and instead relaunches the task, the miss is the resume framing.

## Q&A: Mahmoud's review questions (2026-07-07)

### Q1. The WP-8 decision was three weeks ago, and the decision was an MVP that resends all messages. The mistake was the text flattening, not the resend. Can the MVP stay on resend-all-messages?

Agreed, and the report's framing is corrected accordingly: resending the full conversation every turn is a sound MVP shape (it is how stateless LLM chat works everywhere). The defect is only in how the resent messages are rendered for the harness.

Can we fix it while staying on resend-all? Partially, and it may be enough:

- **Hard constraint:** ACP `session/prompt` accepts only text, image, audio, and resource blocks. There is no structured tool-history block in the protocol. So under resend-all, the last hop is always a text rendering. That cannot be engineered away without changing approach (native `session/load`, option 3).
- **What a better rendering can fix:** the blind 24K tail slice (raise the cap, add per-result caps so one tool dump cannot evict the goal), the stale-command closing frame, the missing self-attribution (clear per-turn markers instead of a bare `role:` prefix), and runner-side execution of approved calls so the model never has to reproduce arguments. These are option 1, all small and runner-local.
- **What no rendering can fix:** thinking is gone (dropped at the SDK adapter), and the model never sees real `tool_use`/`tool_result` blocks, the shape it was trained to reason over.

Whether the fixable part is enough for the MVP is an empirical question, and experiment E3 answers it directly: feed the same conversation to the same model as (a) today's flattened text, (b) an improved text rendering, (c) proper structured turns, and measure recall and next-action quality. If (b) is close to (c), the MVP stays on resend-all with option 1 applied. If not, keep-alive (option 2) or native resume (option 3) is the MVP unblocker. Recommendation: run E3 before committing to either.

### Q2. Are we actually saving the sessions? Is saving wired? Is the S3 store in docker compose? Do we have the endpoints?

Two different things called "session" here, with opposite answers:

- **The session working directory: yes, saved and fully wired.** Every run, the runner calls `POST /sessions/mounts/sign` on the API (`api/oss/src/apis/fastapi/sessions/router.py`; also `/sessions/mounts/` fetch, query, and file ops). The API mints short-lived, prefix-scoped STS credentials, and the runner geesefs-mounts the session's object-store prefix at the agent's cwd (`services/runner/src/engines/sandbox_agent/mount.ts`, wired at `sandbox_agent.ts:335, 464, 587`). Files the agent writes survive sandbox teardown and reappear next turn. Best-effort by design: if the store is down or unconfigured, the sign call returns 503 and the run proceeds on an ephemeral cwd.
- **The object store is SeaweedFS, not MinIO** (`chrislusf/seaweedfs:4.37`), present and on by default in both OSS and EE **dev** compose files (S3 API on `:8333`, STS/IAM configured, dev-default signing key `AGENTA_STORE_SIGNING_KEY`). The API defaults point at it (`AGENTA_STORE_ENDPOINT_URL` → `http://seaweedfs:8333`, bucket `agenta-store`, `env.py:966-988`). Not yet in the `.gh` compose files. The ngrok tunnel for remote (Daytona) sandboxes is behind the `remote` compose profile.
- **The harness session state: no, not saved.** The Claude and Pi session files (`~/.claude/projects/<cwd>/<id>.jsonl`, `~/.pi/agent/sessions/`) live in the sandbox `$HOME`, outside the mounted cwd, and die with the sandbox. Nothing calls `resumeSession` or `session/load`. This is exactly the option 3 gap: the persistence rail exists and works; the session files are not on it. Closing it is redirection (`CLAUDE_CONFIG_DIR` / Pi `--session-dir` into the durable prefix) plus a `session/load` call on turn N+1, not new infrastructure.

### Q3. Does the frontend have a flag for all-messages vs last-message? Is the frontend's session-id handling correct?

**No flag exists.** The playground always sends the full conversation: `buildAgentRequest` (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:388-399`) sends the entire `useChat` message array with exactly one filter, `hasAnswer`, which drops assistant turns that produced no answer part (empty text, reasoning-only) so a "no response" turn cannot poison the next request. Tool parts and their full outputs are sent verbatim; reasoning parts ride along on turns that also have an answer (the SDK then drops them). The agent env flags that do exist (`NEXT_PUBLIC_AGENT_CHAT_SLICE` and friends) do not touch history. If server-side session state ever lets the FE send only the delta, that switch has to be built.

**Session-id handling is correct for the current stateless backend, and mostly ready for a stateful one.** The id is minted once per chat tab (`uuidv4` in `addSessionAtomFamily`, `web/oss/src/components/AgentChatSlice/state/sessions.ts:136`), persisted in localStorage, pinned into `useChat`, and sent as `session_id` on every request. It is stable across consecutive turns, across approval resumes (same `useChat` instance re-sends), across page reloads (localStorage restore), and across message edits (rewind truncates history but keeps the id). Fragilities to fix before keying server-side state on it:

1. **Drawer scope forks sessions per revision.** The revision drawer scopes sessions to `drawer:<entityId>`, so navigating to another revision in the drawer silently starts a new `session_id`. The main playground keeps one id across revision switches. Inconsistent, and it would fork server-side sessions.
2. **`__global__` hydration window.** Before `routerAppId` resolves (or off an app page), sessions collapse into a shared `__global__` bucket, so a reload can transiently resolve the wrong session set.
3. **The server-minted id is never adopted.** If `session_id` is absent or invalid, the SDK mints a fresh id per request (`resolve_session_id`, `sdks/python/agenta/sdk/models/shared.py:13-22`), which means zero affinity. The FE always sends a valid id today, but the contract is implicit; the FE also ignores the `session_id` the server returns.
4. **Sent history diverges from displayed history.** The `hasAnswer` pruning means the server sees fewer messages than the user does. Any server-side history fingerprint (keep-alive option 2 validates continuation this way) must be computed over the pruned array, not the displayed one.
5. **A misleading comment** at `AgentChatPanel.tsx:871-873` claims a revision swap unmounts the conversation; that is true only in the drawer. Worth fixing so nobody reasons about affinity from it.

### Q4. Do we have design docs or plans for saving and loading harness session state over ACP? Sandbox-agent has a save/load interface (agent-sessions, session-restoration, session-persistence docs). Should we use it, or is the mount sufficient?

**We have plans, and they all point the same way: harness-native `session/load`, not sandbox-agent's interface.** The paper trail:

- The original WP-8 decision (`archive/wp-8-rivet-acp-runtime/architecture.md:150-156`): "ephemeral sandbox per turn, persisted messages, continue by replaying history with ACP `session/load` (Pi `resumeSession`, Claude Code `loadSession`)." The `session/load` half never shipped.
- The harness-port redesign, Phase C (`archive/harness-port-redesign/proposal.md:143-163`): "continue a conversation with ACP `session/load` instead of `buildTurnText` transcript replay."
- Planned-not-started items: `scratch/pr-stack.md:99-135` (item 5 "Cold Session Persistence", item 6 "Session Snapshot Design") and `documentation/sessions.md:100-128` ("Harness session snapshots", interface "not designed yet").
- No plan anywhere proposes sandbox-agent's persist/resume as the memory mechanism.

**What sandbox-agent's interface actually does, verified against the docs and the installed 0.4.2 package:** its persist driver stores a normalized event journal (`SessionRecord` + `SessionEvent` rows), and its "restoration" does not restore. The session-restoration doc says it "recreates a fresh session for the same local session id" and injects "recent persisted events" into the next prompt as text, capped at 50 events / 12,000 characters. The implementation confirms it: `resumeSession` calls `acp.newSession` (a brand-new harness session) and prepends "Previous session history is replayed below as JSON-RPC envelopes..." (`chunk-TVCDKGSM.js:1324-1348, 2521-2540`). It never calls ACP `session/load` (zero hits in 0.4.2 and in 0.5.0-rc.3, the newest published version). So adopting it would buy us a second cold replay with a cap half the size of our current one, plus a duplicate journal store. Not the fix.

Two useful parts of it survive the rejection: the persisted `SessionRecord.agentSessionId` field stores exactly the harness session id a real `session/load` needs, and the daemon exposes a raw ACP JSON-RPC passthrough (`POST /v1/acp/{serverId}`) that can carry a `session/load` envelope today. One layer down, its own dependency `acp-http-client@0.4.2` already exposes `loadSession()`; sandbox-agent's managed API just never uses it.

**Is the mount sufficient? No, twice over.** First, the harness session files never touch the mount today: they live in the sandbox `$HOME` (`~/.claude/projects/...`, `~/.pi/agent/sessions/`), outside the mounted cwd, and die with the sandbox. Second, even with the files persisted, a fresh sandbox always issues `session/new`; neither harness scans disk and auto-resumes. The files sit inert until something sends `session/load` with the stored id. Three pieces make it work:

1. Get the session files into durable storage. Not by pointing the live write path at the FUSE mount: session JSONL is append-heavy, S3 has no append (geesefs re-uploads on flush), and the runner already keeps its own hot files off the mount for exactly this reason (`run-plan.ts:385-387`, the relay-file ENOTCONN lesson). Instead, copy the session dir out of the mount at setup and back into it at teardown, the controlled moments. And sync only the transcripts (`projects/<cwd>/` for Claude, `agent/sessions/` for Pi), never `~/.claude` wholesale: `CLAUDE_CONFIG_DIR` relocates credentials (`.credentials.json`), settings, and cache along with the transcripts, and those must not land on the shared object store.
2. Record the harness `agentSessionId` on our session row after each turn. Today it dies with the per-run in-memory driver (`sandbox_agent.ts:531`).
3. Send `session/load` instead of `session/new` on turn N+1. Route: the raw ACP passthrough or a direct `acp-http-client.loadSession` works with 0.4.2 today; the clean end state is a small upstream patch to sandbox-agent (`resumeSession` → `acp.loadSession` when the agent advertises the capability and `agentSessionId` is recorded, which is exactly the data its persist layer already holds).

**Recommendation:** skip sandbox-agent's persist/resume for memory; keep it for what it is (the daemon's event journal). Sequence stays as in Part 3: option 1 replay fixes plus option 2 keep-alive now, then option 3 with the copy-around-lifecycle sync and `session/load` via the passthrough, validated by spike E7 before committing, with the upstream patch as the long-term shape. The mount is the right durable rail and makes option 3 cheap, but it is necessary, not sufficient.
