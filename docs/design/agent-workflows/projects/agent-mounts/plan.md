# Plan: agent mounts

Prerequisite reading: `context.md` (the decision and its why), `research.md` (code facts).
One-line summary: one durable folder per agent, identity minted into the reserved slug from
the workflow artifact id, no schema change, no configuration, no wire change.

## What gets built

1. The API can mint, upsert, and sign an **agent mount**: a mount row with `session_id`
   NULL whose slug derives from the workflow artifact id.
2. The runner mounts it into every run of that agent, next to the session cwd, local and
   Daytona, and makes it discoverable from inside the workspace without any agent.md
   change (env var + `agent-files` symlink + seeded README; D3).
3. The frontend can look the mount up by artifact id and browse its files with the
   existing mount file browser.

No database migration. No `/run` protocol change (`runContext.workflow.artifact.id` is
already on the wire). No agent template change.

## Design decisions

### D1. Slug shape: readable keyword form (recommended)

Session slugs hash the id: `__ag__<uuid5(ns, session_id)>__<name>`. For agent mounts:

| Option | Shape | Trade-off |
|---|---|---|
| (a) Hash, like sessions | `__ag__<uuid5(ns, "agent:" + artifact_id)>__<key>` | Symmetric with sessions. One-way: given a mount row you can never tell which agent owns it. |
| (b) Readable keyword (recommended) | `__ag__agent__<artifact_id>__<key>` | Reverse lookup and "all agent mounts" scans become string operations. Trivially collision-proof against session slugs (the `agent` keyword). Slightly asymmetric with session slugs. |

Recommendation: **(b)**. JP's voice note already suggested a keyword, and readability buys
back two of the three accepted limitations (reverse lookup, listing) for free. The
`reject_reserved_slug` guard already stops users from forging either form.

The readable form has one hard requirement the hash form does not: every minted slug
passes the `URL_SAFE_SLUG` validator (research.md, "The slug validator"), and a raw
non-UUID string would fail it as a 500 inside the service. So **`artifact_id` must parse
as a UUID and is canonicalized to its lowercase form before minting**, on the sign path
and the query path alike; the two derivations must be byte-identical or the frontend
query silently misses an existing mount. A value that does not parse as a UUID is
rejected with a 422.

The key (the `name` slot) starts as the literal `"default"`. One agent, one key, one mount;
more keys are possible later without any change to this design.

### D2. API surface: mirror the session-mounts shape

Two new endpoints on the mounts domain, both thin wrappers over existing service parts:

```
POST /mounts/agents/sign?artifact_id=<uuid>&name=default     permission: RUN_SESSIONS
POST /mounts/agents/query   {"artifact_id": "<uuid>"}        permission: VIEW_SESSIONS
```

- `sign` mints the slug, upserts (`get_or_create_agent_mount`, the exact analogue of
  `get_or_create_session_mount`), and signs prefix-scoped credentials. Same
  upsert-then-sign semantics as `POST /sessions/mounts/sign`, which the runner already
  uses; the runner treats both as best-effort.
- `query` mints the slug and fetches by `(project_id, slug)`; returns the mount row or an
  empty list. **It does not create.** A read path that upserts would materialize mount rows
  for every agent anyone ever looks at; the frontend shows "no files yet" instead. Needs
  one new DAO helper, `fetch_mount_by_slug` (the unique index already exists).
- `artifact_id` must parse as a UUID (422 otherwise; see D1), but there is no existence
  check beyond that, matching the session endpoints (session ids are not validated
  either; they may be external). Project scoping comes from auth: the mount lands in the
  caller's project regardless of what id they name. A well-formed UUID that names no real
  agent yields an unused empty mount in their own project; accepted.
- Permissions reuse the `*_SESSIONS` family the whole mounts domain uses. The name reads
  oddly for agent storage; renaming the permission family is out of scope.

Interface-role check (design-interfaces): `artifact_id` is routing/identity (names which
agent's storage), `name` is identity-within-owner (which of the agent's mounts), neither is
data or config; both belong in the request as shown, nothing belongs in the agent config.

Alternative rejected: a generalized `POST /mounts/sign?scope=agent|session&id=...`. Cleaner
on paper, but it would deprecate the session endpoint the runner and #5197 just shipped
against, for zero functional gain. Revisit if a third scope (project mounts) actually
lands.

### D3. Runner behavior

- **When:** after the session cwd sign, on every run whose `runContext.workflow.artifact.id`
  is present (drafts included; `is_draft` does not matter). Sessionless runs qualify: the
  cwd stays ephemeral, the agent mount still attaches, the first time such runs keep
  anything. Caveat: artifact-id presence is verified for playground runs only; whether
  trigger, evaluation, and direct API runs populate `runContext` (and carry `RUN_SESSIONS`
  on their credential) is a slice-1 verification task, and the sessionless benefit only
  covers run types that pass it. Missing artifact id, missing store, or a failed sign:
  log and continue without it, exactly like the #5197 transcript mounts.
- **Where:** per-run mountpoint `<cwd>-agent` (sibling of the working directory, both
  local and Daytona). The prefix is shared across runs of the agent; the mountpoint is
  per-run, so concurrent runs of one agent each hold their own geesefs mount of the same
  prefix and teardown stays per-run (the cwd unmount path already exists to copy).
  Rejected: a fixed absolute path (collides across concurrent local runs of the same
  agent) and a directory inside the cwd (a FUSE mount nested inside the durable cwd's FUSE
  mount).
- **Harness discovery (decided 2026-07-11, Mahmoud):** the env var alone is plumbing, not
  discovery — neither Pi nor Claude inspects `env` or lists the cwd's parent unprompted,
  and the mount would sit unused until an instructions change ships. The constraint is to
  make the folder obvious **without touching the author's agent.md**: for `pi_core` and
  `claude` the rendered instructions file is the author's text verbatim
  (research.md, "The rendered instructions file"), so a platform-injected line would
  change the no-wrapping policy for those harnesses. The filesystem itself carries the
  signal instead, with three mechanisms:
  1. `AGENTA_AGENT_MOUNT_DIR=<path>` on the daemon env, set only when the mount is live
     (machine-readable pointer; the env-var-naming cleanup in the
     runner-selfhosting-explainer notes applies to this name too).
  2. A **symlink inside the cwd**: `<cwd>/agent-files -> <cwd>-agent`, created after both
     mounts are up. Listing the working directory is the one discovery action every
     harness performs, and the link shows up there. This does not reintroduce the
     rejected dir-inside-cwd option: that rejection was about nesting a FUSE mount inside
     a FUSE mount; a symlink is a pointer, not a mount. Caveat: the session cwd is itself
     geesefs, so creating the link needs geesefs symlink support on the pinned version —
     a slice-2 verification task. Failure to create it is logged and non-fatal (env var
     and README still stand); the ephemeral sessionless cwd is a plain local dir where
     symlinks trivially work.
  3. A **seeded `README.md` in the agent mount**, written by the runner after mount only
     when absent: files here persist across all sessions and runs of this agent; the
     working directory persists only for the current session (or not at all, sessionless).
     Write-if-absent keeps it idempotent and never clobbers an agent's own edit. It also
     gives the D4 frontend panel real content the first time anyone opens it.
     Alternative rejected: seeding from the API at upsert time — it would need S3 write
     access on the sign path for a purely presentational file; the runner already holds
     the mounted path.
  The agent's discovery story, with zero instructions text: list the cwd → see
  `agent-files/` → open it → the README states the persistence rule. Follow-up (not this
  project): a line in the rendered instructions file, now nice-to-have rather than
  load-bearing.
- **Keepalive interplay (#5197):** the mount lives and dies with the run environment;
  `destroy({keepWarm})` keeps it, final destroy unmounts it. Same rule the durable cwd
  follows; implementation must add the agent mountpoint to the same unmount bookkeeping.
  Re-mount idempotency on a warm resumed sandbox needs explicit handling: local
  `mountStorage` already skips a live mountpoint, but `mountStorageRemote` has no such
  guard (research.md, "Re-mount guard asymmetry"), so the remote path must skip the mount
  when the environment already holds it, whatever treatment the durable cwd gets on
  resume.
- **Concurrency property, documented not solved:** two live sessions of one agent share
  the prefix; geesefs gives last-writer-wins per file, no locking. Acceptable for the
  intended content (skills, notes, artifacts).

### D4. Frontend

Minimal slice: the SessionInspector's Mounts tab gains an "Agent files" panel. It calls
`POST /mounts/agents/query` with the artifact id from the inspector's context and, when a
mount comes back, renders `MountFilesPanel` with that mount id. `MountFilesPanel` is
today a module-private const inside `MountsTab.tsx`, so the slice exports or extracts it;
beyond that one move, no new file-browsing code (the panel, `deriveRows`, and the
`fetchMountFiles*` API functions are already mount-id-generic; research.md §frontend).
Empty result renders "no files yet". Where exactly the artifact id is available in the
inspector's props is an implementation-time detail; if it is absent there, the panel
moves to the agent page instead.

## Slices (in dependency order: 2 and 3 both need 1)

| # | Lane | Content | Tests |
|---|---|---|---|
| 1 | api | `mint_agent_slug` (with UUID canonicalization), `get_or_create_agent_mount`, `fetch_mount_by_slug`, the two endpoints; verify runContext + `RUN_SESSIONS` coverage per run type (playground, trigger, evaluation, API) | pytest: slug format + parse-back, non-UUID rejected 422, upsert idempotence (same row id twice), query returns row/empty and never creates, reserved-slug guard still rejects forged `__ag__agent__` slugs, permission checks |
| 2 | runner | sign call with artifact id from runContext, `<cwd>-agent` mount local+remote, `AGENTA_AGENT_MOUNT_DIR`, `agent-files` symlink in cwd (verify geesefs symlink support first), seeded README (write-if-absent), teardown, keepalive + warm-resume idempotency | vitest: plan wiring (artifact id present/absent), path derivation, env var set only when mounted, symlink created best-effort and skipped when present, README seeded only when absent, unmount on final destroy, no re-mount on warm resume; wire-contract goldens untouched (asserts no protocol change) |
| 3 | web | Agent files panel per D4 (includes exporting `MountFilesPanel`) | vitest for the lookup hook; manual e2e in QA |
| 4 | docs | keep-docs-in-sync sweep: `documentation/` mounts page, runner-selfhosting-explainer, env reference | docs build |

Slice 2 is safe to deploy even where slice 1 is not live yet: a 404 from
`/mounts/agents/sign` is a failed best-effort sign, and the run proceeds without the
mount. The live QA below needs both deployed together.

Live QA (after slice 2): local and Daytona; agent writes a file into
`$AGENTA_AGENT_MOUNT_DIR` in session A, session B of the same agent reads it back; a
sessionless run writes and a later session reads; a different agent does not see it.
Discovery QA, run without any instructions hint: ask the agent to list its working
directory and explain what it has — it must find `agent-files/`, read the README, and
state the persistence rule unaided.

## Open questions (comment on the PR)

1. **D1 slug shape:** readable `__ag__agent__<artifact_id>__default` vs session-style
   hash. Recommendation is readable; JP should confirm nothing depends on slugs being
   opaque.
2. **Endpoint placement:** `/mounts/agents/*` as specified, or hang the sign off the
   sessions router's sibling for symmetry? Current shape keeps the sessions router
   session-only.
3. **Mount point and visible name:** `<cwd>-agent`, the `AGENTA_AGENT_MOUNT_DIR` name,
   and — now user-visible to the model — the `agent-files` symlink name and the seeded
   README wording. Better ideas welcome; all are one-line constants.
4. **Query semantics:** confirmed no-create-on-read?
5. **Scope check:** slice 3 in this project, or hand the panel to the mount-file-viewer
   work (draft PR #5204, the session file browser this panel builds on)?
6. **Run-type coverage:** if the slice-1 verification finds that triggers/evaluations/API
   runs do not populate `runContext.workflow.artifact.id`, do we fix their population in
   this project or scope them out?
