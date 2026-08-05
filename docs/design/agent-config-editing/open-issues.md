# Open issues and deferred work

Each entry records what was deferred, why, and where it came from, so a future
reader can act on it cold.

## Teach the agent WHEN to commit, not only HOW

- Deferred by: Mahmoud, 5 August 2026, during the PR #5733 briefing review.
- Context: the whole current effort makes the commit tool cheap and safe to use
  (the HOW). The build-an-agent skill and the tool instructions say nothing about
  judgment: when a change deserves a commit at all, when to batch several edits
  into one commit, when to ask the user first, when a test run should precede a
  commit. Today's playbook says "verify after every commit", which is a workaround
  for missing validation, not guidance on timing.
- The ask: after v1 ships, design the WHEN guidance into the build-an-agent skill:
  commit granularity, batching, ask-first cases, and how the agent should reason
  about draft state and pending user edits before committing.
- Not now because: v1's scope is the mechanics, and the usability spike's
  instruction budget work shows guidance must be measured, not written from
  intuition. The spike harness is reusable for testing WHEN-guidance wording.

## Live tool updates for Pi and Claude (shelved machinery)

- Deferred by: Mahmoud's uniform-reopen decision, 5 August 2026.
- What exists: the runner-spike verdicts (Claude handles list_changed, blocked
  only by our shim's missing capability flag; Pi has live registerTool /
  setActiveTools, blocked only by our env-var delivery), and the
  untrusted-acknowledgement design in contracts/adapter-matrix.md §4.3.
- Insertion points, named so enabling later is cheap: the capability entry per
  adapter (flip reopen-session to apply-live), the shim capability flag
  (tool-mcp-stdio.ts advertise + notify), a runner-written specs file plus an
  extension hook for Pi (replaces AGENTA_AGENT_TOOLS_PUBLIC_SPECS).

## Codex upstream: live MCP tool updates

- Status: source check ran 5 August (see spikes/runner-spike.md, "Codex upstream
  check" section, drafted issue inside). Filing upstream requires Mahmoud's
  explicit approval. Until then Codex stays reopen-session, which is also the
  uniform v1 route for every harness.

## Embedded (referenced) skills have no stable key

- Deferred at the phase 1 review. An @ag.embed skill cannot be addressed by name;
  editing it needs the legacy whole-list write. Needs a stable raw reference key
  design. Low urgency while embeds are rare in agent configs.

## Build kit injects a standing section into the instruction file

- Deferred by: Mahmoud, 5 August 2026, during the briefing review.
- The ask: playground runs get a short, always-present block injected into the
  agent's instruction file, telling the agent it can edit itself and pointing at
  the read and commit tools. Same never-persisted property as the rest of the
  build kit.
- Design point to settle when building: the injected block must be invisible to
  commits and to text-edit anchoring, so the agent never commits the kit's words
  into its stored instructions. Candidate: inject as a separate overlay file the
  harness reads, not as text inside the stored instruction document.
- Recorded together with the WHEN-to-commit skill guidance in the RFC artifact,
  section 9.

## Build mode shows no readable approval card

- Found by: engine-2 during S3b, 5 August 2026. Pre-existing dock behavior.
- The approval dock's per-tool bodies render only in Chat mode with an entity id;
  Build mode always falls back to the raw payload block. So a folder-import
  approval in Build mode shows JSON, not the manifest and diff.
- Fix direction: relax the renderer gating for manifest-carrying approvals, or
  give Build mode a compact manifest body. Needs a small UX decision.
