# Design

## The shape of the thing

Pi fires a `tool_call` event before it runs any tool, and the handler can block. We add that
handler to our extension, and it does one job: the per-call policy check. For each builtin
call it asks the runner: allow, deny, or ask? The runner decides with the real name and real
arguments in `decide()`, then the handler enforces the answer.

Which builtins exist at all is a separate question with a separate mechanism (next section).
The hook never re-checks the grant: a non-granted builtin is not in Pi's active tool set, so
no call for it ever fires.

The runner decides. The extension only reports and enforces. That is the whole design in one
line, and it is the line that keeps the "one decision module" doctrine intact.

### What our extension does today

Two things, neither about permissions. It registers the resolved custom and relay tools with
`pi.registerTool`, so the model can call them and each call round-trips to the runner through
the relay directory. And it flushes tracing and usage data on `agent_end`. The bundle
(`dist/extensions/agenta.js`) is installed into the per-run agent dir on every run, local and
Daytona. This design adds the `tool_call` policy hook and the active-tool-set edit to that
same bundle; nothing else about the extension changes.

## The grant list: one config, enforced at the only layer we can reach

The author's builtin selection already exists and stays the single source of truth: the
builtin entries in the agent config, shipped on the wire as `tools` ("built-in tools to
enable"). This design adds no second configuration. The open question was only where to
enforce the one that exists, because today nothing does (the wire field lost its last reader
in `0e71bd0f7a`).

The declarative route (write the grant into a Pi config file, the way Claude gets
`.claude/settings.json`) does not exist: Pi's settings schema has no tool field of any kind
(its settings.md covers extensions, skills, packages, prompts, and themes; see research.md,
"Native tool-selection surfaces"). Pi does take a grant list natively, but only at process
launch: `pi --tools read,bash,...` (args.js:79-95), or `createAgentSession({ tools })` in the
SDK, which is exactly what the deleted in-process engine passed. Neither is reachable on our
path. The runner talks to sandbox-agent, whose `SessionCreateRequest` has no tools field; the
ACP `session/new` schema carries only `cwd` and `mcpServers`; and pi-acp hard-codes pi's argv
(`--mode rpc --no-themes`, pi-acp index.js:134). Every layer between the runner and the flag
drops it.

That leaves one enforcement point we control today: our extension, which runs inside the
already-spawned pi process. Pi exposes `pi.setActiveTools([...])` and `getActiveTools()` /
`getAllTools()` on the extension API (research.md). When gating is active, the extension sets
the active set so that only the granted builtins remain, and the model never sees a
non-granted builtin.

The durable fix is upstream, and it is filed as a follow-up rather than built here: a `tools`
field on sandbox-agent's `SessionCreateRequest`, forwarded by pi-acp into pi's argv (or an
env-driven passthrough in pi-acp, which already inherits the runner-controlled environment).
When that lands, the extension's active-set edit disappears and the same config flows
declaratively. The author config, the wire field, and the playground control are identical in
both worlds; only the enforcement mechanism moves.

### The folder is the delivery vehicle either way

We do use folders, exactly as the setup path does for skills and prompts: the extension ships
inside the per-run agent dir. The folder route and the extension route are the same route.
What Pi lacks is only a declarative settings field for tools, so the folder must carry a
small piece of code instead of a config line. If Pi grows that field, the folder carries
config and nothing else moves.

That shape buys a property the review named as a goal in its own right: portability. Any Pi
process that loads the agent dir enforces the same grant, whether pi-acp spawned it under our
runner or someone runs `pi` natively against the same directory. The configuration travels
with the folder, not with our transport. The two non-ACP alternatives fail exactly this test:
a `pi` binary shim in the sandbox image (wrap the real binary, inject `--tools` from a
runner-set env var) reaches the native flag today but couples enforcement to our images and
breaks native use; waiting for the upstream passthrough leaves the grant dead in the meantime
and only ever helps runs that go through sandbox-agent.

Two corrections from the Codex review shape how this is done:

- **Not at extension init.** Pi's loader stubs the action methods while the factory loads, so
  `setActiveTools` cannot run at init; only `registerTool` is safe there. The active-set edit
  runs at an early runtime event instead, `before_agent_start`, and the build must verify it
  takes effect for the current turn's system prompt (so the model does not see a tool that is
  about to be removed).
- **Replace only the builtin portion.** Do not set the active list to "granted builtins plus
  the custom tool names I registered". That could drop a user or local extension tool, or
  activate one that was off. Read the current active set with `getActiveTools()`, read the
  full set with `getAllTools()`, and replace only the seven builtins' slice with the granted
  subset. Non-builtin tools pass through untouched.
- **`before_agent_start` handlers chain on a stale prompt copy.** Pi runs every registered
  `before_agent_start` handler in turn, and each receives the current system prompt and may
  return a replacement. A handler that built its replacement from a copy it captured before
  our edit ran can hand back a prompt that still lists a builtin we just removed, silently
  leaking it back in after `setActiveTools` already rebuilt the base prompt. The Phase 2 build
  must assert, in a test, that a removed builtin's name is absent from the *final* system
  prompt of the turn, not just from the value our own handler returns. Other extensions calling
  `setActiveTools` again after ours, to re-enable a builtin we removed, is out of scope for this
  slice: every run we install carries exactly one extension, ours. That becomes a real ordering
  question the day a user-supplied Pi extension ships alongside ours, and is noted here so it is
  not forgotten then.

The `tool_call` hook is then free to handle only the per-call policy on the tools that are
enabled; the grant never needs re-checking at call time.

The `tool_call` hook never checks the grant. A non-granted builtin is not in the active set,
so no call for it ever fires, and there is nothing for the hook to check. If a call for a
non-granted builtin somehow does fire anyway, that means the active-set edit did not take
(a bug in the `before_agent_start` path), and it surfaces there, on the policy side, not as a
second grant check in the hook. Phase 2 verifies live that `before_agent_start` actually hides
the tool from the model for the current turn.

## The permission record on the relay protocol

The per-call policy check reuses the relay directory. The extension already knows how to
write a request file and poll for a response (dispatch.ts `relayToolCall`). A permission check
is a new record on the same channel.

I apply the interface-design lens: classify each field by what it *is*, not by the feature it
serves.

**Request record** (`<id>.req.json`, extended with a discriminator):

| field | role | why it is here |
| --- | --- | --- |
| `kind: "execute" \| "permission"` | protocol / routing | Tells the runner loop which branch to run. Absent means `"execute"`, so the existing custom-tool record is unchanged. |
| `toolName` | data / identity | The builtin name (`bash`), the thing being decided. |
| `toolCallId` | protocol context | Correlates the response file and names it. Already present. |
| `args` | data | The real `event.input`. Load-bearing: prefix rules and read classification need it. |

No credentials, no config, and no policy live in the record. Credentials never touch the
sandbox by design. Policy lives in the runner. The record carries only what the runner cannot
otherwise know: which builtin, which call, which arguments.

The TS types are a real discriminated union, not "RelayResponse plus an optional field". An
execute response and a permission response mean different things, so they are distinct types
keyed by `kind`. The permission response also carries `kind: "permission"` (or is parsed
through a dedicated `PermissionRelayResponse` validator) so that the existing `relayToolCall`
path can never mis-read one. Without that, a permission response `{ ok: true, verdict:
"deny" }` would look to `relayToolCall` like an empty successful tool result.

**Response record** (`<id>.res.json`, its own permission variant):

| field | role | why it is here |
| --- | --- | --- |
| `kind: "permission"` | protocol / routing | Marks this as a permission response so no other reader parses it as a tool result. |
| `ok` | protocol | False on a runner-side error; the handler then fails closed per the failure-mode table below. |
| `verdict: "allow" \| "deny" \| "pendingApproval"` | control | The decision module's own verdict, transported verbatim. The hook maps anything but `allow` to Pi's `{ block: true }`. Named after `decide()`'s vocabulary so the wire and the module read the same. |
| `reason?` | data | The text shown to the model on a block, reusing the authored-deny and policy-deny wording from relay.ts. |

The wire carries `pendingApproval` verbatim, but in Pi it lands as a block, because on a
builtin **Pi is the executor**. The runner cannot withhold execution the way it does for a
custom tool; the only way to stop Pi from running the builtin is for the hook to return
`{ block: true }`. So a pending verdict produces two things at once: the runner pauses the
turn through `onPendingApproval` (the normal ask path), and the hook blocks the native call.
On resume the model re-issues and the stored decision replays. See the flow and the risk
below.

### Why a discriminator rather than a second file suffix

A `kind` field keeps one request stream and one response stream, so `startToolRelay`'s single
poll loop, its `seen` set, and its host abstraction all serve both record types unchanged. A
separate suffix pair would fork the loop. The discriminator is the smaller change and reads
more honestly: these are two variants of "the sandbox is asking the runner about a call", not
two protocols. The Codex review agreed, on the condition that the records be a real
discriminated union (not one type with optional fields) and that the permission response go
through its own validator, both folded in above.

## Mapping to the GateDescriptor

The runner's permission branch builds a `GateDescriptor` from the record:

- `executor`: `"harness"` (see the executor question below).
- `toolName`: the builtin name from the record, normalized (see below).
- `readOnlyHint`: looked up in the runner-side table (`read`, `grep`, `find`, `ls` = read;
  `bash`, `edit`, `write` = write). Not sent by the sandbox. Classification stays runner-side.
- `args`: the real arguments from the record.
- `specPermission` and `serverPermission`: unset. A builtin has no resolved spec and no MCP
  server, so its permission comes from pattern rules and the global default only.

**Match projection (from the Phase 0 spike).** The model sometimes adds a benign optional
parameter on re-issue (observed once in thirteen spike runs: `timeout: 10` appeared on a
`bash` call). Full-args matching would miss and re-prompt, which is safe but needless
friction. The builtin table therefore also owns a per-builtin match projection used ONLY for
stored-decision matching: `bash` matches on `command` alone (the command carries the full
semantics; a timeout cannot change what runs), while `edit` and `write` keep full canonical
args (a content change must never auto-match a stale approval), and the read-only builtins
keep full args too. The projection never affects the permission decision itself, only the
resume-match key.

**Case normalization.** Authored rules use the Claude-style capitalized vocabulary, for example
`Bash(npm:*)`, because that vocabulary was written for Claude's tool names. Pi's builtin names
are lowercase (`bash`, `read`, `edit`). Left alone, a `Bash(...)` rule would never match a Pi
`bash` call, and gating would silently fall through to the global default instead of the
authored rule. The permission-record handler normalizes the builtin name through the same
runner-side table that supplies `readOnlyHint`: one table maps a Pi builtin name to both its
canonical rule name and its read-only bit, so `Bash(npm:*)` matches a Pi `bash` call regardless
of which casing the author used. That table is the single place builtin identity lives; nothing
else invents a second mapping between Pi's names and the authored rule vocabulary.

Then it calls the same `decide(gate, permissionPlan, decisions)` the relay already uses and
writes the verdict verbatim: `allow` -> `{ verdict: "allow" }`; `deny` -> `{ verdict: "deny",
reason }`; `pendingApproval` -> call `onPendingApproval`, then `{ verdict: "pendingApproval",
reason }`. The verdict-to-block mapping lives in the extension hook at the Pi boundary, the
one place that knows Pi's `{ block: true }` mechanics.

### The executor question: reuse `"harness"`, not a new value

The Codex review talked me out of a new `"builtin"` executor, and I agree. `GateExecutor`
names the *component* that executes the tool. Pi runs its own builtins, so the executing
component is the harness. `executor: "harness"` is the honest value. The things I thought
justified a new value are real but belong elsewhere:

- **Pending means block here, not withhold.** True, but that is post-decision handling, and it
  is split across two places, not owned by the descriptor. The runner-side handler writes the
  verdict verbatim (`{ verdict: "pendingApproval", reason }`); the extension hook, the one place
  that knows Pi's `{ block: true }` mechanics, maps that verdict to a block. The descriptor does
  not need to encode either half.
- **`readOnlyHint` has a different source.** Also true, but it is resolved before the
  descriptor is built. The handler looks it up in the runner table and sets the field. The
  descriptor just carries the resolved hint, same as for any tool.

If a genuinely separate dimension is ever needed (for example to branch resume anchoring by
tool category), add a named dimension like `toolClass` or `gateSource`, not an executor value
named after a tool category. For now `"harness"` plus a builtin-aware handler covers it with
no new enum value.

## Env config shape

`buildPiExtensionEnv` (pi-assets.ts) gains the gating config so an allow-everything run pays
nothing. Proposed variables, read by the extension:

- `AGENTA_AGENT_BUILTIN_GATING = "true"`: the master switch. When absent the extension does
  not register the `tool_call` hook and does not touch the active tool set. Native builtins
  behave exactly as they do today. This keeps a plain `pi` session and any all-`allow`,
  all-granted run completely untouched. One catch the Codex review caught: the extension's
  inertness guard (agenta.ts:165) currently returns early when a run has no tools, tracing, or
  usage. A gating-only run (gated builtins, no custom tools, no tracing) hits that early return
  and never registers the hook. The guard must add `hasBuiltinGating` so gating alone keeps the
  extension live.
- `AGENTA_AGENT_BUILTIN_GRANTS`: a JSON array of the granted builtin names, from
  `request.tools`, de-duped and filtered to the seven known builtin names. Drives the
  active-set edit, the only place the grant is enforced. Decide explicitly whether an unknown
  name is dropped or fails the run closed; the lean is to drop unknowns and log.
- `AGENTA_AGENT_TOOLS_RELAY_DIR`: already exists. Reused for the permission records. Must now
  be set when gating is active even with zero custom tools.

The runner decides when gating is active. The Codex review corrected two things here:

- **Compute from the resolved plan, not the raw request.** Derive the policy from
  `permissionsFromRequest(request)` (permission-plan.ts:58), not raw `request.permissions`.
  That function folds in the operator kill switch (`SANDBOX_AGENT_DENY_PERMISSIONS=true`) and
  the invalid-policy fail-to-ask behavior. A fast path off the raw field would bypass the kill
  switch.
- **The grant list alone can require gating.** Pi's default active builtins are `read`, `bash`,
  `edit`, `write`, not all seven. So the requested grant set can differ from Pi's default even
  under a blanket `allow`: `tools: ["read", "write"]` must run gating to remove `bash` and
  `edit`; `tools` that includes `grep`, `find`, or `ls` must run gating to enable them. And
  `tools: undefined` (author never chose) is not the same as `tools: []` (author chose none).

So gating is active when the run is Pi and either the resolved policy could produce anything
other than `allow` for a builtin (any mode except blanket `allow`, or any pattern rule touching
a builtin), or the requested grant set differs from Pi's default active builtins. When neither
holds, gating stays off and the fast path is unchanged. When unsure, default to on; an
on-gating run with an all-`allow` policy just allows every call at the cost of one relay
round-trip per builtin.

## Starting the relay when gating is active

`useToolRelay` at run-plan.ts:329 becomes `toolSpecs.length > 0 || builtinGatingActive`, and
the relay-dir creation in workspace.ts follows the same condition. The relay then runs for a
Pi run that has gated builtins and no custom tools.

## The pause and resume flow

Consider an agent with `bash: ask` and a user watching the playground.

1. The model calls `bash` with `{ command: "npm test" }`. Pi fires `tool_call` before running
   it.
2. The extension hook fires (a non-granted builtin would not be in the active set, so no
   grant check happens here). It writes a permission record `{ kind: "permission", toolName: "bash", toolCallId, args: { command:
   "npm test" } }` and polls for the response.
3. The runner loop reads the record, builds the `GateDescriptor` (`executor: "harness"`,
   `readOnlyHint: false` from the table, real args), and calls `decide()`. The effective
   permission is `ask`, and no stored decision exists, so the verdict is `pendingApproval`.
4. The runner calls `onPendingApproval`. It acquires the single-pending latch, marks the
   paused tool call, emits the `interaction_request` event the playground renders as
   Approve/Deny, records the durable interaction, and pauses the turn. It also writes the
   response `{ kind: "permission", verdict: "pendingApproval", reason: "Waiting for approval of bash." }`.
5. The hook reads the `pendingApproval` verdict, verbatim as the runner wrote it, and maps it
   to `{ block: true, reason }`. Pi does not run the shell command. The turn is already
   pausing, so the model does not act on the reason this turn.
6. The user clicks Approve. The run resumes. The stored decision now holds `allow` for this
   builtin and these args.
7. The model re-issues the `bash` call. The hook checks again, the runner's `decide()` finds
   the stored `allow`, and the response is `{ kind: "permission", verdict: "allow" }`. The hook
   maps `allow` to nothing (no block), Pi runs the command, and the turn continues.

For `deny` the flow stops at step 3: the runner writes `{ verdict: "deny", reason }` verbatim
and the hook maps it to a block with the deny reason. For `allow` the hook writes and reads a
round-trip that always says allow; that is the overhead the gating-active predicate exists to
avoid on all-`allow` runs.

## Failure modes

**The re-issue risk (top risk).** Step 7 assumes Pi re-issues the `bash` call after the block
plus resume. The relay-ask flow proves the model re-issues a *custom* tool after a pause,
because the pause path is shared. A builtin blocked through `tool_call` is a different
stimulus. The Codex review confirmed from Pi's source that Pi core turns `{ block: true }`
into an **error tool result** carrying the reason, not a silent hold. So whether the model
re-issues is entirely a model-behavior question, and it is unverified. If Pi does not
re-issue, the approved call never runs and the agent stalls.

Mitigation is a real spike, not a soft fallback. Phase 0 must watch the actual resumed
transcript with the real runner pause and teardown in the loop, not a throwaway local block.
Treat "the retry-nudge reason works" as an observed outcome to confirm, never as a guarantee
to lean on. If Pi does not reliably re-issue after approval, this design should stop and go
back to you, because the alternative (holding the turn open on the hook side instead of
blocking) is a materially different design.

**Relay polling timeout.** The hook polls for the decision up to 60s (`RELAY_TIMEOUT_MS`). The
runner must therefore **always** write a response for a permission record, including on
pending. This is the key divergence from the custom-tool relay, which writes nothing on
`PAUSED`. If the runner ever failed to write, the hook would hang for 60s and then Pi would
surface a tool timeout error. The Phase 1 loop writes a response on every branch, and a test
pins that.

**Concurrent builtins and the single-pending latch.** Pi preflights sibling tool calls
sequentially, then runs them concurrently. Two builtins in one assistant message can both be
pending. The latch lets only the first raise an approval event. The second still needs a
response so its hook does not hang, so on a pending-but-latch-held call the runner writes
`{ kind: "permission", verdict: "pendingApproval", reason: "Another approval is pending;
retry after it resolves." }`. The second call is refused this turn and re-issued later.

This needs a small contract change the Codex review flagged: `RelayPermissions.onPendingApproval`
returns `void` today (relay.ts:69), so a caller cannot tell whether it actually raised the
event or the latch was already held. Change it to return a boolean (or `{ emitted: boolean }`)
so the permission handler writes the plain waiting-for-approval reason when it emitted, and the
another-approval-pending reason when it did not. A test covers two concurrent pending builtins.

**Args mutation ordering.** The `tool_call` handlers chain, and an earlier handler can mutate
`event.input` (our tracing handler does not, but Pi's docs allow it). The permission check
must read the input the tool will actually run with. Our hook reads `event.input` at call
time and the runner decides on that snapshot, so a later mutation by another handler would
escape the gate. We register the permission hook so it runs after any argument-normalizing
handler, and the plan notes this ordering as a review point.

**Fail direction on a runner error.** If the runner writes `{ ok: false }` or the record is
malformed, the hook fails closed: it blocks the call with a generic reason. An
uninspectable decision must never fall through to running the tool, mirroring the runner's own
rule that an unparseable policy asks rather than runs (permission-plan.ts:74).

**Daytona teardown.** On Daytona a pause disposes the sandbox (F-040). The in-sandbox hook is
mid-poll when that happens. It dies with the sandbox, which is fine: the decision already
emitted its event and paused the turn on the runner side. The runner-side response write may
race the teardown; the write is best-effort and the resume path does not depend on it.

**Version skew between the runner and the baked extension bundle.** The runner installs a
pre-built bundle, `dist/extensions/agenta.js`, not the source tree. A stale bundle means the
gating hook and the active-set edit silently do not exist in the running agent, even though the
runner-side code looks correct. This exact class of bug bit us before, when a stale bundle
silently dropped custom tools. The permission record carries a `protocol: 1` field to catch it
mechanically rather than relying on remembering to rebuild: the runner's permission-record
handler fails closed (verdict `deny`, logged loudly) on a missing or unrecognized protocol
version, and the extension hook treats a malformed or version-mismatched response the same way.
A version bump on either side without the matching bump on the other fails loud, not silent.

## What stays out of the sandbox

The sandbox never learns the policy, the rules, the credentials, or the read-only table. It
learns only which builtins are granted (so it can shape the active set) and it reports each
call. Every decision that could leak intent or secrets stays in the runner. This is the same
trust boundary the custom-tool relay already holds, extended to builtins without widening it.
