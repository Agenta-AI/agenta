# Context

## The symptom

A multi-tool agent — the `uc9-digest` repo-digest agent: `LIST_COMMITS`, `LIST_REPOSITORY_ISSUES`,
`LIST_ALL_CHANNELS`, then `SEND_MESSAGE` — is invoked with one instruction to run all four steps
and post to Slack. The batch invoke (`POST {host}/services/agent/v0/invoke`, default
`Accept: application/json`) returns:

```
I have all the data. Picking `team-testing` (C085TMJJ0PK) as the test channel and posting the
digest now.
```

That is the whole response body's assistant content: a **mid-sentence** string that ends right
before the terminal tool call. There is no indication that the four tools ran, no digest content,
no confirmation the post happened. A caller reading only this response cannot tell success from a
run that wandered off and never posted. To find out, the builder kit runs a **second** request
against `/api/spans/query` (`check-tools.sh`) and reads the tool spans.

## The live reproduction (batch vs streaming, same input)

Same agent, same message, two calls that differ only in the `Accept` header.

**Batch** (`Accept: application/json`) — trace `901d24c25f3491fe3badbbb521ea5a55`:
- Response: one assistant message, `"...posting the digest now."` (105 chars, mid-sentence).
- `/api/spans/query` on the trace: all four tools executed, including `SEND_MESSAGE`.

**Streaming** (`Accept: application/x-ndjson`) — trace `894862fe8af0c3aae9e63e2637babab9`:
- 48 events: `thought_*`, `message_*`, **4 `tool_call`** (`LIST_COMMITS`,
  `LIST_REPOSITORY_ISSUES`, `LIST_ALL_CHANNELS`, `SEND_MESSAGE`), **3 `tool_result`** (the three
  reads), `usage`, one `interaction_request` (`kind: user_approval` on `SEND_MESSAGE`, carrying the
  full rendered digest as `payload.toolCall.rawInput`), then `done`.
- `/api/spans/query`: the same four tools executed.

The streaming response is far more self-describing: it shows every tool the run called, in order, up
to the terminal `SEND_MESSAGE`, plus the exact channel and digest text that tool was called with. The
batch response, for the identical run, shows none of it. (Streaming still stops at the approval gate —
that is the separate bug below.)

Streaming is not a workaround bolted on for this test. It is a first-class negotiated format the SDK
routing already supports (`Accept: text/event-stream | application/x-ndjson | application/jsonl`, or
`flags.stream: true`). All three return 200 with the full event stream.

## The direction: stream everywhere, leave batch alone

Batch returns only the final assistant text by design, and it stays that way. It is the right shape for
a caller that wants one final message. We are **not** reshaping batch or coalescing the full turn into
its response.

The answer to "the multi-tool output is unreliable" is to use **streaming** on every path that needs
the whole turn. There are two such paths:

1. **The external client.** A client asks for a stream (`Accept: application/x-ndjson`) and reads the
   full turn directly. This is already done in the lab kit (`test-agent.sh` streams and prints the
   ordered tool list; see `plan.md`).
2. **The platform's own invoke.** When Agenta invokes an agent from *inside* the platform — an agent
   invoking another app/agent as a tool, an evaluation running a workflow-under-test, a trigger firing
   a workflow — the same batch-vs-stream choice applies, set by the `Accept` header the platform sends.
   Today those paths send `Accept: application/json` and read a single batch body, so they hit the
   identical empty/mid-sentence problem, now server-side. The platform-side change is to make the
   result-consuming invoke paths stream and drain the event stream. Where the platform invokes agents,
   which paths are batch today, and the proposed change are in `plan.md` and `research.md`.

## The second finding: the approval boundary is a bug

The streaming run stops at the `SEND_MESSAGE` gate: it emits `interaction_request` and then `done`,
and the terminal tool's `tool_result` never streams, even though `SEND_MESSAGE` is set to
auto-approve. The user's read is that an auto-approval inside the sidecar is not a real interaction, so
the run should continue. That read is correct: this is a bug.

The runner's `HITLResponder.onPermission` parks on any "human surface" *before* it consults the `auto`
policy (`services/agent/src/responder.ts:257`), and the SDK mints a `sessionId` for every invoke, so
`hasHumanSurface` is always true and the `auto` policy is never applied in-band. The playground hides
this by auto-resending the conversation on the park (a resume); a one-shot invoke has no resume, so the
run just stops. The full investigation — the root-cause chain, the harness nuance (Claude gates, Pi
does not), the frontend resume mechanism, when it was introduced (commit `b109cc51ef`, 2026-06-25), and
the recommended fix — is in `approval-boundary.md`.

## Goals

- Every path that needs the full turn uses streaming: the external client (done) and the platform's own
  internal invoke paths (proposed).
- Leave batch as it is: one final assistant message, negotiated by `Accept: application/json`.
- Fix the approval-boundary bug so an auto-approved run continues in-band and its terminal tool's result
  reaches the streamed output.

## Non-goals

- Changing the batch response shape or the `flags.history` knob.
- Changing how the runner produces events, or the tracing pipeline.
- Request-shape validation (owned by the sibling `invoke-validation/`).
- Building an interactive human-approval reply channel over one-shot HTTP invoke. The approval-boundary
  fix only asks that an *auto*-approved tool run in-band; it does not add human approval to a headless
  call.
</content>
