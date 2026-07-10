# Design

Three decisions. D1 surfaces the resolver's error detail end to end. D2 chooses what a run
does when one tool of several fails to resolve. D3 settles whether the discover-resolve
drift from #5174 belongs here.

## D1: Surface the resolver's error detail end to end

### The problem, restated

The backend already produces the useful sentence and puts it in the HTTP response body
(`{"detail": "Action not found: composio/github/COMMIT_MULTIPLE_FILES"}`). The SDK reads
only the status code and discards the body (research.md step 3). So this is not a missing
message. It is a message that gets thrown away one hop before the user.

### The fix

In `gateway.py`, when the resolve response is a non-2xx, read the body, pull `detail` out of
the FastAPI error envelope, and carry it on the exception. The run error then reads, for
example:

```
Gateway tool resolution failed: Action not found: composio/github/COMMIT_MULTIPLE_FILES (HTTP 404)
```

instead of the bare `HTTP 404`.

### Interface shape (design-interfaces review)

The new information is a **diagnostic metadata** field: a human-facing reason string that
travels from the server to the SDK exception to the run error. It is not routing, not
policy, not credentials, not config. Classify and name it accordingly.

- Add a `detail: Optional[str]` field to `ToolResolutionError` (sdks tools/errors.py),
  alongside the existing `status`, `ref_count`, `reference`. The name mirrors the HTTP body
  field and the backend exception messages, so the vocabulary stays consistent across the
  boundary.
- Fold `detail` into the exception's message string so any caller that only prints the
  exception still shows it. Keep the structured field too, for callers that format richly.
- Guard the read. If the body is not JSON, or has no `detail`, fall back to a bounded slice
  of `response.text`. Cap the length so a stray HTML error page cannot flood the run error.

### Trade-offs and risks

- This leaks whatever the resolve endpoint chose to put in `detail`. Today that is catalog
  and connection messages, which are safe. The guard should keep it to `detail` plus a
  bounded text fallback, not the whole body, so a future endpoint change cannot turn this
  into an accidental data channel.
- With today's fail-on-first-bad-ref backend, the 404 body names exactly one action even
  when two are dead. That is fine for D1 on its own. Naming every failing tool at once
  needs the structured per-reference errors from D2.

### Layer check

This is squarely an SDK fix (read the body you already receive). It respects the repo rule
that agent-facing failures get handled at the SDK layer, not with a core-API special case.
The backend already does the right thing.

## D2: What a run does when one tool of several fails to resolve

This is the policy question. Three options, most contained first.

### Option A: Fail the turn, but with a clear, named error

Keep resolution all-or-nothing. Apply only D1, so the failure now names the tool and the
reason. Simplest possible change. One dead tool still stops the agent, but the user learns
exactly which tool to remove and why, from the run error alone, with no backend access.

- Pro: tiny, safe, no contract change. Fully addresses problem 1 (opacity).
- Pro: no silent capability loss. The run either works with all its tools or fails loudly.
- Con: does not address problem 2. A stale action still bricks a committed agent until a
  human edits the config. For an agent running unattended, that is an outage until someone
  notices.

### Option B: Resolve the survivors, drop the dead tool, warn loudly

Resolve the tools that resolve, drop the ones that do not, run the turn with the survivors,
and surface a prominent, non-fatal warning that names each dropped tool and why. The agent
keeps working with its good tools.

This needs a contract change. `POST /tools/resolve` stops failing the batch on the first bad
reference. It returns the resolved specs plus a per-reference list of failures (reference,
status, reason). The backend `resolve_tools` collects outcomes instead of raising on the
first. The SDK builds specs for the survivors and threads the failures into the run as a
visible warning, not an exception.

Not every failure should be dropped. Classify by kind:

- **Genuinely-absent action** (404 action-not-found): safe to drop. The tool does not exist;
  there is nothing to fix in the connection. Drop it and warn.
- **Connection or auth failure** (connection missing, inactive, invalid): do not drop. This
  is an actionable state the user must fix, and silently continuing hides a problem the user
  can and should resolve. Keep these fatal, with D1's clear message.
- **Provider or network error** (5xx, timeout): keep fatal. This is transient, not a dead
  tool. Dropping a tool because the provider blipped would hide the outage and silently
  change the agent's capability for that turn.

The visible warning matters. A dropped tool is a silent capability change: the model may
need the tool and now cannot call it, producing a subtly wrong answer with no hard error. So
the warning has to be loud and it has to reach the model, not just the human. Per the repo
rule, telling the model "the tool X was unavailable this turn" belongs in the run context or
a system note the SDK injects, not in a core-API behavior change. The backend contract change
is a general partial-resolution contract, not a special case for a named tool, so it is a
legitimate contract, not an agent-guidance special case.

- Pro: directly fixes problem 2. A committed agent survives one rotted tool.
- Pro: the drop is scoped to the one failure kind where dropping is unambiguously correct.
- Con: silent capability loss is a real hazard. The warning design carries the weight, and a
  warning is easier to ignore than an error. Getting it in front of both the model and the
  user is the hard part, not the resolution change.
- Con: a contract change on `/tools/resolve` (response gains a per-reference failure list)
  plus SDK and run-context work. Larger than A.

### Option C: Surface tool health where the agent is configured

Resolve the config's tools at commit or edit time and flag dead tools in the UI, so the user
sees a broken tool before any run. Runs then either fail fast (A) or drop-and-warn (B), but
the user already knew which tool was dead.

- Pro: best user experience. The problem shows up where the user can fix it, not mid-run.
- Pro: overlaps naturally with #5174's validate-on-discover, so the two can share one
  "is this action resolvable" check.
- Con: largest surface. It needs a validation endpoint (or reuse of resolve) plus frontend
  work on the agent config screen. It is a project of its own.

### Recommendation

Layer A, then B, and defer C.

- Ship **A** first as the contained, safe fix. It fully closes the opacity problem and needs
  no contract change. It is valuable on its own and unblocks nothing.
- Follow with **B**, scoped so only a genuinely-absent action is dropped, with connection,
  auth, and provider failures staying fatal, and with a loud warning that reaches both the
  model and the user. This closes the all-or-nothing problem for the one case where dropping
  is clearly right, without pretending a broken connection is fine.
- **Defer C** to a follow-up. It is the best UX but it is a frontend and validation-surface
  project, and it depends on the same resolvability check #5174 introduces. Scope it here,
  build it there.

## D3: Does the #5174 discover-resolve drift belong in this plan?

No. Keep it separate. Cross-link the two.

### Why separate

- #5174 is a **root-cause** fix: discover and resolve ask Composio under different implicit
  version scopes, so discovery surfaces actions that resolve cannot find. Its remedy is
  validate-on-discover, explicit version pinning, and version as part of tool identity. That
  is a large, self-contained surface with its own contract and data-model changes.
- #5173 and F-019 are **symptom-handling**: surface the failure and stop it bricking the
  agent. That is this workspace.
- The maintainer framed them this way in the issue comments: #5174 is the root cause, #5173
  is the symptom side.

### Why symptom-handling is needed even after #5174 lands

Validate-on-discover stops a fresh build from picking a dead action. It does not stop a
**committed** agent from rotting. Composio can remove an action months after an agent was
built. When it does, the committed config still points at the now-dead action, and the run
fails at resolve time exactly as F-019 shows. So the surfacing (D1) and the resilience (D2)
are necessary regardless of #5174. This plan is not blocked on #5174 and does not block it.

### Where the two plans touch

One shared primitive: a single "can this action resolve" check. #5174 needs it to filter
discovery output. D2 option B needs it to classify a failure as a genuinely-absent action.
And D2 option C, when built, needs it to flag dead tools in the UI. If #5174 lands first, D2
should reuse its check rather than add a second one. If this plan lands first, keep the
classification in the resolve path where #5174 can call it. Either order works. Note it as a
coordination point, do not couple the two plans.
</content>
