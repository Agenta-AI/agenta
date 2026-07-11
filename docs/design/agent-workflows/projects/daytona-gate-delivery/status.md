# Status

Source of truth for this project's progress. Update it as work moves.

## Current state

Design complete and independently reviewed. No code changed. The first draft went through
a critical external review (Codex, xhigh); its findings are recorded in
[design-review.md](design-review.md) and folded into [options.md](options.md) and
[plan.md](plan.md). Ready for the owner's review.

## Decisions

- Primary fix is Option C: the runner compiles each granted builtin's policy into a
  disposition (`allow`, `deny`, or `runner`) in `permission-plan.ts` and injects the
  versioned map into the sandbox, so allow and deny resolve with no round-trip. This
  fixes the allow-mode scenario the QA matrix exercises and the build-kit default agent's
  opening read.
- Residual (`runner`-disposition) builtin gates on Daytona ride a file-gate protocol over
  the relay dir: request file, runner acknowledgment, authenticated decision file.
- Custom tools get no second gate channel. Their existing execution relay request is the
  authorization seam: the relay guard decides and executes atomically (allow executes,
  deny returns a denied result, pending pauses without executing).
- The timeout is a two-lifetime model: a short delivery deadline ending at the runner's
  acknowledgment (fails closed, covers the F-018 undeliverable case) and a human approval
  lifetime after acknowledgment owned by the existing pause model. No single timer, and
  no claim of an all-path timeout on the ACP confirm path, which has no acknowledgment.
- Decision files are HMAC-authenticated with a per-run secret delivered via a read-once
  file (the OTLP bearer pattern), because the relay dir is sandbox-writable and for a
  builtin the decision file is the authorization.
- Resume is defined as two explicit state machines: the cold path (default; stored
  decision answers the reissued call next turn) and the live keep-alive path (a
  file-transport variant of the parked-gate union). Until the live variant exists, file
  gates take the cold path even under keep-alive.
- Everything ships as one release unit. Under default `allow_reads`, Option C alone would
  fix reads while bash, edit, and write still hang.
- Option A (fix the reverse RPC over the remote transport) is deferred to the
  sandbox-agent fork plan (PR #5172). It is the ideal long-term shape but the highest
  cost and uncertainty, and the plan does not depend on it.

## Rationale for the trust trade-off in Option C

Injecting the compiled builtin disposition into the sandbox holds narrowly, per the
review. Protected: a prompt-injected model calling a builtin outside its policy (the
model cannot mutate the parent Pi process env through tool arguments, and the enforcement
hook is the same one that obeys the ACP answer today). Not protected: an arbitrary
hostile process with control of the sandbox, which can already do anything a builtin
could regardless of the gate. Caveat to document: once unrestricted bash is allowed,
builtin permissions are not a meaningful confinement boundary for later in-sandbox
effects. The runner remains the policy compiler; the extension receives only a minimal
disposition, never the rule set. Custom-tool decisions stay on the runner.

## Open questions

- Delivery-deadline default: it must cover a relay poll round-trip on Daytona with
  headroom (the poll has idle backoff), but stay far under the 300s guard. A value near
  10 to 20 seconds is a guess to validate live.
- Should the live (keep-alive) file-transport parking variant land in the same release
  unit, or is cold-path-only acceptable for the first cut given keep-alive is off by
  default and F-020 means Daytona recreates sandboxes anyway? Default proposal: cold-path
  only first, with the parked-gate union extension as an immediate follow-up, and file
  gates forced cold under keep-alive until then.
- Whether local should also read the disposition map for allow and deny (skipping the
  confirm). The plan says yes for one shared code path and lower latency; needs the
  owner's confirm because it changes local approval traffic.

## Not in scope

- The Daytona proxy behavior itself (Option A).
- Where code tools execute (F-010).
- Session-resume sandbox reuse (F-020).

## Provenance

- Finding: F-018 in [../qa/findings.md](../qa/findings.md).
- Working tree at planning time: PR #5197 (feat/sessions-continuity) applied.
- Key code read: `services/runner/src/extensions/agenta.ts`,
  `services/runner/src/engines/sandbox_agent/{acp-interactions,pi-gate-envelope,mcp,pi-assets,run-limits,daytona,acp-fetch}.ts`,
  `services/runner/src/permission-plan.ts`, `services/runner/src/tools/relay.ts`, and the
  vendored `acp-http-client@0.4.2` and `sandbox-agent@0.4.2` transport.
- External review: Codex CLI, `model_reasoning_effort=xhigh`, read-only, 2026-07-11; see
  [design-review.md](design-review.md).
