# MCP client-tool continuation experiments

This report defines the measurements that decide whether to unlock the deferred warm hold-open
path. It does not change runner behavior. Run the experiments against a pinned local build, attach
redacted traces, and replace only the `PENDING LIVE RUN` values.

## Pinned environment

| Component | Version |
| --- | --- |
| Claude harness (`@anthropic-ai/claude-agent-sdk`) | `0.3.205` |
| Claude ACP adapter (`@agentclientprotocol/claude-agent-acp`) | `0.58.1` |
| MCP SDK (`@modelcontextprotocol/sdk`) | `1.29.0` |
| Node.js | `24.16.0` |
| Agenta runner package | `0.1.0` |

Record the runner image digest, commit, operating system, Claude runtime build, and all configuration
used by the live run alongside the report. If any pinned component changes, start a new report.

## Transport-ceiling protocol

1. Start one local runner environment with one browser-fulfilled client tool. Capture the runner,
   harness, ACP, and MCP logs needed to correlate request identities. Do not enable or implement the
   deferred warm path for this experiment.
2. Trigger the client tool. Record the MCP JSON-RPC request id and the corresponding ACP tool-call
   id before delaying its result.
3. Keep the result pending past the 60-second idle TTL. Fulfill it, then record whether Claude kept
   both ids, closed the connection, retried the call, or settled it with an error.
4. If the request survives the first hold, repeat with a hold past the 300-second approval TTL.
   Increase the hold until the request closes or errors to establish the measured ceiling and a
   safety margin.
5. Measure one quiet pending socket separately from the live Claude process tree. Before opening
   it and while it is pending, record the runner process fd count from `/proc/<pid>/fd` and RSS/PSS
   from `/proc/<pid>/smaps_rollup`. Report the fd, RSS, and PSS deltas. Repeat enough times to
   distinguish the socket delta from process noise.
6. Save timestamps and redacted evidence for each close, retry, error, MCP id, and ACP id. Never
   include bearer tokens, tool arguments, or browser output in the report.

| Transport result | Observed value |
| --- | --- |
| Same MCP request id after more than 60 seconds | `PENDING LIVE RUN` |
| Same ACP tool-call id after more than 60 seconds | `PENDING LIVE RUN` |
| Client close, retry, or settled error after more than 60 seconds | `PENDING LIVE RUN` |
| Same ids after more than 300 seconds | `PENDING LIVE RUN` |
| Measured request lifetime ceiling and safety margin | `PENDING LIVE RUN` |
| One quiet pending socket fd delta | `PENDING LIVE RUN` |
| One quiet pending socket RSS/PSS delta | `PENDING LIVE RUN` |

## Cold-path baseline protocol

Use production traces when they contain the required correlation and cost fields. Otherwise run a
representative QA batch of client-tool turns across the supported Claude configurations. Record the
source, sample size, time window, replica topology, exclusions, and confidence interval.

Measure these five outcomes:

1. First-reissue match percentage: browser results matched by tool name and canonical arguments on
   the first cold reissue, divided by all cold client-tool continuations.
2. Argument-drift re-interaction percentage: continuations where changed arguments cause another
   browser interaction, divided by all cold client-tool continuations.
3. Added continuation cost: additional model calls, p50/p95 latency, input/output tokens, and model
   cost between browser completion and the continued answer. Note any user or support reports tied
   to this cost.
4. Wrong-replica resumption percentage: resumptions handled by a runner replica other than the one
   that parked, divided by all measured resumptions.
5. User wait time: p50, p95, and p99 from browser result receipt to the first continued answer
   event. Report failures separately instead of dropping them from the distribution.

| Cold-path result | Observed value |
| --- | --- |
| First-reissue match percentage | `PENDING LIVE RUN` |
| Argument-drift re-interaction percentage | `PENDING LIVE RUN` |
| Added model calls, p50/p95 latency, tokens, and cost | `PENDING LIVE RUN` |
| Wrong-replica resumption percentage | `PENDING LIVE RUN` |
| User wait time p50/p95/p99 | `PENDING LIVE RUN` |

## Unlock-gate scorecard

Both gates must pass before work on WP2 through WP5 can begin. A transport failure cuts the warm
path permanently. A value-gate failure keeps it deferred.

| Gate | Passing rule | Measurement | Decision |
| --- | --- | --- | --- |
| Transport | The original MCP request remains usable for at least 60 seconds, with a measured ceiling and safety margin. | `PENDING LIVE RUN` | `PENDING LIVE RUN` |
| Value | First-reissue mismatch is greater than 5%, argument-drift re-interaction is greater than 2%, or cold continuation adds user-visible p50 latency measured in seconds or model cost that users or support report. | `PENDING LIVE RUN` | `PENDING LIVE RUN` |

Overall warm-path decision: `PENDING LIVE RUN`.
