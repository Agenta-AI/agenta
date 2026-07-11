# Research: Artifacts

## Current building blocks

- The SessionInspector Mounts tab already lists mount files, reads text, previews images,
  and offers downloads. HTML is currently treated as text, so it is displayed as source,
  not executed. See `web/oss/src/components/SessionInspector/tabs/MountsTab.tsx`.
- The mounts API already supports durable file reads and writes. `GET /mounts/{id}/files`
  reads or lists files; `PUT /mounts/{id}/files?path=...` writes a file. Writes require
  `EDIT_SESSIONS`. See `api/oss/src/apis/fastapi/mounts/router.py`.
- The `agent-mounts` design workspace proposes one durable mount per agent and a frontend
  entry point for that mount's files. Artifacts should live inside that mount rather than
  create a competing storage resource.

## Implications

The file store is sufficient for a first artifact state model. The missing pieces are an
isolated browser runtime, a narrowly scoped persistence bridge, an agent-facing skill and
toolkit, and a first-class playground surface.

## Runtime boundary

HTML with JavaScript is viable only when it is treated as untrusted application code. A
safe runtime needs an isolated origin or equivalently strong iframe boundary, restrictive
content security policy, no Agenta credentials, no parent-page access, and no external
network by default. It may expose a filesystem capability limited to the artifact root.

The browser must not receive a reusable project API key. The host or artifact-serving
endpoint validates paths, permissions, sizes, revisions, and write rate before it writes
to the mount.

## Persistence choices

Do not persist arbitrary DOM mutations as the default. The DOM includes temporary UI
state and may not represent the application's data.

Prefer one of two conventional browser interfaces:

1. Mirror `localStorage` into `state.json` or a state directory. An app saves normally;
   the runtime persists it to the mount automatically.
2. Support relative `fetch` reads and writes within the artifact root. An app can read
   `./state.json` and `PUT` its updated state back to that path.

Both avoid an artifact-specific UI language. The first makes automatic persistence very
easy. The second handles multiple state files and assets naturally. They can share the
same scoped host implementation.

## Risks to design before implementation

- Concurrent agent and user writes need a revision or checksum, so one does not silently
  overwrite the other.
- Infinite loops and resource-heavy scripts can still degrade a browser tab even without
  network access. The host needs a reliable close and reload path.
- The artifact may contain deceptive content. The playground must clearly label it as
  agent-created, sandboxed content rather than native Agenta controls.
- Multi-file assets and relative paths favor a dedicated artifact-serving origin rather
  than a basic `srcDoc` preview.

