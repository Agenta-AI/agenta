# Findings: does a killed-and-resumed harness turn make the same LLM calls as a warm one?

Date: 2026-07-09. Box: hetznerdev. Steps: [protocol.md](protocol.md).

## The question in one line

We want this invariant: whether a human approval takes 10 seconds (warm parked process) or 12 hours
(process killed, resumed later), the sequence of LLM API calls is identical. Call N ends with the
model returning a `tool_use` block. Call N+1 sends the same message list plus the real `tool_result`.
Nothing is regenerated in between. The LLM API is stateless, so this is achievable in theory if the
exact native message list survives and the harness can answer the pending `tool_use` after a restart.
The unknowns are harness behavior, captured as Q1 and Q2 below.

Rubric for Q2:
- (A) the same `tool_use` id is answered or re-asked -> overnight approvals can be exact, invariant
  achievable cold.
- (B) the call is settled as interrupted and the model re-issues a NEW `tool_use` with full
  structured context -> near-invariant, small drift risk.
- (C) load fails or drops back to the last user message -> overnight case unrecoverable from harness
  disk.

## Verdicts

| Harness | Path | Q1 (write timing) | Q2 (dangling call) | Rubric |
|---|---|---|---|---|
| Claude Code | CLI `--resume` | pending `tool_use` on disk mid-turn: YES | original id abandoned, model re-issues NEW id | B |
| Claude Code | ACP `loadSession` (shipping path) | pending `tool_use` on disk mid-turn: YES | original id settled with a synthetic ERROR `tool_result`, model re-issues NEW id | B |
| Pi | source (static-only) | pending `tool_call` on disk mid-turn: YES | original id settled with synthetic error `tool_result` ("No result provided", `isError`), model re-issues | B |

Bottom line: both harnesses are B, on both the CLI and the ACP path for Claude. The strict invariant
(same call N+1, same id, real result) is NOT achievable from harness disk alone after a cold restart.
The pending tool call is always settled as interrupted, and the model issues a brand-new `tool_use`
to actually do the work. This is a clean, reproducible answer, not a maybe.

## Q1 evidence: the pending tool_use is on disk mid-turn (both harnesses)

### Claude Code (live)

While the CLI sat blocked on the Bash permission prompt, the session JSONL already held the pending
call as its last line, with no `tool_result`:

```
line7 assistant  tool_use id=toolu_01KGkMsMzioWXztY3RzrnBhu name=Bash
       input={"command": "echo TOKEN-8f3a > proof.txt", "description": "Write TOKEN-8f3a to proof.txt"}
last line type: assistant   (no tool_result present)
```

The file mtime and line count were stable across repeated polls while blocked (one flush mid-turn,
not rewritten). After `kill -9`, the JSONL was byte-identical (same md5, same 8 lines): the hard kill
lost nothing, and `proof.txt` was never created (the tool never ran). The proxy confirmed call N had
been sent and no `tool_result` call N+1 followed, because the harness was blocked. Q1 for Claude:
YES, per-message flush, pending call durable.

### Pi (static source)

`agent-session.js` (lines 269-281) persists on the `message_end` event, per message, via a
synchronous `appendFileSync` in `session-manager.js` (`appendMessage -> _appendEntry -> _persist`).
In the agent loop (`pi-agent-core/dist/agent-loop.js`), `streamAssistantResponse` emits `message_end`
for the finalized assistant message (line 105) strictly before `executeToolCalls` runs the permission
gate (line 117, then line 372). So the assistant message carrying the pending `tool_call` is flushed
to disk before the tool or permission resolves. Q1 for Pi: YES, per-message, pending call durable.
(One nuance: entries before the first assistant message are buffered in memory and flushed together
when that first assistant message arrives, so either way the pending call and all prior context land
on disk at that moment. The only exception is the non-persistent in-memory session mode.)

## Q2 evidence: the dangling call is settled, and a NEW tool_use does the work

### Claude Code CLI `--resume`

On resume, the CLI loaded the transcript and waited. It did NOT auto-re-fire the pending permission.
It injected a synthetic `Continue from where you left off.` user turn, and the model replied `No
response requested.` The original `tool_use` was abandoned. Only after a fresh user prompt did the
model issue a NEW `tool_use` (different id, same command), which ran on approval. Final transcript:

```
L8  assistant TOOL_USE id=toolu_015rmfzPDgphtX1N23Lw55yt   (original, dangling)
L10 user      "Continue from where you left off."          (injected by resume)
L11 assistant "No response requested."                     (original call settled as a no-op)
L12 user      "continue"                                    (fresh nudge)
L14 assistant TOOL_USE id=toolu_01CwLWTJNYZ4LySs8YPT2qhH   (NEW id, same command)
L15 user      TOOL_RESULT for=toolu_01CwLW... err=False    (real result, NEW id)
L16 assistant "Done - proof.txt now contains TOKEN-9c2b"
```

On the wire (proxy), the original id `toolu_015rm...` never appears after resume: the dangling
assistant turn is collapsed to plain text before the message list is sent to the API. The original
call is neither answered nor re-sent.

### Claude Code ACP `loadSession` (the path the runner ships on)

Same outcome, reached slightly differently, and this is the load-bearing result because it is the
shipping path. Sequence observed via the ACP client and confirmed in the JSONL and proxy:

- D1 emitted `session/request_permission` for `toolCallId=toolu_013MPJsaqRPW8t1HkmYmHYd2`. We held it
  and `kill -9`ed D1. The JSONL grew from 7 to 8 lines at the kill: the SDK recorded a synthetic
  error `tool_result` for the pending call as the stream closed.
- D2 `session/load` (with the resume in `_meta.claudeCode.options.resume`) replayed the original
  call and marked it `failed`, not as a live permission request.
- On the `continue` prompt, the model issued NEW `tool_use` ids and eventually ran the command.

Final JSONL:

```
L6  assistant TOOL_USE id=toolu_013MPJsaqRPW8t1HkmYmHYd2   (original)
L7  user      TOOL_RESULT for=toolu_013MP... err=True  "Tool permission request failed: ..."
L10 user      "Continue from where you left off."
L11 assistant "No response requested."
L15 user      "continue"
L17 assistant TOOL_USE id=toolu_01XYAgN7hye5ehESpabwaBKf  (NEW; errored on a stream-close race)
L19 assistant TOOL_USE id=toolu_01AYcTuzYirdvssznVNG4FwT  (NEW; succeeded)
L21 user      TOOL_RESULT for=toolu_01AYc... err=False  "(Bash completed with no output)"
```

`proof.txt` ended with `TOKEN-acp7`. The command did run after resume, so the ACP path is fully
recoverable end to end. But it recovered by re-issuing, not by answering the parked call.

### The proxy diff (warm vs cold invariant), ACP path

Cold call N+1, as sent to the API (request signatures, `!err` = `is_error`):

```
call#11  assistant[tool_use#toolu_013MP]  ->  user[tool_result#toolu_013MP!err]
call#15  assistant[tool_use#toolu_013MP]  ->  user[tool_result#toolu_013MP!err]
         assistant[tool_use#toolu_01AY ]  ->  user[tool_result#toolu_01AY]        (real work, NEW id)
```

A warm turn (never killed) would instead send, for that same call N+1:
`assistant[tool_use#toolu_013MP] -> user[tool_result#toolu_013MP]` with the REAL command output and
nothing regenerated. The cold path breaks the invariant in two visible ways: the original id's
`tool_result` is a synthetic error, not the real output, and a brand-new `tool_use` id is appended to
carry out the work. The message lists are not identical.

### Pi (static source)

`pi-ai/dist/providers/transform-messages.js` (lines 122-182) inserts synthetic tool results for
orphaned calls at the LLM boundary: for any pending `tool_call` with no matching result it pushes a
`toolResult` with the ORIGINAL `toolCallId`, content `"No result provided"`, `isError: true`. The
load path itself (`session-manager.js` `buildSessionContext`, `agent-session-runtime.js` line 166)
preserves the dangling call verbatim in structured history and does not truncate or error. So Pi, on
resume, shows the model `assistant(tool_call X, original args) -> toolResult(X, error) -> (new
prompt)`, and the model is free to re-issue. Full structured context, original call marked errored,
model re-issues: verdict B. This synthetic result is applied in memory at each request and is not
written back to the JSONL. The `pi-acp` adapter advertises `loadSession: true` and its
`session/load` handler hands the existing JSONL to Pi through this same path, so the ACP behavior
matches. This is static-only; no live Pi run was performed.

## The most surprising finding

The pending `tool_use` survives a hard `kill -9` perfectly on both harnesses (Q1 is a clean yes), yet
neither harness will ever answer that surviving call. Q1 gives us exactly the durable state the
invariant needs, and Q2 throws it away: on load, the parked call is force-settled as interrupted or
errored, and the model must re-derive a fresh `tool_use` from the still-present user request. The
harness disk is necessary but not sufficient. Half A of the resume plan (the file surviving) is
solved for free; the exact-continuation half is blocked by harness policy, not by lost state.

## What this means for the design

- Parkable warm gates give the exact invariant. If the harness process stays alive with the
  permission RPC held open (the keep-alive / session-keepalive slice), approval simply unblocks the
  waiting `canUseTool` promise and call N+1 answers the original id with the real result. That is the
  only path to a byte-exact call sequence. It works only within the warm TTL.
- Cold restart past the TTL cannot be byte-exact from harness disk. Both Claude Code (CLI and ACP)
  and Pi settle the parked call and re-issue. The best achievable cold behavior is B: same
  conversation, same user intent, full structured history preserved, but a new `tool_use` id and one
  extra model round to regenerate the call. Small drift risk (the model could choose slightly
  different arguments), bounded because the original user request text is still in context.
- Therefore the durable-decision cold path stays the answer past the warm TTL. The harness-session
  resume plan's Half B (record the `agentSessionId`, send `session/load` instead of `session/new`)
  is confirmed to work on the ACP path: `loadSession` with `_meta.claudeCode.options.resume` loads
  the file, replays history, and the turn continues to completion. But "continues" means re-issues,
  not resumes-in-place. The plan should not promise an identical call sequence across a cold restart;
  it should promise a faithful continuation (B), and keep cold replay (or a durable approved-decision
  record) as the mechanism that makes the re-issued call deterministic rather than a fresh model
  guess.
- Practical composition: keep-alive holds the gate for exact continuation inside the TTL; session
  resume (this project) makes the next-turn context real and high-fidelity after the sandbox dies;
  and a recorded approval decision removes the drift risk of the re-issued call in the cold case.
  These three layers are complementary, which matches the plan's own framing.

## Caveats and limits

- The Claude runs used a Claude Max subscription and model `claude-fable-5`; behavior is a property
  of the harness and SDK, not the model, so this generalizes, but the exact wording of the injected
  "Continue from where you left off" / "No response requested" turns is CLI/SDK-version specific
  (claude 2.1.205, claude-agent-acp 0.23.1).
- The ACP adapter logged non-fatal `EMFILE` watcher errors (too many open files while watching
  `~/.claude`); they did not affect session creation, load, or the turn. Worth noting for the runner,
  which may hit the same file-watch pressure under load.
- Pi is static-only. The source is unambiguous and the `pi-acp` load path routes through it, but a
  live Pi kill/resume run was not performed.
