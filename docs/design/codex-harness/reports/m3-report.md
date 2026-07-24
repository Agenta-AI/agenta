# Milestone 3 report: approvals and permissions work on Codex

Date: 2026-07-25. Audience: Mahmoud. Companions: `m3-approvals-qa.mp4` (the
approval flow in the real playground UI) and `m3-implementation-notes.md` (build
log, QA evidence, and the debugging record).

## What you can see in the recording

A Codex agent with a runner-executed tool attached, driven entirely from the
playground: under an allow policy the tool runs with no pause; under an ask policy
a real approval card appears ("Approval needed to continue", with the payload and
Approve/Deny buttons); approving resumes the run, executes the tool, and the reply
still carries the codeword planted before the pause, proving context survives the
pause-and-resume; under a deny policy the tool is refused cleanly and the agent
continues to a sensible answer. The warm and cold resume variants you asked about
were both verified at the wire level with the codeword check; on the local sandbox
every approval resume is the cold-replay path by construction, and context
survived it.

## What was built

Per the D-008 ruling: Codex sessions default to full access inside the sandbox
boundary, and tool approvals are enforced by our own runner at the point where a
tool call arrives, allow executes, ask pauses for the UI, deny refuses. Authors can
opt a Codex agent into the gated mode through a typed option, and for that mode the
runner classifies Codex's native approval requests (with their quirks: nameless
exec frames, argument-less MCP frames joined by call id, dot-separated tool names)
into the same parked-approval machinery Claude uses.

## Live QA earned its keep: two real bugs found, fixed, and regression-tested

1. The settings renderer emitted approval-only MCP server entries into Codex's
   config file; Codex validates every such entry for a transport and killed every
   tool session at creation with a generic internal error. This was briefly
   misdiagnosed as a deployment regression because a rollback control only reverted
   the runner while the code lives in the SDK, which mounts into a different
   container; a debugging agent corrected the diagnosis with a single-variable
   proof. The fix drops those entries entirely, since our runner-side gate is the
   permission authority, and a regression test pins the rendered config shape. Cost
   of the accepted trade-off: in the opt-in gated mode, pre-allowed tools pause at
   Codex's own gate rather than running silently.
2. An approval that was granted re-parked instead of resuming: the stored decision
   and the gate keyed the tool arguments in two different shapes. Unit tests could
   not see it because both sides were consistent within each test; only a live
   park-and-resume cycle exposed it. Fixed with a symmetric key normalization plus
   a unit test that now encodes the asymmetry.

Both incidents produced playbook lessons (validate rendered harness config against
the harness's own validator; a rollback control must cover every container that
ships the suspect code).

## One product boundary made explicit

The runner-side gate governs runner-executed tools (platform operations, workflow
references, MCP tools). Schema-only tools that your application executes are client
tools and take the client pause path instead; they never reach this gate. The
recording therefore demonstrates the gate with a referenced workflow tool, and the
distinction is now written down in the notes and the playbook.

## Test and quality status

Runner 1,248 tests and typecheck green; SDK 691 green; lint and format clean. Both
closing passes (simplify and the full desloppify workflow) judged the production
diff clean, with no fixes warranted beyond the two bug fixes above; the golden wire
contract stayed byte-identical.

## Next

Milestone 5, the last one: Daytona managed-key support with the
placeholder-credential compatibility verified in the spike, the release-gate cell,
documentation, one whole-branch desloppify sweep, and the split into stacked
GitButler lanes ready for your review.
