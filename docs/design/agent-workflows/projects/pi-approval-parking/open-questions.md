# Pi approval parking: open questions

Items marked DECIDED are settled (the 2026-07-09 plan review resolved several); the rest
state a working default. #1 still gates slice order.

1. **The live daemon confidence run (slice 0). OPEN, gates everything.** The spike proved the
   hop against `pi-acp` directly; the runner ships through the sandbox-agent daemon. Source
   says the daemon leg is a passthrough (`acp-http-client@0.4.2`, fail-closed) and that the
   daemon maps replies by kind, but neither has been run live. Slice 0 checks both: the
   envelope arrives intact at a runner-side handler, and `respondPermission(id, "once")`
   resolves the held dialog to allow. Working default: run slice 0 first; if it fails, fall
   back to the parkable-gates design's Option B and stop.

2. **Approval-card rendering for the envelope identity. OPEN, verify in slice 4.** The plan
   normalizes the tool-call id at the top of `handleRequest` and synthesizes the card payload
   from the envelope (real tool name via `resolvedName`, real arguments as `rawInput`), so
   the card should render exactly like a relay-gate card does today. The remaining check is
   frontend-side: confirm the card renders correctly and the fold-back of the decision keys
   on the normalized id end to end. If the frontend keys on anything else in `toolCall`,
   that is a slice-1 finding, not a wire change.

3. **Where the dialog-allow is recorded for the double-gate. DECIDED.** The responder and
   the relay share the same per-turn `ConversationDecisions` object
   (`sandbox_agent.ts:1218/1225/1268`), but it is write-closed (`take`/`peek` only,
   `responder.ts:209-237`). The mechanism is a new FIFO append API with consume-1-append-1
   accounting on the cold dialog path, the key-parity invariant tested
   (`envelope.toolName === spec.name`, `envelope.input` === the exact execute params), and a
   slice task for the warm-resume path, which bypasses the responder: verify whether
   `extractApprovalDecisions` already seeds the map from the resume request, else append
   explicitly on the resume branch before `sandbox_agent.ts:1389`. Details in plan.md
   slice 2.

4. **Flag coupling. RESOLVED (2026-07-10): there is no flag.** The dialog gate shipped as
   the unconditional Pi behavior and the relay permission plumbing was deleted with it, so
   the half-state question dissolved: without keep-alive the gate still decides instantly
   with real card identity, and an ask degrades to the cold durable-decision path.

5. **Deny-warm UX. OPEN, a product call, not a mechanism question.** On a warm deny the hook
   returns `blockReason` and Pi continues its loop on the live session; the model sees the
   block and may try something else. Mechanically sound (and id-correct after the slice-1
   normalization); confirm during slice 4 that continuing live is the wanted UX versus
   ending the turn on a deny.

6. **Malformed envelope under the `agenta-approval` title. DECIDED: fail closed.** A
   title-matching request whose envelope does not parse is answered with an immediate
   reject. The earlier working default (fall through to the spec-less path, "worst case is a
   paused turn") was wrong: under a default-allow permission plan the fallthrough resolves
   to allow and the dialog would confirm an unapproved execution. Strict parse plus reject
   makes the worst case a blocked tool call, which is the correct worst case.
