# Context

## Symptom

The SessionInspector drawer (opened from the playground) has a Mounts tab. For a session
with a durable cwd mount full of files, the tab shows only `name / slug / id` per mount.
Users cannot see which files the agent wrote, let alone read them. The whole point of
inspecting a mount is looking at its contents.

## Why the content is missing today

- `POST /sessions/mounts/query` returns `Mount` records only. A `Mount` is a pure
  reference: `MountData` is an intentionally empty model
  (`api/oss/src/core/mounts/dtos.py:15-33`). File bytes live in the object store
  (SeaweedFS/S3) under `mounts/<project_id>/<mount_id>/<path>`.
- The frontend (`MountsTab.tsx`) never calls any file endpoint.

## Why this is frontend-only

The standalone mounts router already exposes everything needed, registered in prod
entrypoints (`api/entrypoints/routers.py:1461`) and present in the generated Fern client
(`client.mounts.*`):

- `GET /mounts/{mount_id}/files` — listing (`{path, size, is_folder}`), `path` param for
  subfolders → `getMountFiles({mount_id, path})`
- `GET /mounts/{mount_id}/files?read=<path>` — UTF-8 text content (lossy decode
  server-side, so binaries cannot 500) → `getMountFiles({mount_id, read})`
- `GET /mounts/{mount_id}/files/download?path=` — raw bytes, for images →
  `downloadMountFile({mount_id, path})`

Auth is `Permission.VIEW_SESSIONS`, the same permission the inspector already requires.
The Mounts tab already holds each `mount.id`, which is all these routes need.

## Non-goals

- No new backend endpoints, no Fern regen, no agent/application-level mounts (separate
  design discussion), no file editing, no full file-tree component, no download-folder.
