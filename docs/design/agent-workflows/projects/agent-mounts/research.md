# Research: what exists, with pointers

Facts gathered from the working tree (2026-07-11, with #5197 session-continuity applied).
Only the facts that drive design decisions; the general mount model is summarized in
`context.md`.

## The slug mechanism agent mounts will reuse

- Reserved prefix: `_RESERVED_SLUG_PREFIX = "__ag__"`
  (`api/oss/src/core/mounts/service.py:34`). `reject_reserved_slug` (service.py:76) blocks
  callers of `POST /mounts/` from authoring slugs in this namespace; only the service mints
  them.
- Session slug minting (`mint_session_slug`, service.py:66):
  `f"__ag__{uuid5(_MOUNTS_NAMESPACE, session_id)}__{slugify_mount_name(name)}"` where
  `_MOUNTS_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "mounts")` (service.py:39).
- Upsert (`get_or_create_session_mount`, service.py:161 → `upsert_mount`,
  `api/oss/src/dbs/postgres/mounts/dao.py:60`): `INSERT ... ON CONFLICT
  uq_mounts_project_id_slug DO UPDATE` touching only audit fields and clearing archive.
  Re-binding keeps the original row id, and therefore the durable prefix.
- Storage key (`_storage_key`, service.py:114): `[namespace/]mounts/<project_id>/<mount_id>/
  <path>`. The prefix uses the mount row's UUID, not the slug, so slugs can change without
  moving bytes. Signed credentials scope to that prefix; the TTL constant
  `_CREDENTIALS_TTL_SECONDS = 3600` (service.py:46) is applied in
  `sign_mount_credentials` (service.py:304).

## The slug validator (load-bearing for the readable-slug decision)

`MountCreate` inherits `Slug` (`api/oss/src/core/mounts/dtos.py:36`), whose
`check_url_safety` enforces `URL_SAFE_SLUG = r"^[a-zA-Z0-9_\-][a-zA-Z0-9_.\-]*$"`
(`sdks/python/agenta/sdk/models/shared.py:74,110-118`). Every minted slug passes through
it. Session slugs are safe by construction (uuid5 output is URL-safe; the name is
slugified). A readable agent slug that splices in a RAW artifact id is only safe if the id
is first canonicalized to a UUID: a non-UUID string with a space or slash would fail the
validator inside the service as an uncaught pydantic `ValidationError` (the
`handle_mount_exceptions` decorator does not catch it), surfacing as a 500. The design
therefore requires parsing `artifact_id` as a UUID and lowercasing it before minting, on
both the sign and the query paths, so the two derivations are byte-identical.

## The table

`MountDBE` (`api/oss/src/dbs/postgres/mounts/dbes.py`): PK `(project_id, id)`; the sole
uniqueness is `uq_mounts_project_id_slug` on `(project_id, slug)`; `session_id` is a bare
nullable String column, not an FK (dbas.py:29), with a partial index where
`session_id IS NOT NULL`. **There is no artifact/agent/workflow column anywhere** (DBE,
DTO, mappings all checked). This confirms the chosen mechanism needs no schema change.

## The agent identity is already on the wire

- `AgentRunRequest.runContext.workflow.artifact.id` exists today
  (`services/runner/src/protocol.ts:390,504`; `RunContext` shape at lines 156-208).
  `runContext` carries `run`, `project.id` (added by commit `661cbc076f`, "stamp the
  project scope into runContext"), `workflow.{artifact,variant,revision,is_draft}`,
  `trace`.
- The Python side assembles it from ambient tracing context:
  `sdks/python/agenta/sdk/agents/tracing.py:136-167` maps reference families
  (`workflow`/`application`/`evaluator` → `artifact`, etc.). Draft runs have an artifact
  and `is_draft: true`; committed runs also carry `revision`.
- Consequence: **no wire or golden-fixture change is needed.** The runner consumes a field
  it already receives.
- **Verified for playground runs only.** Whether trigger-driven, evaluation, and direct
  API runs hydrate the tracing references (and therefore `workflow.artifact.id`) is
  unverified, and so is whether their run credentials carry `RUN_SESSIONS`. Both must be
  checked per run type during implementation; the plan carries this as a verification
  task.

## The runner plumbing to copy

- `signSessionMountCredentials(sessionId, deps, name="cwd")`
  (`services/runner/src/engines/sandbox_agent/mount.ts:63-126`) POSTs
  `/sessions/mounts/sign?session_id=...&name=...`. A different `name` yields an additional
  mount with its own prefix. Returns null on any failure; callers treat mounts as
  best-effort.
- geesefs mounting works at arbitrary paths: `mountStorage(path, creds)` local
  (mount.ts:288), `mountStorageRemote(sandbox, path, creds)` remote (mount.ts:516). The
  #5197 transcript mounts (`mountHarnessSessionDirs`, mount.ts:587) prove the
  sign-with-name → mount-at-path pattern for non-cwd dirs; they are remote-only, additive,
  and best-effort (one failed dir is logged and skipped).
- Re-mount guard asymmetry: local `mountStorage` checks whether the path is already
  mounted before mounting (`checkMounted`, mount.ts:302); remote `mountStorageRemote` has
  no such guard. On a warm resumed sandbox (#5197), a second turn re-signs and would
  re-run geesefs over a live mountpoint unless the implementation skips it.
- cwd path constants (`sandbox_agent.ts:645-654`): local `/tmp/agenta/<prefix>`, Daytona
  `/home/sandbox/agenta/<prefix>`; sign happens before plan build (sandbox_agent.ts:626).

## The sign endpoint and permissions

- Session sign: `POST /sessions/mounts/sign?session_id&name` (default `"cwd"`), permission
  `RUN_SESSIONS` (`api/oss/src/apis/fastapi/sessions/router.py:919-927,1014-1051`); it
  upserts then signs.
- Generic per-mount routes exist (`/mounts/{id}`, `/mounts/{id}/sign`,
  `/mounts/{id}/files*`), permissions VIEW/EDIT/RUN_SESSIONS
  (`api/oss/src/apis/fastapi/mounts/router.py:115-232`).

## The one real gap: discovery of a non-session mount

`POST /mounts/query` filters ONLY on `session_id` and `include_archived` (`MountQuery`,
`api/oss/src/core/mounts/dtos.py:50-52`; DAO `query_mounts`, dao.py:206). There is **no
query-by-slug and no query-by-artifact**. The frontend can browse any mount's files given a
`mount.id` (`GET /mounts/{mount_id}/files`, plus `?read=` and `/files/download`; see
`web/oss/src/components/SessionInspector/api.ts:45-81`), but its only discovery path is
`querySessionMounts(session_id)`. An agent mount therefore needs one new lookup (by
artifact id) for the frontend. The reusable mount-id-generic units are `MountFilesPanel`
(currently a module-private const in `MountsTab.tsx:187`; reuse means exporting or
extracting it), `deriveRows`/`formatSize` in `mountBrowser.ts`, and the
`fetchMountFiles*` functions in `api.ts:49-81`. `MountsTab` itself is session-scoped (it
takes a `sessionId` and queries session mounts), so it is the integration point, not the
reusable unit.

## The rendered instructions file (load-bearing for the discovery decision)

What the harness reads as its instructions file (`AGENTS.md`, or `CLAUDE.md` for the
claude harness; `prepareWorkspace`, `services/runner/src/engines/sandbox_agent/workspace.ts:53-54`)
is the author's `agent.instructions` **verbatim** for `pi_core` and `claude`
(`sdks/python/agenta/sdk/agents/adapters/harnesses.py:68,102`). Only `pi_agenta` composes
a platform preamble in front of it (`compose_instructions`, harnesses.py:131 →
`agenta_builtins.py:762`). Consequence: a platform-injected "you have an agent folder"
line in the instructions would change the no-wrapping policy for two of the three
harnesses; discovery that must not touch agent.md has to ride the filesystem or the env.

What the agent sees in its workspace today: the cwd containing the instructions file,
skill packages (`.claude/skills/<name>` for claude; Pi loads skills via its agent dir),
pre-rendered `harnessFiles`, and prior-turn session files. Sibling directories (relay
scratch, transcript mounts) and the daemon env are effectively invisible — neither Pi nor
Claude lists the parent directory or dumps `env` unprompted.

Unverified, slice-2 verification task: whether the pinned geesefs version supports
creating symlinks (the session cwd is a geesefs mount, and the planned `agent-files`
symlink lives inside it). The sessionless ephemeral cwd is a plain local directory where
symlinks work unconditionally.

## Concurrency fact to carry into the design

Multiple live geesefs mounts of one prefix are possible (different mountpoints, same S3
prefix). Writes are last-writer-wins per file with no locking. Two concurrent sessions of
the same agent will share the agent mount; acceptable for the intended content (skills,
notes, artifacts), documented as a known property.
