# Status

Source of truth for where this project stands. Keep it current.

## State

**Design complete, not started.** The problem is verified against code, every design fork is
resolved, and the plan is phased. No implementation yet. The design lives in
[proposal.md](proposal.md); the verified current-state audit is in [context.md](context.md).

The one-line problem: agent workflows are text-only at the model — attachments travel intact from
the composer to the runner and are dropped one line before the harness
([`run-turn.ts:478`](../../../../../services/runner/src/engines/sandbox_agent/run-turn.ts) is
hard-coded to a single text block). The fix is entirely on **our** side of that line; ACP (Zed's
external protocol) and the harness already support image and audio.

## Phase tracker

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Honest gate — close the paste/drop leak so the parked feature stops silently failing | ☐ not started (optional) |
| 1 | Storage + reference plumbing — attachments mount, FE upload-first, ref on the wire | ☐ not started |
| 2 | Runner resolve + prompt (image) — `resolveContentBlocks`, materialize working copy, replace line 478 | ☐ not started |
| 3 | Audio + documents — add `audio` to Agenta `ContentBlock`, map audio/PDF, capability-derived FE limits | ☐ not started |
| 4 | Findability polish + GC — "Shared by you" drawer origin, orphan GC, verify edit-in-place flow | ☐ not started |

## Decisions taken

- **2026-07-21 (scope, with product owner):** audio is in scope (forces inline `AudioContent`);
  PDFs/documents in scope, FE limits may be reworked (they were arbitrary); **both** intents —
  model perceives *and* agent operates; whether the agent modifies the file is the user's call
  per conversation; findability is an explicit product goal.
- **2026-07-21 (design forks, see [decision log](proposal.md#decision-log) D1–D7):**
  - Inline base64 at the ACP boundary (the spec requires it; no URL-to-model path). **D1/D2**
  - A dedicated session-scoped **attachments mount**, deliberately kept **off** the sandbox FUSE
    set — not the `agent-files` pattern. **D3**
  - Two objects: immutable original + mutable working copy — so "always findable" and "agent can
    do anything" are both true, no read-only-vs-read-write policy. **D4**
  - No first-turn race (FE owns `session_id`; sign is get-or-create). **D5**
  - Capability gated on ACP `promptCapabilities` — FE (UX) + runner (truth). **D6**

## Open questions (blocking specific phases)

1. **Materialize-per-turn vs persistence** — confirm the runner can address the attachments mount
   out-of-band (object-store GET with its signing creds) without adding it to the sandbox FUSE
   set. *(gates Phase 2)*
2. **Document delivery on Claude** — confirm ACP `EmbeddedResource(blob)` lands as a Claude
   document block, not just a fetchable resource. Least-confirmed link in the chain; verify
   against a live harness before committing. *(gates Phase 3)*
3. **Orphan-upload GC policy** — TTL sweep vs. reference-count against the transcript.
   *(gates Phase 4)*
4. **Working-copy path convention** — `cwd/attachments/` (discoverable) vs. hidden/namespaced
   (less clutter). *(gates Phase 2)*

## Next actions

- Decide whether Phase 0 ships standalone or folds into Phase 1 (skip if 1–4 land quickly).
- Resolve open question 2 against a live Claude harness before Phase 3 is planned in detail.
- Graduate the diagrams/contracts in [proposal.md](proposal.md) into an implementation plan
  (`plan.md`) when a phase is picked up.

## Artifacts

- [README.md](README.md) · [context.md](context.md) · [proposal.md](proposal.md)
- Branch: `docs/agent-multi-modality` (docs only, uncommitted as of 2026-07-21).
