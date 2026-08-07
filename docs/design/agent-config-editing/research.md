# Research notes

The three primary documents live in `research/`. This file is the index plus the code
facts each slice builds on, with file references. All were verified on main, 2026-08-04.

## Primary documents

These three were the working drafts that the 5 August consolidation decided. The
`contracts/` directory is now the source of truth; where a contract disagrees with a
document below, the contract wins. Read these for the reasoning history, not the current
behavior.

- `research/rfc.html`: requirements, user stories, design questions with decided
  options, known defects. Historical; superseded by `contracts/`.
- `research/change-set-interface-codex.md`: the delta interface. Ordered operations,
  structured targets, error model, base check, `value_from`, one engine with two
  wrappers. Historical; superseded by `contracts/change-set.md`.
- `research/runner-lifecycle-codex.md`: the runner architecture. Applied-state identity,
  five lifecycles, harness and provider ports, a nine-step migration path, twelve risks.
  Historical; superseded by `contracts/adapter-matrix.md`.

## Code facts the slices build on

### Commit path (slices 1, 2)

- Delta application: `_resolve_revision_delta` merges onto the variant's latest
  committed revision, `api/oss/src/core/workflows/service.py:1984-2015`; `_deep_merge`
  recurses dicts only, `:2409-2417`. The head fetch and the DAO insert run in separate
  transactions (`api/oss/src/dbs/postgres/git/dao.py:1606`), so the base check must move
  into one transaction.
- Tool schema: `commit_revision` in
  `sdks/python/agenta/sdk/agents/platform/op_catalog.py:688-747, 1102-1112`. Context
  bindings strip server-owned fields from the model-visible schema.
- The delta DTO does not forbid unknown keys: `api/oss/src/core/workflows/dtos.py:301`.
- Uniqueness today: skills, none (runner silently drops the duplicate,
  `services/runner/src/engines/skills.ts:156-176`); tools, run-time only
  (`sdks/python/agenta/sdk/agents/tools/resolver.py:90-135`); MCP servers, none.
  Gateway tool `name` is optional (`sdks/python/agenta/sdk/agents/tools/models.py:89`).
- Revision read endpoints for `read_config`: `POST /workflows/revisions/log` binds a
  variant id in the body (`api/oss/src/apis/fastapi/workflows/router.py:431-440`);
  `$ctx.workflow.is_draft` resolves as a binding token today
  (`services/runner/tests/unit/tool-direct.test.ts:314`). Ops cannot bind query params,
  only body fields and path params (`services/runner/src/tools/direct.ts:389-390`).

### Workspace and value_from (slice 3)

- Files are materialized once per cold acquire by `prepareWorkspace`
  (`services/runner/src/engines/sandbox_agent/workspace.ts:50-157`), into the durable
  mount (mount happens first on purpose,
  `services/runner/src/engines/sandbox_agent/environment.ts:763-766`).
- Skill on-disk format: `composeSkillMd` and `resolveSkillDirs`,
  `services/runner/src/engines/skills.ts:118-215`. Known round-trip losses: the
  `allow_executable_files` flag, multi-line descriptions, binary files, embed items.
- The runner reads sandbox files on every tool call: `sandboxRelayHost`,
  `services/runner/src/tools/relay.ts:255-300`. Argument layering where the resolution
  step slots in: `assembleBody`, `services/runner/src/tools/direct.ts:210-247`.
- The mount fails open when it cannot attach (adjacent to issue #5342):
  `environment.ts:777-789, 835-845`.

### Runner lifecycle (slices 5 to 7)

- The wholesale fingerprint: `configFingerprint`,
  `services/runner/src/engines/sandbox_agent/session-identity.ts:199-259`. It includes
  the revision id, version, and draft flag (`:250-258`).
- The warm gate and eviction: `services/runner/src/server.ts:675-709`. Re-parking stamps
  the incoming request's fingerprint (`:596-603`); the approval-resume path never
  compares fingerprints (`:767-870`); this is the stale-config bug.
- Teardown maps `compatibility-mismatch` to delete, not stop:
  `services/runner/src/engines/sandbox_agent/teardown.ts:23-37`. The cold path then
  still tries to reconnect the deleted sandbox (`environment.ts:662-693`).
- Measured costs (dev stack): warm continuation 1.4 s, stopped-sandbox restart 7.7 s,
  full cold 12.5 s
  (`docs/design/agent-workflows/projects/warm-daytona-sessions/pr-body.md:21-32`).
- Existing live-apply entry points: `setModel`
  (`services/runner/src/engines/sandbox_agent/model.ts:88`), Codex mode
  (`codex-mode.ts:21`). MCP servers reach Claude/Codex at session init (`mcp.ts:329`);
  Pi tool specs are startup assets (`pi-assets.ts:341`).

### Adjacent filed issues

#5554 (truncation, motivates but is not fixed by this project), #5186 (read config),
#5173/#5174/#5407 (third-party tools, separate work), #5342 (mount fail-open), #5397
(slug editing, separate work).
