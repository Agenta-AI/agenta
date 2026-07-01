# Store generalization — specs

> Status: **decided, ready to implement**. W6 of the `big-agents` platform cleanup.
> See `big-agents-audit/platform-readiness-big-agents-now.md` §B and
> `big-agents-audit/store-generalization.md` for the audit context.

## Problem

PR #4938 (`feat/extend-mounts`) merged a general S3-compatible object store — SeaweedFS
in dev, any S3-compatible store in prod — with a generic adapter, scoped STS signing, and
Helm/compose wiring. Nothing about that store is mounts-specific. Two things are wrong as
it stands:

1. **Namespace mismatch.** Env vars are named `AGENTA_MOUNTS_STORAGE_*`, reading as
   "mounts' private storage" when the store is the platform's shared store. A second
   consumer would either reuse a mounts-named var (confusing) or duplicate the config
   block (wastes, drifts).

2. **Missing top-level prefix.** Mount objects sit at bucket root:
   `<project_id>/<mount_id>/…`. A second consumer at the same root collides with mount
   keys; per-consumer lifecycle (TTL, quota, deletion) cannot be expressed without a
   top-level discriminator.

Both are cheap now and expensive once a second consumer ships. Do them together — they touch
the same config and key-derivation code.

## Break clean — NO fallback, NO dual-read

`store-generalization.md` proposed a deprecation fallback (read old vars when new are unset,
log a warning, drop the fallback a release later). **This project overrides that decision:
break clean.** Nothing is deployed; dev data can be dropped. There will be no dual-read
shim, no legacy alias in `env.py`, and no "if unset, try the old name" logic anywhere.
Every old name is deleted in the same commit that adds the new name.

## Decision 1 — rename the env namespace

All six `AGENTA_MOUNTS_STORAGE_*` vars rename to `AGENTA_STORE_*`:

| Old name | New name |
|---|---|
| `AGENTA_MOUNTS_STORAGE_ENDPOINT_URL` | `AGENTA_STORE_ENDPOINT_URL` |
| `AGENTA_MOUNTS_STORAGE_ACCESS_KEY` | `AGENTA_STORE_ACCESS_KEY` |
| `AGENTA_MOUNTS_STORAGE_SECRET_KEY` | `AGENTA_STORE_SECRET_KEY` |
| `AGENTA_MOUNTS_STORAGE_REGION` | `AGENTA_STORE_REGION` |
| `AGENTA_MOUNTS_STORAGE_BUCKET` | `AGENTA_STORE_BUCKET` |
| `AGENTA_MOUNTS_STORAGE_SIGNING_KEY` | `AGENTA_STORE_SIGNING_KEY` |

`AGENTA_MOUNTS_TUNNEL_API` is **not renamed** — it is the ngrok tunnel-discovery URL, a
mounts injection concern (the runner needs to reach the store from inside a remote sandbox),
not a store-credential var. It reads as "the tunnel API used by the mounts runner path" and
stays `AGENTA_MOUNTS_TUNNEL_API`. Renaming it to `AGENTA_STORE_TUNNEL_API` would imply the
store knows about tunnels, which it does not.

## Decision 2 — move the adapter and signing helper to `core/store/`

`api/oss/src/core/mounts/storage.py` contains `MountStorage` (S3-compatible adapter,
miniopy-async) and `_parse_federation_token` + `MountStorage.sign_temp_credentials`
(STS GetFederationToken signing). These have no logical coupling to the mounts domain; they
are a generic S3 adapter with scoped-credential signing.

Move the file (and its public symbols) to `api/oss/src/core/store/storage.py`. Rename the
class `MountStorage` → `ObjectStore` to match the new domain. Callers (`api/entrypoints/
routers.py`, `api/oss/src/core/mounts/service.py`) update their imports. `MountStorage` in
`core/mounts/types.py` exceptions (`MountStorageUnavailable`) is a mounts-domain exception
that stays in `core/mounts/`.

## Decision 3 — split `MountsConfig` into `StoreConfig` + a slimmed `MountsConfig`

In `api/oss/src/utils/env.py`:
- **New `StoreConfig`** reads the six `AGENTA_STORE_*` vars: `endpoint_url`, `access_key`,
  `secret_key`, `region`, `bucket`. No mounts-specific fields.
- **`MountsConfig`** retains only mounts-specific settings. Currently there are none beyond
  the storage vars — the signing key does not belong to `MountsConfig` either (it is a
  store-level capability). After this change `MountsConfig` becomes a very thin model; it
  exists as a hook for future mounts-only config (e.g. a default bucket name override, or
  a mounts-domain flag).
- **`EnvironSettings`** gains a `store: StoreConfig` attribute alongside the existing
  `mounts: MountsConfig`. The `mounts` namespace remains for any future mounts-specific
  settings. `env.mounts.storage_*` references in `api/entrypoints/routers.py` become
  `env.store.*`.

## Decision 4 — add a `mounts/` top-level prefix to every key

Today `_storage_key` in `MountsService` builds:

```
<project_id>/<mount_id>/<path>
```

Change it to:

```
mounts/<project_id>/<mount_id>/<path>
```

The function lives at `api/oss/src/core/mounts/service.py`, method `_storage_key` (line 98
in the merged branch). Callers (`sign_mount_credentials`, `list_files`, `read_file*`,
`write_file`, `create_folder`, `delete_path`) pass their keys through this method — no
caller change is needed, only `_storage_key` itself.

The STS inline policy in `ObjectStore._scope_policy` (post-move:
`api/oss/src/core/store/storage.py`) constructs the resource ARN from the `prefix`
argument. After the rename, the caller (`MountsService.sign_mount_credentials`) passes
`prefix = "mounts/<project_id>/<mount_id>"`, so the ARN becomes
`arn:aws:s3:::<bucket>/mounts/<project_id>/<mount_id>/*` — correct with no change to
`_scope_policy` itself.

No re-key migration is needed. Dev data can be dropped (nothing deployed).

## Decision 5 — update every env surface atomically

The six var renames must land in all surfaces in the same change:
- `api/oss/src/utils/env.py` (`StoreConfig`)
- `api/entrypoints/routers.py` (`env.store.*`)
- `hosting/docker-compose/oss/docker-compose.dev.yml`
- `hosting/docker-compose/ee/docker-compose.dev.yml`
- `hosting/kubernetes/helm/templates/_helpers.tpl` (env injection block, lines 860–884)
- `hosting/kubernetes/helm/templates/secrets.yaml` (key names in `stringData`)
- `hosting/kubernetes/helm/templates/seaweedfs-statefulset.yaml` (`AGENTA_STORE_*` in
  the startup script and `env.valueFrom.secretKeyRef.key` fields)
- `hosting/kubernetes/helm/values.yaml` (comments only; values keys like `accessKey`,
  `signingKey` are under `mounts:` and do not change — only the env var names inside the
  templates change)
- `hosting/kubernetes/{oss,ee}/values.*.example.yaml` (update example comment blocks)

`seaweedfs.enabled` is the bundle-or-external toggle; it is not a credential var and its
name does not change.

## Sequencing note — W6 vs adjacent worktrees

W6 (store generalization) and W5 (runner rename) touch mostly disjoint files: W5 is
`services/agent` + runner env (`AGENTA_AGENT_RUNNER_*`); W6 is `core/mounts` → `core/store`
+ store env (`AGENTA_MOUNTS_STORAGE_*`). The only overlap is adjacent lines in the same
compose/Helm/env-example files. Both are independent worktrees; merge-and-resolve; stitched
by the local integration PR before merging to `big-agents`.

W3 (`feat/private-cloud-env`) and W4 (`feat/mounts-nondev-wiring`) consume the final
`AGENTA_STORE_*` names — they depend on W6 landing (or being stitched in the integration
PR) before their env blocks are correct.

## Scope notes

- Refactor + rename + key-prefix change. No new capability.
- Security model unchanged: master creds stay in the API; runners get short-lived scoped
  tokens via the existing `POST /sessions/mounts/sign` signing endpoint.
- The prefix change makes per-consumer scoping finer, not different.

## Decided

- **Break clean** — no dual-read, no legacy alias, no deprecation fallback.
- **`AGENTA_MOUNTS_TUNNEL_API` stays** — it is the runner-side tunnel-discovery URL, not a
  store credential var.
- **`seaweedfs.enabled` stays** — it is the bundle-or-external service toggle, not a store
  var.
- **`MountStorage` → `ObjectStore`** (class rename, moved to `core/store/storage.py`).
- **`StoreConfig`** new in `env.py`; `MountsConfig` slimmed (currently no remaining fields,
  but namespace kept for future mounts-only config).
- **`mounts/` prefix** — `_storage_key` in `MountsService` prepends `mounts/`; STS policy
  ARN follows automatically from the prefix argument.

## Out of scope

- Re-keying or migrating existing bucket contents.
- Adding a second store consumer (just clearing the path).
- External-store `is_external` per-row credentials — deferred, see mounts specs.
- Non-dev surface wiring (Railway, preview/live S3, gh compose, private platform repo) —
  that is W3/W4.
