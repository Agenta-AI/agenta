# Research findings (2026-07-10)

Condensed from two exploration passes (backend mounts subsystem; inspect UI).

## Mounts subsystem

- Mounts are a standalone session-scoped object-store domain, NOT part of the agent
  config. A mount row holds metadata only; bytes live in the object store under
  `[<namespace>/]mounts/<project_id>/<mount_id>/<path>`
  (`api/oss/src/core/mounts/service.py:100-113`).
- The runner materializes the mount as the sandbox cwd via geesefs (FUSE-over-S3) using
  short-lived prefix-scoped STS credentials
  (`services/runner/src/engines/sandbox_agent/mount.ts:62,274,480`;
  signing: `api/oss/src/core/mounts/service.py:268-302`, TTL 3600s).
- One durable `cwd` mount per session, minted idempotently
  (`get_or_create_session_cwd`, `service.py:147-169`). Standalone project-scoped mounts
  (`session_id=None`) also exist. No agent/application binding exists.
- Skills are a different mechanism: inline content on the `/run` wire (200 KB cap),
  materialized per run; mounts never carry content on the wire.

## Endpoints and client (the reason this is FE-only)

- `MountsRouter` file ops (`api/oss/src/apis/fastapi/mounts/router.py:403-432`):
  `GET /mounts/{mount_id}/files` (listing; `path` param), `?read=<path>` (text content;
  server does `body.decode("utf-8", "replace")` — `service.py:361-374`), and
  `GET /mounts/{mount_id}/files/download?path=` (raw bytes via `read_file_bytes`).
- Registered in `api/entrypoints/routers.py:1014,1461`. Permission: `VIEW_SESSIONS` for
  reads.
- Generated Fern client `web/packages/agenta-api-client/.../mounts/client/Client.ts` has
  `getMountFiles`, `downloadMountFile` (both typed `unknown` — needs local casts).
- The session-scoped router has query/sign/upload/download but NO list route; irrelevant
  since the standalone routes accept the `mount.id` the tab already has.

## Inspect UI

- Two unrelated "inspect" surfaces exist. Workflow `/inspect` carries no mounts. The
  mounts surface is the SessionInspector drawer
  (`web/oss/src/components/SessionInspector/`), tabs Streams / Records / States /
  Mounts / Interactions, opened from the playground
  (`Playground.tsx:120`, `MainLayout/index.tsx:409`, `AgentChatSlice`).
- `MountsTab.tsx` (48 lines) renders `name/slug/id` from
  `fetchMounts` → `client().sessions.querySessionMounts`. No file endpoint is called
  anywhere in the inspector. `dump.ts` `mountsMarkdown` mirrors the metadata-only view.

## Size-cap rationale

`read_file` loads the whole object into API memory. A client-side preview cap (2 MB by
`size` from the listing) keeps previews cheap without backend changes.
