# Status

**Phase:** plan complete — draft PR up for Mahmoud's review
**Last update:** 2026-07-09 (session: runner memory-leak diagnosis → fork decision → plan)

## Now

- [x] Root cause of the runner orphan-process leak confirmed (see `research.md` §1)
- [x] Decision made: fork sandbox-agent into agenta-ai, consume the fork, PR upstream
- [x] Upstream repo research — condensed into `research.md` §7. Headlines: server is Rust;
      adapter spawned with no process group and killed single-pid even on the clean path;
      graceful shutdown hooks SIGINT only; upstream issue #201 IS this leak, closed
      2026-04-05 without a fix; upstream dormant since April (0 commits Apr–May).
- [x] Local consumption map — condensed into `research.md` §5. Key facts: pnpm-only,
      exact pin 0.4.2, binaries transitive, Daytona uses a separate Docker base image and
      is NOT urgent for the leak fix (deleting the sandbox kills its processes).
- [x] Publish channel decision (Mahmoud, 2026-07-09): use **pkg.pr.new** for the moment so
      we don't go through npm — assessment + caveats in `research.md` §6. Graduating to
      @agenta-scoped npm packages is the exit path if the fork lives long.
- [x] `plan.md` written: fix design (process-group kill + SIGTERM), fork mechanics,
      pkg.pr.new CI, pnpm overrides, sync/exit criteria, milestones M0–M5, runbook.
- [x] Dev box restarted 2026-07-09 (49.7 GiB / 7029 PIDs → 155 MiB / 23 PIDs).
- [x] Draft PR with this workspace for Mahmoud's review: #5172.

## Next (implementation order, after plan review)

1. **M1**: fork repo, apply the two Rust fixes, build linux-x64 locally, validate on the
   dev box via `SANDBOX_AGENT_BIN` (zero orphans after N runs).
2. **M2**: pkg.pr.new App + fork CI (linux x64+arm64 tarballs).
3. **M3**: `pnpm.overrides` in services/runner + lockfile + CI + 24h soak.
4. **M4**: upstream PR referencing #201/#6.
5. **M5**: FORK.md + AGENTS.md/docs sync.

## Open questions (for Mahmoud on the draft PR)

- OK to base the fork on the `v0.4.2` tag (not upstream main / 0.5.0-rc.3)? Rationale in
  `plan.md` §Fork mechanics.
- pkg.pr.new → npm graduation trigger: proposal is "fork still needed after ~a month, or
  first 404". Fine?
- Runner-side process-group-kill backstop: plan says skip in v1 (fix belongs in the
  server). Veto if you want belt-and-braces.

## Blockers

- None. Upstream relationship being handled by Mahmoud directly (founder contacted).

## Interim operational note

Until the fix ships, `agenta-oss-team-runner-1` needs a periodic restart: it leaks one
`claude` + `claude-agent-acp` pair per run (~49 GiB / 7029 PIDs per ~24h at current load).
Restarted 2026-07-09; healthy idle is ~20-30 PIDs / ~150 MiB. Census commands: `plan.md`
§Runbook.
