# Contract: the harness reconciliation matrix

Status: proposed. This contract answers must-fix item 6 and answer section 3 of
`research/design-gate-review-codex.md`.

This contract corrects the matrix in `spikes/runner-spike.md` and in the runner block of
`decisions.md`. The spike proved which mechanisms exist. It did not prove that a mechanism
installs a new catalog. This contract adds the missing invariant and fixes four rows.

## 1. The applied-generation acknowledgement invariant

### 1.1 The rule

**The runner advances applied state only when the adapter acknowledges the new generation. In
every other case the runner falls back to reopen.**

Sending a Pi hook call does not prove Pi installed the catalog. Emitting an MCP
`notifications/tools/list_changed` does not prove Claude fetched the new list. Both are messages
the runner sends. Neither is a reply.

This restores the core rule of `research/runner-lifecycle-codex.md`: requests describe desired
state, environments own applied state, and applied state is committed only from a successful
result.

### 1.2 What counts as an acknowledgement

An acknowledgement must be an observation the runner makes, not an action the runner takes. It
must identify the generation it confirms.

| Acknowledgement | Strength |
|---|---|
| The adapter returns the installed catalog, and the runner compares it to the desired catalog. | Strong. Preferred. |
| The adapter returns a generation token the runner supplied. | Strong. |
| The harness issues a `tools/list` that the runner answers, and the runner records which generation it served. | Adequate. It proves the client refetched. |
| The runner's own send succeeded. | Not an acknowledgement. Never sufficient. |
| A log line in the harness. | Not an acknowledgement. Not observable by the runner. |

### 1.3 The reconciliation procedure

Every live catalog route follows the same five steps.

1. Build the desired catalog. Compute its generation identifier.
2. Apply the harness-specific mechanism.
3. Wait for an acknowledgement, bounded by a deadline.
4. On acknowledgement, commit the new generation to applied state.
5. On timeout, on a mismatch, or on an error, do not commit. Escalate to reopen. If reopen is
   not available, escalate to rebuild.

Step 5 must never leave applied state partly advanced. A failed acknowledgement leaves the
environment recorded at generation N, which is the truth.

Acknowledgement deadline: 5 seconds. It runs between turns, so it delays the next turn and never
interrupts one.

### 1.4 Reconciliation happens between turns only

The runner must never change a catalog while a turn is running. It must never change a catalog
while an approval-suspended prompt waits.

An approval-suspended prompt is an in-flight turn. Its tool call was gated under one catalog.
Changing the catalog under it would split one logical turn across two configurations. The
execution authorization contract already fails such a call closed, through its
`catalogGeneration` binding. That is a safety net, not a licence to reconcile mid-turn.

So a configuration change that arrives during an approval park is deferred. The runner records
it as a pending delta. It applies it after the suspended prompt finishes, before the next
ordinary turn.

Two classes are exempt and must act at once, or fail closed: a permission tightening, and a
credential revocation. Neither is an ordinary configuration change.

## 2. One generation across the catalog and the execution plan

### 2.1 The rule

**The model-visible tool catalog and the turn's tool execution plan carry one generation
identifier. A turn must never advertise generation N while the relay executes generation N+1.**

### 2.2 Why this is not true today

Read `services/runner/src/engines/sandbox_agent/run-turn.ts` around line 822. The relay is
started with three inputs from two different sources:

- `plan.tools.toolSpecs`, which comes from the environment's stored run plan, built at acquire
  time from the acquiring request;
- `request.toolCallback` and `request.runContext`, which come from the incoming request.

So the relay already mixes acquire-time tool specs with turn-time callback and context. The
lifecycle document flags this. The split must become atomic before any live catalog route ships.

### 2.3 The two objects

The runner splits tools into two objects that share one generation.

| Object | Holds | Consumer |
|---|---|---|
| `ToolCatalogManifest` | Name, description, input schema, read-only hint, permission. Public metadata only. | The harness, through the shim or the extension. |
| `ToolExecutionPlan` | Callback endpoint and authorization, call descriptors, context bindings, gateway references, timeouts, client-tool relay bindings. | The runner's relay and dispatch paths. |

`services/runner/src/engines/sandbox_agent/tools/public-spec.ts` already separates public from
private metadata. That is the seam to build on.

Both objects carry `catalogGeneration`. The turn runner receives both as one unit, freshly built
from the incoming request. It must not read either from `env.plan`.

### 2.4 The canonical generation payload

Gate 2 is right that "changes when the model-visible catalog changes" is not a definition. An
authorization minted under generation N also depends on execution semantics the model never
sees. Those must be in the generation, or the authorization's generation check does not mean
what `execution-authorization.md` §8 claims.

`catalogGeneration` is SHA-256 over the strict canonical serialization of one document. It uses
`strictCanonicalJson` from `execution-authorization.md` §2.3.3, not the lenient serializer.

#### 2.4.1 The document

```
{
  version: 1,
  tools: [ ... one entry per tool, sorted by name ... ]
}
```

Each entry holds exactly these fields, in this order:

| Field | Source | Why it is in the generation |
|---|---|---|
| `name` | The canonical tool key | Identity. |
| `description` | Public metadata | The model chooses on it. |
| `inputSchema` | Public metadata | The model's arguments are validated against it. |
| `readOnly` | Public metadata | The model and the permission policy both read it. |
| `permission` | Execution plan | Whether a call gates. Changing it changes what an approval means. |
| `dispatchKind` | Execution plan | `direct`, `gateway`, `client`, or `relay`. It decides which code path runs the call. |
| `dispatchTarget` | Execution plan | For a direct call, the method plus the path template. For a gateway call, the `callRef`. This is WHERE the call goes. |
| `contextBindingPaths` | Execution plan | The sorted list of bound argument paths. Not their values. A new binding changes which argument the runner overwrites. |
| `argsIntoPath` | Execution plan | Where the model's arguments land in the body. |
| `staticBodyDigest` | Execution plan | A digest of the server-fixed `body` fields. It captures a changed fixed field without copying it. |
| `timeoutMs` | Execution plan | A behavior change the approver could reasonably care about. |

The list is sorted by `name`. The set of tools is part of the document, so adding or removing a
tool changes the generation even when no surviving tool changed.

#### 2.4.2 What is deliberately excluded

| Excluded | Reason |
|---|---|
| Callback authorization | It is per-turn credential material. It rotates on an ordinary turn. Including it would change the generation constantly and would invalidate every parked authorization for no security gain. |
| Gateway or MCP credential values | Same reason. Credentials have their own subsystem and their own epoch comparison. |
| The callback ENDPOINT | Borderline. It is routing, not a credential, and it is already in `configFingerprint`. An endpoint change today evicts the session, so it cannot silently change under a parked authorization. Revisit this if the endpoint ever leaves the fingerprint. |
| `runContext` values | Per-turn data. The BINDING PATHS are included; the values are not. |
| Trace and telemetry identifiers | Per-turn. Never behavior. |
| Tool ordering as delivered | The document sorts, so a reordered input does not churn the generation. |

The rule behind the split: **include what changes the meaning of a call; exclude what rotates.**
A field that changes on an ordinary turn must not be in the generation, or parked authorizations
die for no reason and users re-approve constantly.

#### 2.4.3 Execution-plan-only changes

This is the case gate 2 named as undefined. A change to `permission`, `dispatchTarget`,
`contextBindingPaths`, `argsIntoPath`, `staticBodyDigest`, or `timeoutMs` changes the generation
even though the model-visible catalog is byte-identical.

Two consequences follow, and both are intended.

1. **Parked authorizations minted under the old generation fail closed.** The human approved a
   call that would have gone to one place with one permission. It would now go elsewhere. That
   approval is stale, and `execution-authorization.md` §3.2 refuses it.
2. **The harness needs no reconciliation.** Nothing the model sees changed, so there is nothing
   to install and nothing to acknowledge. The runner advances the generation locally and
   continues. It must not reopen the session for this.

So the reconciliation router reads the generation change and then asks a second question: did
the model-visible part change? If yes, run the harness route from section 1.3. If no, advance
the generation and skip straight to the turn.

This makes the generation serve two consumers correctly. Authorizations need every
behavior-bearing field. Harness reconciliation needs only the model-visible subset. One value
with an explicit split is simpler than two values that can disagree.

#### 2.4.4 Test obligations

- Changing only `timeoutMs` changes the generation, fails a parked authorization, and does NOT
  reopen the harness session.
- Changing only `description` changes the generation and DOES run the harness route.
- Rotating the callback authorization does NOT change the generation, and a parked
  authorization still verifies.
- Reordering the input tool list does NOT change the generation.
- Adding a tool changes the generation even when every existing tool is unchanged.
- Changing a `contextBindings` VALUE source without changing its PATH does not change the
  generation. Changing the path does.

### 2.5 `customTools` and the fingerprint

**`customTools` leaves `configFingerprint` only in the same change that makes the catalog and
the execution plan atomic.**

`customTools` is in the fingerprint today. See
`services/runner/src/engines/sandbox_agent/session-identity.ts` line 231. So a tool-list change
evicts the warm session, and the stale-specs problem never surfaces.

Removing `customTools` first would let a warm session continue with a changed tool list while the
relay still executes the acquire-time specs. That is a stale-tool bug, and it would be a security
bug whenever a removed tool stays executable.

The order is therefore fixed:

1. Build `ToolCatalogManifest` and `ToolExecutionPlan` with one generation.
2. Make `runTurn` take both from the incoming request.
3. Add the acknowledgement mechanism for the target harness.
4. Only then remove `customTools` from `configFingerprint`.

Steps 1 to 3 change no reuse behavior. Step 4 is the only behavior change, and by then the
foundation exists.

Section 2.4 defines the generation these steps compute.

## 3. The corrected matrix

Capability is keyed by harness, adapter version, **and transport or provider**. A single value
per harness is wrong.

### 3.1 Tool catalog

| Harness | Transport | Today | Target | Acknowledgement |
|---|---|---|---|---|
| Pi | Extension, local | `restart-runtime` | `apply-live` | The hook returns the installed active-tool set. The runner compares it to the desired set. |
| Pi | Extension, Daytona | `restart-runtime` | `apply-live` | Same. |
| Claude | stdio shim, Daytona | `reopen-session` | `apply-live` | The shim serves a `tools/list` after the notification and records the generation it served. |
| Claude | HTTP shim, local | `reopen-session` | `reopen-session` in v1 | Not applicable. |
| Codex | stdio or HTTP shim | `reopen-session` | `reopen-session` | Not applicable. |

### 3.2 Model, mode, instructions, skills, harness files

These rows are unchanged from `research/runner-lifecycle-codex.md`, with one addition: the
acknowledgement invariant applies to `setModel` and `setConfigOption` too. A model change is
committed to applied state only when the call returns success for the requested model. This is
the step-2 regression the migration plan already names.

### 3.3 MCP servers

| Harness | Value | Reason |
|---|---|---|
| Pi | `unsupported` | Not `reopen-session`. See section 5. |
| Claude | `reopen-session` | See section 6.3. |
| Codex | `reopen-session` | See section 7. |

## 4. Pi

### 4.1 What the spike proved

`registerTool` is not load-time only. It calls `runtime.refreshTools()`
(`pi-coding-agent/dist/core/extensions/loader.js:184-191`), which is bound to a live
implementation (`dist/core/extensions/runner.js:167`, `dist/core/agent-session.js:1859`). The
refresh rebuilds the registry and auto-activates any name not previously present
(`agent-session.js:1979-1986`). The public extension interface exposes `getAllTools`,
`getActiveTools`, and `setActiveTools` (`dist/core/extensions/types.d.ts:917-921`).

What blocks Pi today is delivery. Specs ride `AGENTA_AGENT_TOOLS_PUBLIC_SPECS`, a process
environment variable read once (`services/runner/src/extensions/agenta.ts:250`, set at
`services/runner/src/engines/sandbox_agent/pi-assets.ts:394`). An environment variable cannot
change on a running process.

The fix is a file plus a hook. The runner writes the specs to a file. The extension re-reads it
and calls `registerTool` and `setActiveTools`.

### 4.2 Removal is hidden, and hidden is not enough

Pi has no deregister call. The only unregister in the interface is `unregisterProvider`, for
model providers. So a removed tool can only be hidden from the active set.

**Hiding is visibility, not revocation.** The tool stays in the registry. The runner still holds
its execution binding. A prompt-injected model that names the hidden tool directly, or a forged
relay record that names it, would still reach the runner's dispatch path.

So Pi removal has two required halves, and both must succeed:

1. `setActiveTools` produces an active set exactly equal to the desired set. Not a superset.
2. **The runner removes the tool from `ToolExecutionPlan`.** The relay must refuse a call for a
   tool absent from the current generation's execution plan, with a deny reason.

Half 2 is the load-bearing half. Half 1 is user experience. The gate review states this as a
blocking execution invariant, and this contract adopts it.

If either half cannot be confirmed, Pi removal escalates to `restart-runtime`.

### 4.3 Pi acknowledgement, and the channel it needs

The extension hook returns the result of `getActiveTools()` after the refresh. The runner
compares that set to the desired active set. Equality acknowledges the generation. Any
difference fails the reconciliation and escalates to restart.

The gate 1 version put that acknowledgement in the relay directory. That was wrong, and gate 2
is right to reject it. The relay directory is sandbox-writable. It is the exact surface that
motivated the whole execution-authorization contract. A forged acknowledgement there would
advance applied state.

#### 4.3.1 There is no fully trusted channel from inside a Daytona sandbox

State this plainly, because it shapes every option below.

On Daytona the Pi extension runs inside the sandbox. So does the Claude stdio shim. Any message
either one sends is a message from the untrusted party. Signing it does not change that: the
signing key must also live inside the sandbox to be usable, and a process that already runs
arbitrary code there can read it.

The read-once file pattern the runner already uses for the OTLP bearer
(`writeOtlpAuthFile` in `services/runner/src/engines/sandbox_agent/pi-assets.ts`, mode `0600`)
raises the cost of a forgery. It does not remove it. A same-user process in the sandbox can read
the file before the extension does.

So the design must not depend on a trusted acknowledgement. It must make a forged one harmless.

#### 4.3.2 Make the blast radius small, then authenticate what is left

Three runner-side rules bound what a forged acknowledgement can achieve. All three already exist
elsewhere in this contract set. This section makes them load-bearing.

1. **The execution plan is runner-side and authoritative.** Section 2.3 keeps
   `ToolExecutionPlan` in runner memory. Section 4.2 half 2 makes the relay refuse a tool absent
   from the current generation's plan. So a forged acknowledgement can never make a removed tool
   executable.
2. **The authorization checks the generation runner-side.** `execution-authorization.md` §3.2
   compares `catalogGeneration` against the runner's own live value, not against anything the
   sandbox reports.
3. **Security-relevant changes never take the apply-live route.** Section 1.4 already exempts
   permission tightening and credential revocation. Add harness permission files to that list.
   These always reopen or restart, and they never wait on an acknowledgement.

With those three, the worst a forged acknowledgement achieves is a **stale model-visible
catalog**: the model still sees a removed tool it cannot call, or does not yet see an added one.
That is a correctness and user-experience defect. It is not a privilege escalation.

A fourth rule bounds it further:

4. **Applied state may only advance to the generation the runner is currently installing.** The
   runner holds one pending generation per reconciliation. An acknowledgement can only confirm
   that pending value. It can never name a generation of its own. So a forged message cannot
   invent a state; it can only claim that a change the runner already decided to make did
   happen.

#### 4.3.3 The channel

Given the above, the acknowledgement channel is defined as follows.

- **Not the relay directory.** The relay directory is swept, sandbox-writable, and already
  carries execution records. Mixing a control-plane message into it invites exactly the
  confusion gate 2 flagged. Use a dedicated path the relay sweep never touches.
- **Per-reconciliation nonce.** The runner mints a fresh random nonce for each reconciliation
  and delivers it through the read-once `0600` file pattern above. The acknowledgement must echo
  it. The nonce is single-use and expires with the reconciliation deadline.
- **The acknowledgement carries** the nonce, the pending generation identifier, and a digest of
  the active tool set. The runner checks all three.
- **Local runs are genuinely trusted.** On a local run the extension executes on the runner host
  under the runner's own user. The file channel there is as trustworthy as the runner. The
  distinction is worth recording, because local is where this can be tested honestly.

#### 4.3.4 The stronger option, if it can be built

The best acknowledgement is a runner-observed effect, not a message. For Pi the candidate is a
runner-side observation of what the harness actually advertises on its next prompt. If Pi's ACP
surface can be made to report its active tool set to the client, the runner reads it directly and
needs no message from inside the sandbox at all.

This contract does not assume that surface exists. The spike did not find one. Record it as the
target design, and use section 4.3.3 until it exists.

#### 4.3.5 The same reasoning applies to Claude

Section 5.3 makes the Daytona stdio shim the acknowledger. The shim also runs inside the sandbox,
so it inherits everything above. It uses the same nonce channel and the same four bounding rules.

Claude's acknowledgement is slightly stronger in one respect: the shim reports that the harness
issued a `tools/list`, which is an event the shim observes rather than a state it asserts. A
forged report still only confirms the pending generation.

### 4.4 Pi and MCP

Pi in the tested version has no MCP client. There is no `*mcp*` module in its distribution and no
`list_changed` anywhere in its tree. The runner also short-circuits MCP for Pi
(`services/runner/src/engines/sandbox_agent/mcp.ts:373`).

So a user MCP server cannot be delivered to Pi at all. The matrix value is `unsupported`, not
`reopen-session`. `reopen-session` implies that reopening would deliver it. Reopening delivers
nothing.

The product consequence must be stated in the user interface: a user who adds an MCP server to a
Pi agent gets nothing. Either the interface refuses the combination, or the runner returns a
clear capability error. Silently accepting the configuration is the worst option.

## 5. Claude

### 5.1 What the spike proved

The shipped Claude binary registers a `tools/list_changed` handler, gated on the server
advertising `capabilities.tools.listChanged`. The handler invalidates the cached tool list,
refetches it, splices the result into live state, and logs "Received tools/list_changed
notification, refreshing tools". It has a documented failure path that keeps the previous tool
set when the refetch fails.

So Claude's client side is built. Our shims are the blocker. Both advertise
`capabilities: { tools: {} }` with no `listChanged`
(`services/runner/src/tools/tool-mcp-http.ts:124`,
`services/runner/src/tools/tool-mcp-stdio.ts:183`).

### 5.2 Capability is keyed by transport

The two shims are not equivalent, and one capability value for Claude would be wrong.

**Daytona, stdio shim.** The transport is bidirectional. The shim owns stdout for the life of
the session (`tool-mcp-stdio.ts:291-333`). It can write an unsolicited notification line. It
must also learn the new specs, because it loads them once at start. Target: `apply-live`.

**Local, HTTP shim.** The transport is stateless JSON. The shim answers every non-POST verb with
405 (`tool-mcp-http.ts:366-370`). The header comment explains why: no SSE, no session id, no
streaming. The MCP server-to-client notification channel is the GET SSE stream, and there is
none. Target: `reopen-session` in v1. Adding Streamable HTTP with SSE is a nice-to-have, and the
gate review agrees.

The capability key is therefore `{harness, adapterVersion, transport, provider}`. A single
`claude: apply-live` entry would make local runs silently stale.

### 5.3 Claude acknowledgement

The runner does not see Claude's internal refresh. It sees the shim.

So the shim is the observer. After it emits the notification, it waits for the client's
`tools/list`. It records which generation it served. It reports that back to the runner over the
relay directory, as in section 4.3.

No `tools/list` inside the deadline means no acknowledgement. The runner escalates to reopen.

### 5.4 Claude MCP servers stay reopen

The Claude ACP adapter enforces this itself. `computeSessionFingerprint` hashes `{cwd,
mcpServers}` (`claude-agent-acp/dist/index.js`, `acp-agent.js:56`), and a mismatch tears the
session down and recreates it (`acp-agent.js:2707-2722`).

A `list_changed` notification does not change the MCP server list, so it does not trip this
fingerprint. The two mechanisms do not conflict.

## 6. Codex

### 6.1 Reopen, and why

`@agentclientprotocol/codex-acp@1.1.7` has zero occurrences of `list_changed` or `listChanged`.
MCP servers become static Codex configuration at session creation: `createSessionConfig` emits
`"mcp_servers"`, consumed only inside `tryCreateSession`. The adapter advertises
`mcpCapabilities: { acp: false, http: true, sse: false }`. No SSE means no server-push channel.
The only "add an MCP server" call is a pre-start builder that mutates the `session/new` request.

The Codex Rust core binary does contain `notifications/tools/list_changed` and an
`rmcp` tool-list-changed type. Whether that is a live handler or a library default could not be
determined from a stripped binary. It does not change the verdict, because codex-acp is the
layer the runner talks to and it has no live path.

Codex stays `reopen-session` for both the tool catalog and MCP servers.

### 6.2 Reopen must verify native history

A reopen preserves continuity only if the native conversation actually loaded. The runner must
verify it, not assume it.

Today the check is an identifier comparison. Read
`services/runner/src/engines/sandbox_agent/environment.ts` around line 1061:
`loadedFromContinuity = environment.session.agentSessionId === priorAgentSessionId`.

That proves the adapter accepted the identifier. It does not prove the adapter replayed the
turns. A `session/load` that succeeds at the transport layer and loads no history would set this
flag to true.

So a reopen for a configuration change must add a positive check before it claims continuity.
Two options, in order of preference:

1. Read back the loaded conversation length or its last message identifier from the adapter, and
   compare it to the runner's own record.
2. If the adapter exposes nothing, treat the reopen as a continuity loss and replay the
   conversation, exactly as a cold turn does.

A reopen that cannot verify history must not report continuity to the user. Silent history loss
is worse than a slower turn.

This obligation is not Codex-specific. It applies to every reopen. It is written here because
Codex is the harness whose only route is reopen.

## 7. The runtime lifecycle stays

The spike's per-harness routes do not remove the need for a runtime and daemon lifecycle between
the harness session and the sandbox. It is still required for:

- older adapter versions with no live route;
- any live application that fails its acknowledgement;
- provider settings and process environment;
- model and MCP credentials, which are create-time on Daytona today;
- harness configuration files, which are opaque and can encode startup and permission behavior;
- Pi tool removal, when the two halves in section 4.2 cannot both be confirmed.

The desired-state and applied-state architecture in `research/runner-lifecycle-codex.md` is
unchanged. This contract changes individual routes inside it.

## 8. Rollout order

Each step ships alone. No step changes reuse behavior until step 5.

1. Split tools into `ToolCatalogManifest` and `ToolExecutionPlan`. One generation. No behavior
   change.
2. Make `runTurn` build both from the incoming request. Remove the `env.plan` read at
   `run-turn.ts:822`. No behavior change.
3. Add the acknowledgement channel over the relay directory. No behavior change.
4. Ship the Pi specs file and the extension hook, plus the Claude stdio shim capability and
   notification. Route both to reopen still, and log the acknowledgement. This is shadow mode.
5. Compare the shadow logs. Flip Pi and Claude-on-Daytona to `apply-live`. Remove `customTools`
   from `configFingerprint` in the same change.
6. Measure observation timing. Set `activeSessionObservation` from the measurement.

Metrics for step 5: per-route reconciliation attempts, acknowledgement successes, timeouts, and
generation mismatches. The rollout must be able to fall back before users see a stale catalog.

## 9. Test obligations

**Acknowledgement.**
- A live route whose acknowledgement times out leaves applied state at generation N and
  escalates to reopen.
- A live route whose acknowledgement reports a different set leaves applied state at N.
- A successful acknowledgement advances applied state exactly once.
- Applied state never advances after a failed action. This is the partial-reconciliation test
  the gate review requires.

**Acknowledgement channel.**
- An acknowledgement written to the RELAY directory is ignored. The runner must not read control
  messages from the relay dir at all.
- An acknowledgement with no nonce, a stale nonce, or a reused nonce is refused.
- An acknowledgement naming a generation the runner is NOT currently installing is refused. This
  is bounding rule 4 in §4.3.2.
- A forged acknowledgement for the pending generation, accepted at face value, still cannot make
  a removed tool executable. Assert on the relay refusal, not on the acknowledgement.
- A forged acknowledgement cannot install a loosened permission. Permission tightening never
  takes the apply-live route, per §1.4 and bounding rule 3.

**Generation payload.**
- The six tests in §2.4.4.

**One generation.**
- A turn's advertised catalog and its relay execution plan always report the same generation.
- A tool removed in generation N+1 cannot execute through the relay, even when the harness still
  lists it.
- Removing `customTools` from the fingerprint without steps 1 to 3 must fail a test. Add the
  test before the removal so it guards the order.

**Pi.**
- Adding a tool mid-session makes it callable, and the hook acknowledges the exact active set.
- Removing a tool hides it AND makes the relay refuse it.
- A `setActiveTools` result that is a superset of the desired set escalates to restart.
- An MCP server configured for a Pi agent produces a clear capability error, not silence.

**Claude.**
- Daytona stdio: a catalog change emits the notification, the shim serves a `tools/list`, and the
  new tool is callable in the next turn.
- Local HTTP: the same change reopens the session. It must not claim apply-live.
- A capability lookup keyed only by harness must fail a test. The key must include transport.

**Codex.**
- A catalog change reopens the session.
- A reopen that cannot verify native history reports continuity loss and replays.

**Between turns.**
- A configuration change arriving during an approval park is deferred, not applied.
- A permission tightening arriving during an approval park is applied at once, or fails closed.

Real harness tests are required for add, replace, remove, reopen, and native-history
preservation, per harness version. The gate review is explicit that static bundle inspection does
not prove apply-live correctness. The spike's evidence is static. It sets expectations; it does
not close the gate.

## 10. Documents to update when this contract is accepted

- `decisions.md`, the runner-spike tools-discovery block. Replace the four verdict lines with
  section 3's matrix, and add the acknowledgement invariant.
- `decisions.md`, the `customTools` prerequisite line. Replace it with section 2.5's order.
- `decisions.md`, open product call 7. Pi removal by hiding is accepted only with section 4.2's
  execution invariant.
- `research/runner-lifecycle-codex.md`, section 3's adapter matrix and the
  `HarnessLifecycleCapabilities` type. The capability key needs transport and provider.
- `spikes/runner-spike.md`, the Part 2 verdict table and summary block.
- `plan.md`. Split slice 7 as must-fix item 7 requires, and adopt section 8's order.

## 11. Gate 2 resolution

| Gate 2 point | Where it is answered |
|---|---|
| New problem 7: the Pi acknowledgement channel is sandbox-writable and forgeable | §4.3 is rewritten. §4.3.1 states that NO fully trusted channel exists from inside a Daytona sandbox, and explains why signing does not fix it. §4.3.2 makes a forged acknowledgement harmless with four runner-side rules, so the worst case is a stale model-visible catalog and never a privilege escalation. §4.3.3 defines the channel: off the relay directory, single-use nonce over the existing read-once `0600` file pattern, echoed with the pending generation and an active-set digest. §4.3.4 names the stronger runner-observed design as the target. §4.3.5 applies the same reasoning to the Claude stdio shim. |
| New problem 8: generation semantics are incomplete for execution-plan-only changes | §2.4 is new. §2.4.1 defines the canonical document with eleven fields per tool, including `permission`, `dispatchKind`, `dispatchTarget`, `contextBindingPaths`, `argsIntoPath`, `staticBodyDigest`, and `timeoutMs`. §2.4.2 excludes rotating credentials and explains the include-what-changes-meaning rule. §2.4.3 defines the execution-plan-only case: the generation advances, parked authorizations fail closed, and the harness session is NOT reopened. §2.4.4 gives six tests. |
| Item 6 status: acknowledgement, generation coupling, transport-specific capability, Pi execution revocation, continuity verification | Unchanged from gate 1. §1, §2.1 to §2.3, §2.5, §3, §4.2, §5.2, §6.2. |

Two things this rewrite makes explicit that gate 1 left implied:

- The four bounding rules in §4.3.2 are now load-bearing, not defense in depth. If §2.3 or §4.2
  half 2 is dropped during implementation, the acknowledgement channel becomes security-critical
  and this contract no longer holds.
- §2.4.3 splits the generation's two consumers. Authorizations need every behavior-bearing field.
  Harness reconciliation needs only the model-visible subset. The router must ask both questions.

Not resolved here, by design:

- Gate 2 item 7, the slice plan, belongs to `plan.md`. §8 gives the order this contract needs.
- Whether Pi's ACP surface can report its active tool set, which would replace §4.3.3 with the
  stronger §4.3.4 design. The spike found no such surface. It needs a live check, not another
  static read.
