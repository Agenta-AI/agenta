# Status: agent mounts

- **2026-07-12**: Slices 1-3 implemented, reviewed, and landed to the working tree. API
  endpoints (sign + query) live-QA'd green against the EE dev stack (422 on non-UUID,
  empty on unknown, roundtrip, idempotency, name-scoping, archived-absent); 36 unit +
  4 acceptance tests. Runner: `agent-mount.ts` module + the `sandbox_agent.ts` runtime
  wiring; a review pass caught one blocking bug (on Daytona the `AGENTA_AGENT_MOUNT_DIR`
  env var never reached the daemon, whose env is fixed at sandbox-create from `piExtEnv`,
  not the mutated local `env`) which was fixed by injecting the deterministic mount path
  into `piExtEnv` before provider creation. Live QA settled the open geesefs-symlink
  question: geesefs creates a symlink but does not persist it across remount (it degrades
  to a 0-byte file), so `linkAgentFiles` is now self-healing per run; the env var and
  README are the durable discovery mechanisms. 17 runner unit tests; full runner suite
  regression-clean. Web: agent-files panel + artifact-id plumbing, unit-tested and
  reviewed. Daytona verified live: an agent ran twice on Daytona (eu.preview key), and the
  mount, README, symlink, cross-run persistence, and the `AGENTA_AGENT_MOUNT_DIR` reaching
  the Daytona daemon all passed. Remaining notes live in `open-issues.md` (including an
  unrelated EE-dev-runner snapshot-mapping bug found during that QA). PR: #5247, stacked on
  `feat/mount-file-viewer`.
- **2026-07-11 (later)**: Review round with Mahmoud on discovery: the env var alone is
  not discoverable, and agent.md must not change. D3 gains the `agent-files` symlink in
  the cwd and the seeded README in the agent mount (write-if-absent); research.md gains
  the verbatim-instructions fact that rules out a platform instructions line, and the
  geesefs-symlink verification task. Implementation started (slices 1-3 in flight).
- **2026-07-11**: Workspace created from the Mahmoud+JP conversation (JP's voice note
  settled the mechanism: reserved slug from the artifact id, no session_id, runner upserts
  at mount time, derived mount point). Docs went through one internal review round before
  the PR: reconciled the mount-point wording, added the UUID-canonicalization requirement
  the slug validator forces, and scoped the sessionless claim to verified run types.
  Nothing implemented yet.

## Current state

Slices 1-3 implemented, reviewed, QA'd, and on a stacked PR (base `feat/mount-file-viewer`).
The six open questions at the end of `plan.md` still need JP's answers (slug shape,
endpoint placement, mount point + visible names, query semantics, frontend slice
ownership, run-type coverage); the implementation follows the recommendations and can
adjust if an answer lands differently. Two naming choices (`agent-files` link name, README
wording) are worth a second look from JP.

## Next

1. Review + merge the implementation PR (stacked on #5204).
2. Resolve the open questions on the design PR #5215.
3. Work the `open-issues.md` list (notably the full-agent-run + Daytona live QA cell).

## Blockers

None. The design depends on #5197's transcript-mount pattern, which is applied to the
working tree; if #5197 changes shape before merge, revisit the runner slice only.
