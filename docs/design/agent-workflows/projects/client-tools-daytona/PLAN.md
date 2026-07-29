# Plan: client tools on Claude in remote (Daytona) sandboxes

This plan makes one combination work that does not work today: an agent on the **Claude**
harness, running in a **Daytona** remote sandbox, calling a **client tool** such as
`request_connection`. The tool already works on Pi in any sandbox and on Claude in the local
sandbox. The plan reuses the exact delivery path Pi uses on Daytona, so it adds no new network
route between the runner and the sandbox. It links #5256 (the feature request) and #4984 (the
silent-drop bug whose last remaining case this closes).

Read the glossary in [README.md](README.md) first. Every domain term below is defined there.

---

## 1. What happens today

A user builds an agent that uses a client tool and runs it on Claude in a Daytona sandbox. Two
outcomes are possible, both wrong for the user:

- **The tool set is only client tools.** The run is refused up front with a message that says
  client tools are not deliverable on Daytona (the `DAYTONA_CLIENT_ONLY_TOOLS_UNSUPPORTED_MESSAGE`
  refusal, `services/runner/src/engines/sandbox_agent/run-plan.ts:84-90`, `:436-441`). This
  refusal shipped in PR #5366 as an interim fix so the run fails loudly instead of silently.
- **The tool set mixes client and executable tools.** The run proceeds. The executable tools
  are delivered and work. The client tools are silently dropped: the model never sees them in
  its tool list, so it can never call them. This is the residual case of #4984 that #5366 did
  not close.

On Pi (any sandbox) and on Claude in the local sandbox, the same client tool works: the model
calls it, the model's turn pauses, the frontend renders the browser widget, the user completes
it, and the agent resumes with the browser result.

## 2. Why it happens

Three independent mechanisms block the Claude-plus-Daytona path. Each is verified against the
current code on `origin/main`.

**Block A: the shim never advertises client tools.** On Daytona the runner uploads a specs
file that the shim serves over `tools/list`. The upload site builds that file from the
executable subset only. `services/runner/src/engines/sandbox_agent/environment.ts:691-700`
gates the upload on `plan.executableToolSpecs.length > 0` and uploads
`advertisedToolSpecs(plan.executableToolSpecs)`. The advertisement gate repeats the filter:
`services/runner/src/engines/sandbox_agent/mcp.ts:333` builds the shim entry only when
`executableToolSpecs(toolSpecs).length > 0`. So the client specs never reach the sandbox, and
Claude never sees a client tool it could call.

**Block B: the shim's `tools/call` has no "pause" outcome.** When Claude does call a tool, the
shim resolves it to exactly one of two results: a text result, or an error result
(`services/runner/src/tools/tool-mcp-stdio.ts:210-254`). It writes a relay request and blocks
on the runner's answer, bounded only by the per-tool timeout. There is no way for it to say
"pause this turn and wait for the browser."

**Block C: the relay writes no answer when a client tool parks.** The runner-side relay loop
already knows how to park a client tool: `executeRelayedTool` sees `spec.kind === "client"`,
asks the shared client-tool seam, and on a pending decision returns the `PAUSED` sentinel
(`services/runner/src/tools/relay.ts:326-345`). But when the loop gets `PAUSED` it simply
returns without writing an answer file (`services/runner/src/tools/relay.ts:564`,
`if (text === PAUSED) return;`). For Pi that is fine, because Pi pauses through its own
extension. For the Claude shim it is fatal: the shim is still blocking on an answer file that
will never appear, so it waits out the full per-tool timeout and then returns an error to
Claude. That both surfaces a tool error to the model and risks a late timeout frame arriving
after the runner has already torn the turn down.

**What already works and needs no new plumbing.** The runner-side pause seam is already wired
into the Daytona path. `run-turn.ts:398-412` arms the relay loop with the sandbox filesystem
host (`sandboxRelayHost`) on Daytona and passes the shared client-tool seam
(`env.clientToolRelayRef.current`, built by `buildClientToolRelay` at `run-turn.ts:373`) into
it, for every harness including Claude. So once the shim advertises a client tool (Block A) and
the relay answers the park (Block C), the runner already parks the turn, emits the browser
widget, and ends the turn exactly as it does for Pi on Daytona. This is the key reason the
change is small.

## 3. The approach Mahmoud approved

Reuse the Pi-on-Daytona pattern over the file relay that already exists. Add no second network
path between the runner and the sandbox. Concretely: let the shim advertise client tools, teach
the relay and the shim one new "paused" answer so the shim can end its `tools/call` cleanly
while the runner ends the turn, and let the existing cold-replay resume return the browser
result on the next turn. Then delete the interim #5366 refusal, which the working path
replaces.

The rest of this document elaborates that direction into five steps. It does not reopen it.

## 4. The five steps

Each step lists the files it changes, the contract it alters, and why. A "contract" here means
a shape or a rule that another part of the system depends on: a wire field, a function's
return type, or a documented behavior.

### Step 1: advertise client tools to the shim

Stop filtering client specs out of the uploaded specs file and out of the advertisement gate.

- `services/runner/src/engines/sandbox_agent/environment.ts:691-700`: change the upload gate
  from `plan.executableToolSpecs.length > 0` to `plan.toolSpecs.length > 0`, and upload
  `advertisedToolSpecs(plan.toolSpecs)` instead of `advertisedToolSpecs(plan.executableToolSpecs)`.
  This is the true source of Block A. Note for the implementer: the design brief attributed the
  stripping to `run-plan.ts` and `mcp.ts`; the file that actually assembles the uploaded specs
  is `environment.ts`, and it must be part of this step (see the research note in §8).
- `services/runner/src/engines/sandbox_agent/mcp.ts:333`: change the advertisement gate from
  `internalToolMcp && executableToolSpecs(toolSpecs).length > 0` to
  `internalToolMcp && toolSpecs.length > 0`, so a run whose tools are all client tools still
  advertises the shim.
- `services/runner/src/engines/sandbox_agent/mcp.ts:341-348`: correct the honest log so it
  counts every advertised tool, not only the executable ones. The current wording ("N gateway
  tool(s) advertised") would undercount once client tools ride the same channel.

The shim itself (`tool-mcp-stdio.ts`) needs no change to advertise: its `tools/list` already
maps whatever specs it is given (`tool-mcp-stdio.ts:193-208`). Once the client specs are in the
uploaded file, Claude sees them.

**Contract altered**: the uploaded specs file (`AdvertisedToolSpec[]`) now includes client-kind
tools on the Daytona shim path. The advertised shape stays exactly the same three public fields
(name, description, input schema); only the population set widens. No credential or private
field is added (the shim still reads only public metadata).

### Step 2: confirm the runner-side pause covers the Daytona relay

The pause seam is already wired for Daytona (see §2, "What already works"). This step is
primarily verification, plus one correlation detail to check live.

- No new wiring is expected. `run-turn.ts:398-412` already passes the client-tool seam into the
  Daytona relay loop, and `executeRelayedTool` (`relay.ts:326-345`) already parks a client tool
  and returns `PAUSED`. The `clientToolRelay` value passed to `buildSessionMcpServers`
  (`environment.ts:887`) is consumed only on the local branch (`mcp.ts:327-332`) and ignored on
  Daytona; that is correct, because the Daytona pause happens in the relay loop, not in the MCP
  server object. Leave it.
- The one detail to verify live: correlation of the parked widget to Claude's real tool-call
  id. The shim mints its own request id (`randomUUID()`, `tool-mcp-stdio.ts:229`) and does not
  know Claude's ACP tool-call id, so the seam correlates by tool name plus arguments
  (`toolCallIndex.lookup(toolName, input)`, `client-tools.ts:242-244`), exactly as the local
  Claude MCP path does. Confirm in the live Daytona test (§5) that the widget attaches to the
  right Claude tool bubble. Only if the live test shows a correlation miss does this step add
  code; the plan does not assume it will.

**Contract altered**: none expected. If the live test forces a correlation fix, it would refine
how the seam resolves the tool-call id, not add a wire field.

### Step 3: teach the relay and the shim a "paused" answer

This is the one genuinely new piece of code. It removes Block B and Block C together.

- **The relay answer shape** (`services/runner/src/tools/relay-protocol.ts:29-35`): add an
  optional `paused?: true` field to `ExecuteRelayResponse`. This is a new, backward-compatible
  variant of the answer the runner writes into `<id>.res.json`. An answer is now one of: a
  success (`ok: true, text`), a failure (`ok: false, error`), or a pause
  (`ok: true, paused: true`).
- **The relay loop** (`services/runner/src/tools/relay.ts:564`): instead of returning without
  writing an answer on `PAUSED`, write a paused answer file for the Claude shim path:
  `writeResponse(id, { ok: true, paused: true })`. This must be conditional on the non-Pi
  Daytona shim path only. Pi also parks client tools through this same loop and must keep its
  current behavior (no answer file; Pi pauses through its extension). Thread a flag into
  `startToolRelay` (for example `writePausedAnswer: !plan.isPi`, set from the run plan at the
  `run-turn.ts:398-412` call site) and gate the paused write on it. Do not write a paused answer
  on the Pi path.
- **The relay client** (`services/runner/src/tools/relay-client.ts:260-269`): `relayToolCall`
  currently returns `res.text` on success and throws on failure. Teach it to recognize
  `res.paused` and return a distinct paused result to its caller (a small sentinel, not a
  thrown error), so the shim can tell a pause apart from a normal result.
- **The shim's `tools/call`** (`services/runner/src/tools/tool-mcp-stdio.ts:226-236`): when the
  relay client reports a pause, return a benign, non-error tool result to Claude, for example
  `{ content: [{ type: "text", text: "Waiting for the user to complete this action." }] }`, and
  crucially not `isError: true`. Claude receives a clean result, its turn ends, and meanwhile
  the runner has already ended the turn (the seam called `pause.pause()` at
  `client-tools.ts:266`). The real browser result arrives on the resume turn (Step 4).

**The ordering risk and its mitigation.** The known risk is that the pause and the turn
teardown race under Daytona filesystem latency. Today the failure mode is exactly that race:
the shim waits out a long timeout and then emits a late error frame after teardown. The paused
answer removes the race by construction. The runner writes the paused answer promptly when the
tool parks, not after a timeout, so the shim resolves its `tools/call` immediately with a benign
result and never emits a late timeout frame. This is the same "explicit early signal instead of
silent no-write" fix the local path already relies on.

**Relay cleanup.** Issue #5256 asks that a paused call cannot emit a late timeout answer. The
paused answer file plus the shim's immediate benign return achieve that. In addition, ensure the
paused `<id>.req.json` and `<id>.res.json` pair does not linger to be re-read on the resume
turn's replay. The relay already sweeps stale files at turn start (`relay.ts` ready and sweep,
around `:454`); confirm the paused pair is swept or ignored so a resume cannot pick up stale
paused bytes for a fresh call.

**Contract altered**: `ExecuteRelayResponse` gains `paused?: true` (a new answer variant on the
relay files). `relayToolCall`'s return type gains a paused case. The shim's `tools/call` gains a
third outcome (benign wait result) alongside success and error. All three are additive and
carry no secret.

### Step 4: verify cold-replay resume on Daytona

No code is expected here. The resume path already exists; Block A meant it was never reached for
a client tool. Once Steps 1 through 3 land, verify it live.

The client-tool resume runs through cold replay: the runner reads the browser output back from
replayed history (`extractClientToolOutputs`, `responder.ts:391-409`) and the transcript builder
emits a client resume frame (`transcript.ts:190-246`). On the resume turn the shim runs again,
Claude re-calls the client tool, and this time the seam finds the stored browser output and
returns it as a fulfilled result (`client-tools.ts:238`), so `executeRelayedTool` returns the
real output string (`relay.ts:349`) and the shim returns a normal (non-paused) tool result.
The paused path from Step 3 only fires on the first, still-pending call.

Verify the three continuation cases #5256 names: a normal pause and resume, a resume after the
control link reconnects, and a resume after the sandbox restarts. Also verify repeated and
multiple client-tool calls in one run do not consume the wrong stored result (the seam consumes
one stored output per tool-call key in first-in-first-out order, `responder.ts:256-263`).

**Contract altered**: none. This step confirms an existing contract now reaches a case it could
not before.

### Step 5: remove the #5366 client-only refusal and replace its tests

The interim refusal is now wrong: the path it refused works.

- `services/runner/src/engines/sandbox_agent/run-plan.ts`: delete
  `DAYTONA_CLIENT_ONLY_TOOLS_UNSUPPORTED_MESSAGE` (`:84-90`) and its use (`:436-441`). Keep the
  separate `REMOTE_TOOLS_UNSUPPORTED_MESSAGE` refusal for a non-Daytona remote provider
  (`:433-434`): that path is still unproven and must still fail closed.
- Tests: `tests/unit/sandbox-agent-run-plan.test.ts`, `tests/unit/session-mcp-layering.test.ts`,
  and `tests/unit/tool-bridge.test.ts` reference the client-only refusal or the mixed-set drop.
  Remove the assertions that the refusal fires and that a mixed set drops its client tools.
  Replace them with assertions of the working path: a client-only run on Daytona builds the shim
  and advertises the client tool; a mixed run advertises both kinds; a client-tool call parks
  and the relay writes a paused answer.

**Contract altered**: the run plan no longer refuses a client-only Daytona run. The refusal
message constant is deleted. A caller or test that asserted the refusal must change.

## 5. Test plan

Three layers. Unit tests pin the new logic. A live Daytona script proves the end-to-end path.
A new release-gate journey guards it against regression before every agent-workflows release.

### Unit tests (`services/runner`, vitest)

- **Advertisement (Step 1)**: given a client-only tool set on Daytona, `buildSessionMcpServers`
  builds the shim entry and the uploaded specs file contains the client tool; given a mixed set,
  the file contains both kinds. Cover the corrected log wording.
- **Paused relay answer (Step 3)**: when `executeRelayedTool` returns `PAUSED` on the non-Pi
  Daytona path, the loop writes `{ ok: true, paused: true }`; on the Pi path it writes no answer
  file (unchanged). `relayToolCall` maps a paused answer to its paused result, not a throw. The
  shim's `tools/call` maps a paused result to a benign, non-error content result.
- **Refusal removal (Step 5)**: the run plan no longer returns the client-only message on
  Daytona; it still returns `REMOTE_TOOLS_UNSUPPORTED_MESSAGE` for a non-Daytona remote.
- **Wire contract**: `ExecuteRelayResponse` gains `paused?: true`. The relay files are internal
  to the runner (not part of the `/run` wire contract mirrored in `wire.py`), so no golden
  fixture in `sdks/python` changes. Confirm this while editing `relay-protocol.ts`.

### Live Daytona QA script (the manual proof)

Extend the QA matrix runner
(`docs/design/agent-workflows/projects/qa/scripts/run_matrix.py`) with a client-tool cell on
the Claude-plus-Daytona combination. Outline:

1. Mint an ephemeral account and key (the existing accounts fixture).
2. Invoke on the Claude harness, Daytona sandbox, with a single client tool declared (a
   `request_connection`-shaped spec) and a prompt that provokes the call.
3. Assert the streamed frames show a `client_tool` interaction request (the browser widget),
   not a tool error and not a silent zero-tool run.
4. Post the browser output back as the interaction answer.
5. Invoke the resume on the same session; assert the run continues and the tool result carries
   the browser output.
6. Repeat for the reconnect and sandbox-restart cases from #5256.

Run it against the live dev stack, from the three-variable environment the QA scripts already
use. Record the result as a QA finding under `docs/design/agent-workflows/projects/qa/`.

### New release-gate journey (the regression guard)

Add a `client` journey to the portable release gate
(`.agents/skills/agent-release-gate/resources/qa_product.py`, the `JOURNEYS` map at `:911-920`)
and bind it to the Claude-plus-Daytona cell **C2** (`:134-143`), with the Claude-plus-local cell
**C1** (`:125-133`) as a parity control. The journey drives the product endpoint the playground
drives and asserts on the frame stream and the real side effect, never on the model's prose, so
it runs against any deployment. Assertions, modeled on the existing `j4_approve` flow:

- Turn one: the wire emits a `client_tool` interaction for the declared client tool. The run
  does not error and does not return zero tools.
- The gate answers the interaction with a browser output.
- Turn two (resume): the wire shows the tool result carrying that browser output, and the run
  completes.

Passing on C2 is the release gate for this feature. Passing on C1 proves the change did not
regress the local Claude path.

## 6. Rollout and rollback

The whole change ships behind the Daytona path for the Claude harness and touches no other
combination. Each step is revertable on its own:

- **Step 1** is revertable: restore the `executableToolSpecs` filter at the upload and
  advertisement gates. Client tools stop being advertised again.
- **Step 2** adds no code (or a small correlation refinement), so there is nothing to roll back
  beyond that refinement.
- **Step 3** is the load-bearing change and is revertable: remove the `paused` field, restore
  `if (text === PAUSED) return;`, and revert the shim's benign-result branch. Behavior returns
  to Block B and Block C.
- **Step 4** adds no code.
- **Step 5** is revertable: restore the `DAYTONA_CLIENT_ONLY_TOOLS_UNSUPPORTED_MESSAGE` refusal.

If the live Daytona test in Step 4 fails and cannot be made green quickly, the safe partial
state is Steps 1 through 3 landed but Step 5 held back, so the interim refusal still guards the
client-only case while the mixed-set drop is fixed. The cleanest full rollback is to revert all
five steps together, which returns to today's #5366 behavior exactly.

There is no data migration, no schema change outside the runner, and no change to the `/run`
wire contract, so a rollback is a code revert with no cleanup.

## 7. Non-goals

- **No redesign of the relay's turn boundary.** The relay loop is a fire-and-forget poll with no
  general turn-boundary model. Making a relay-executed executable tool with an `ask` permission
  park from inside the loop is a separate open issue (the "S5.2" gap,
  `../research/.../open-issues.md:132-169`). This plan uses the client-tool park path that
  already exists in the loop; it does not give the loop a general turn-boundary model.
- **No new network path.** The change rides the existing file relay and the existing ACP link.
  It does not add a runner-to-sandbox socket, a callback URL, or a second control channel.
- **No gateway or code-tool parking.** Executable (gateway and callback) tools keep running
  server-side and returning inline. This plan does not change how they execute or add a pause
  for them.
- **No concurrent-approval change.** Multiple client-tool widgets already park together in one
  turn; this plan preserves that and does not touch the one-approval-per-turn latch (see §8).
- **No change to Pi.** Pi's client-tool path on any sandbox is untouched; the paused answer is
  gated to the non-Pi Daytona shim path.

## 8. How this composes with two in-flight efforts

All three efforts touch pause and resume. They must not collide.

- **The concurrent human-in-the-loop work** (`../hitl-fix/`, and Question 2 of the research)
  concerns approval gates, which pause through a different plane: the ACP permission reverse
  call, gated by a one-approval-per-turn latch (`permission-plan.ts:173-185`). Client tools do
  not use that latch; each client tool parks its own widget through the un-latched seam
  (`client-tools.ts:178-181`, `:245-264`). This plan changes only how a client-tool park is
  delivered on Daytona, not how many can park or how approvals serialize. It therefore does not
  touch the latch, the parked-approval record, or the keep-alive multi-gate refusal. The two
  efforts are independent and can land in either order.
- **The in-flight deny-frame PR** changes how a denied interaction projects to the wire. This
  plan's paused path emits a benign wait result, not a deny, and the client-tool deny already
  has its own return (`relay.ts:346-347`, "was denied"). The two do not overlap in code. The one
  place to check on integration: that a client tool denied on Daytona (user cancels the widget)
  still projects the deny frame the same way the local path does, once both changes are in. Flag
  this as a merge-time check, not a design conflict.

## 9. Open questions for review

1. **The paused answer's gating flag.** The plan gates the paused-answer write on `!plan.isPi`.
   Is there any Daytona non-Pi harness other than Claude on the horizon where "not Pi" would be
   too broad? If a third harness appears, the gate may need to key on "uses the shim" rather than
   "not Pi." Naming the flag `writePausedAnswer` (set from the run plan) keeps that future change
   local.
2. **Correlation on Daytona (Step 2).** The plan assumes name-plus-arguments correlation works on
   Daytona exactly as it does on local Claude. If two client-tool calls in one turn carry
   identical arguments, the lookup could attach a widget to the wrong bubble. The seam already
   consumes stored outputs first-in-first-out per key; confirm the live test exercises the
   identical-args case, and decide whether the shim should pass a correlating hint if it does not.
3. **The benign wait text.** The shim returns a short "waiting for the user" text result to
   Claude on a pause. Should that text be fixed, or should it echo the tool name and render hint
   so a model that reasons over it stays coherent? This is a small wording decision with a
   possible effect on model behavior; worth a view before implementation.
4. **Relay cleanup timing.** The plan relies on the existing stale-file sweep to clear the paused
   req/res pair before the resume turn. Confirm the sweep runs early enough on the resume turn
   that a paused pair from the previous turn cannot satisfy a fresh call's wait with stale bytes,
   or add an explicit delete when the paused answer is written.
