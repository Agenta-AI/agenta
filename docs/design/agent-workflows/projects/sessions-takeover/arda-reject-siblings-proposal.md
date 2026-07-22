# Proposal: what rejecting one approval card does to its siblings

Mahmoud, this is my answer to the open question in the handoff (§6): when the user rejects
one approval card, what happens to the other pending cards. Short version: **keep per-card
rejection as the default, do not adopt an inferred cascade, and instead surface the scope
explicitly** — a per-card **Deny**, a turn-level **Stop**, and reject-with-message as
**steer**. The reasoning is below with the mechanics it rests on; every claim names a file
or a doc you can check, and I mark the one thing only a live test can settle.

I reached this by mapping the runner/ACP gate machinery and pressure-testing the option
against real batches, then feasibility-checking the one assumption it depends on (that a
turn-level Stop can be *warm*, not a teardown). Two supporting investigations are summarised
in §4; both are commit-grounded on `plan/concurrent-approvals`.

## 1. The question is really two questions

The surface phrasing is "reject one card → all cards?", but the choice is set by two axes:

- **What does "reject" mean** — "no to *this* action" (precise) or "stop what you're doing"
  (turn-level)? OpenCode ties this to whether the rejection carries a message: a bare reject
  cascades and halts the loop, a reject *with* a message becomes a `CorrectedError` fed back
  to the model as guidance
  (`opencode-comparison.md` §3, `permission/index.ts:121-139`).
- **Are the siblings the same kind of thing?** If a batch mixes a `bash` write and a Gmail
  send, "reject one → deny all" throws away the send the user wanted. If the system cannot
  tell related siblings from unrelated ones, an *inferred* cascade is a guess.

The mechanics decide the second axis, so start there.

## 2. The mechanics that constrain the answer

Verified against the merged runner (post-#5382) on `plan/concurrent-approvals`:

- **Siblings are real, not hypothetical.** Request *delivery* serializes (one
  `onPermissionRequest` at a time), but **park mode keeps the session alive**, so the next
  gated call's request lands a tick later and parks too — the pool holds a
  `Map<toolCallId, ParkedApproval>` of N open gates
  (`run-turn.ts:226-234, 598-614`; `server.ts:688`). Pi makes this routine: it "prepares
  every call in a parallel batch before it executes any of them" (`run-turn.ts:766-768`),
  so a parallel-tool-call turn parks several cards at once. Claude/ACP serializes at
  dispatch, so for Claude siblings appear mostly via carry-forward or mid-resume.
- **Siblings can be heterogeneous.** The parked map is keyed only by `toolCallId`; nothing
  groups it by operation or class, and a batch can freely mix a Pi `bash` write with a
  gateway/custom relay call (`run-turn.ts:610`).
- **There is no danger signal on the wire.** The only risk hints are `readOnlyHint`
  (write vs read) and the resolved permission (`permission-plan.ts:22-38, 180-188`). The
  runner cannot tell "these three are one logical operation" from "these two are unrelated."
- **Today is strictly per-card, and provably so.** Resume matches decisions by `toolCallId`
  (`session-identity.ts:274-291`, "matches strictly by toolCallId… never by name+args").
  Denying one closes only that call as a declined frame (`markToolCallDenied` →
  `tool-output-denied`, `protocol.ts:349-356`); the harness continues with the other tool
  results and only re-parks if gates remain (`run-turn.ts:739`). A sibling with no decision
  is carried forward and stays pending (`server.ts:705-708`). **Denying one card does
  nothing to the others or to the turn.**
- **No cascade runtime exists.** The only "affect all at once" primitive is session
  teardown (`/kill`), which bulk-*cancels* every open RPC and destroys the process
  (`server.ts:1115-1162`); it is not a fan-out of denies and writes no per-gate "denied"
  rows.

The load-bearing consequence: **because siblings can be independent and the system has no way
to know, inferring "reject → stop all" from a single click guesses wrong exactly in the
case that matters — the user rejects the one dangerous write and silently loses the safe
sibling they wanted.**

## 3. The proposal: make scope explicit — Deny / Stop / steer

Do not encode a fixed sibling policy. Surface the scope and let intent drive it.

### Deny (per card) — the default, the common case
"No to *this* action." Keeps the existing per-`toolCallId` behaviour: the denied call closes
as a decline, the harness continues, untouched siblings carry forward. It is precise, safe
for heterogeneous batches, and needs **no new runtime** — it is what ships today.

### Stop (turn-level, shown only at ≥2 cards) — "stop what you're doing"
One action to halt the whole parked turn. This is the *explicit* form of the cascade — the
user chooses it; it is never inferred from a bare Deny. Two important properties, both
verified feasible in §4:

- It must be **warm** (reuse the pooled process), not the `/kill` teardown, or it throws away
  the warm-resume the sessions work exists to deliver.
- It ships in two steps. **v1 today, no runner work:** Stop = resume answering *every* open
  gate as `reject`; this is already a warm, no-teardown end and the env reparks idle-warm
  (`run-turn.ts:725`, `server.ts:712, 793`). It is a hair softer than a true cancel — the
  model narrates a short close rather than halting silently. **v2 (handoff task 5):** the
  true cancel — answer pending as `cancelled` + `session/cancel`, settle idle — for clean
  "stopped" semantics.

### Steer (reject-with-message) — "no, do it *differently*"
A rejection that carries text is not a sibling policy at all; it is guidance. Route it as
OpenCode does: the message becomes feedback to the model, not a bare denial
(`opencode-comparison.md` §3). This is the redirect case ("write to staging, not prod") and
belongs with cancel/steer (task 5), kept off the Deny/Stop axis so the two stay clean.

**Net:** per-card Deny (default) + explicit Stop (warm) + steer (redirect). The thing we
deliberately do **not** build is an *inferred* cascade; if a "Deny all" shortcut is ever
wanted it should be an explicit control shown at ≥2 cards, never a side effect of one reject.

## 4. Why this is cheap and safe — the two investigations

**Sibling machinery** (summarised in §2). The substrate is already per-card and heterogeneous,
so Deny is native and Stop is the only added verb.

**Warm-Stop feasibility.** The assumption Stop depends on — that a turn-level cancel can leave
the harness warm and resumable — checks out as **feasible but unbuilt**, and the substrate
already proves it: park mode *deliberately* ends a turn mid-stream without disposing the
session (`run-turn.ts:242`, "Keep the live session… skip the destroySession"), and resume
answers the gates on that same live process. That is warm-cancel's exact substrate, in
production use. Confirmed along the way:

- Answering a **subset** of gates does **not** trip the resume-contract "mismatch → evict"
  guard — that fires only on history-fingerprint drift or expired credentials
  (`server.ts:722-739`). So per-card Deny is warm by construction.
- A warm "Stop = deny-all via resume" is reachable **today** with no new runtime.
- A *true* cancel needs one adapter detail resolved: `session/cancel` is currently welded to
  full `destroySession`, so a clean turn-only cancel needs a `session/load` rebind or a small
  adapter extension. Process/sandbox/connection survive either way.

Pressure-testing the two-write incident batch confirms the surface: Deny the bad write, keep
the good one, or Stop both — the case an inferred cascade cannot express.

## 5. The one thing only a live test can settle

Whether a **Claude ACP** turn, after its pending permissions are answered `cancelled` and it
receives `session/cancel` *without* the daemon being torn down, actually settles to a clean
idle state and accepts the next `session/prompt` on the **same pooled process** — rather than
wedging or demanding a fresh session. Zed does exactly this and the adapter claims support,
but Agenta has never run this precise sequence (today it only ever answers with `once`/
`reject`, and only emits `session/cancel` as the first step of full teardown). This is gated
behind task 5, so it does **not** block the surface or the v1 warm Stop; it is the acceptance
test for the true-cancel upgrade.

## 6. Direct answers to the three options you posed

- **Keep per-card rejection?** Yes — as the default (Deny). It is precise, native, and the
  only choice that survives heterogeneous siblings.
- **Adopt the cascade?** No — not *inferred*. A rejection should never silently cancel
  unrelated siblings. Offer the cascade only as an explicit, user-chosen **Stop** (or a
  visible "Deny all" at ≥2 cards).
- **Something between (cascade only when the rejection carries no message)?** The message is
  the right signal, but it points the other way: a message means **steer** (redirect the
  model), not "stop all." Bare Deny = this card; explicit Stop = the turn. The message axis
  is a third thing, not a cascade trigger.

## 7. What I'd build, in order

1. Nothing new for **Deny** — it already ships (per-card).
2. **Stop** at ≥2 cards, v1 = deny-all-via-resume (warm, no runner work); a dock-level control,
   not per-card.
3. Upgrade **Stop** to true cancel with task 5, behind the live acceptance test in §5.
4. **Steer** (reject-with-message → model feedback) with task 5's cancel/steer work.

Happy to spec the dock interaction (where Stop sits relative to the cards, the ≥2 gate, the
carried-forward "1 of N still needs you" state) once you're aligned on the model.
