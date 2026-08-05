# Tasks — store generalization

> Ordered, design-first. No blockers; implement in dependency order below.
> `[ ]` = not started.

## 0. Decided / blockers

- [x] **Break clean** — no dual-read, no legacy alias. Delete old names in the same
      commit that adds new names.
- [x] `AGENTA_MOUNTS_TUNNEL_API` stays — runner-side tunnel discovery, not a store
      credential var.
- [x] `seaweedfs.enabled` toggle name stays — bundle-or-external service toggle, not
      a store credential var.
- [x] Prefix change: `<project_id>/<mount_id>/` → `mounts/<project_id>/<mount_id>/`.
      Dev data can be dropped; nothing deployed.

## 1. Python — new `core/store/` module

- [ ] Create `api/oss/src/core/store/__init__.py`.
- [ ] Move `api/oss/src/core/mounts/storage.py` to `api/oss/src/core/store/storage.py`.
      Rename class `MountStorage` → `ObjectStore`. Internal imports inside the file
      (`from oss.src.core.mounts.types import MountFileNotFound, MountStorageUnavailable`)
      remain — the exceptions stay in `core/mounts/types.py`.
- [ ] Delete `api/oss/src/core/mounts/storage.py` (replaced by the move above).

## 2. Python — `env.py` config split

In `api/oss/src/utils/env.py`:
- [ ] Add `StoreConfig(BaseModel)` reading `AGENTA_STORE_{ENDPOINT_URL, ACCESS_KEY,
      SECRET_KEY, REGION, BUCKET}` (drop all six old `AGENTA_MOUNTS_STORAGE_*` reads).
- [ ] Slim `MountsConfig` — remove its six `storage_*` fields entirely. Leave the class
      (empty for now) as a namespace for future mounts-only config.
- [ ] Add `store: StoreConfig = StoreConfig()` to `EnvironSettings`. Remove
      `env.mounts.storage_*` fields from `MountsConfig`.

## 3. Python — update callers of the store

- [ ] `api/entrypoints/routers.py` — update the `MountStorage` import to
      `from oss.src.core.store.storage import ObjectStore`; rename the construction
      `mounts_storage = MountStorage(…)` → `store = ObjectStore(…)` using
      `env.store.*` instead of `env.mounts.storage_*`; pass `store` to `MountsService`.
- [ ] `api/oss/src/core/mounts/service.py` — update import from
      `oss.src.core.mounts.storage` → `oss.src.core.store.storage`; rename the type
      hint `MountStorage` → `ObjectStore` in `__init__` and `sign_mount_credentials`.

## 4. Python — `mounts/` key prefix

In `api/oss/src/core/mounts/service.py`, method `_storage_key` (currently at line 98):
- [ ] Change the key formula from
      `f"{project_id}/{mount.id}"` to `f"mounts/{project_id}/{mount.id}"`.
      No other change needed; all file-op methods and `sign_mount_credentials` call
      `_storage_key`, so the prefix propagates automatically. The STS policy ARN in
      `ObjectStore._scope_policy` (now in `core/store/storage.py`) is built from the
      `prefix` argument — it picks up `mounts/…` at call time with no code change.

## 5. Compose — rename env vars (dev)

In both `hosting/docker-compose/oss/docker-compose.dev.yml` and
`hosting/docker-compose/ee/docker-compose.dev.yml`:
- [ ] Replace every occurrence of `AGENTA_MOUNTS_STORAGE_ENDPOINT_URL`,
      `AGENTA_MOUNTS_STORAGE_ACCESS_KEY`, `AGENTA_MOUNTS_STORAGE_SECRET_KEY`,
      `AGENTA_MOUNTS_STORAGE_REGION`, `AGENTA_MOUNTS_STORAGE_BUCKET`, and
      `AGENTA_MOUNTS_STORAGE_SIGNING_KEY` with the corresponding `AGENTA_STORE_*` name.
      Update both the per-service `environment:` blocks (api, worker-*, sandbox-agent
      variants) and the `seaweedfs` service startup script that inlines the access/secret
      keys into `s3.json` and maps `WEED_JWT_FILER_SIGNING_KEY` from the secret.
- [ ] Leave `AGENTA_MOUNTS_TUNNEL_API` untouched.

## 6. Helm — rename env vars and secret keys

- [ ] `hosting/kubernetes/helm/templates/_helpers.tpl` (mounts env block, lines 860–884):
      rename all six `AGENTA_MOUNTS_STORAGE_*` env var names to `AGENTA_STORE_*` (both the
      `name:` fields and the `secretKeyRef.key:` fields that reference the secret).
- [ ] `hosting/kubernetes/helm/templates/secrets.yaml` (`stringData` block, lines 46–52):
      rename the six key names from `AGENTA_MOUNTS_STORAGE_*` to `AGENTA_STORE_*`.
- [ ] `hosting/kubernetes/helm/templates/seaweedfs-statefulset.yaml`:
      rename `AGENTA_MOUNTS_STORAGE_ACCESS_KEY` and `AGENTA_MOUNTS_STORAGE_SECRET_KEY` in
      the startup command (the `s3.json` inline) and their `env.valueFrom.secretKeyRef.key`
      fields; rename `AGENTA_MOUNTS_STORAGE_SIGNING_KEY` in the
      `WEED_JWT_FILER_SIGNING_KEY` env binding.
- [ ] `hosting/kubernetes/helm/values.yaml`: update inline comments that reference
      `AGENTA_MOUNTS_STORAGE_*` to `AGENTA_STORE_*`. Helm values keys (`accessKey`,
      `secretKey`, `signingKey`, `endpointUrl`, `region`, `bucket`) under the `mounts:`
      block do not change.

## 7. Helm example values

- [ ] `hosting/kubernetes/oss/values.oss.example.yaml` — update any comment lines
      referencing `AGENTA_MOUNTS_STORAGE_*` to `AGENTA_STORE_*`.
- [ ] `hosting/kubernetes/ee/values.ee.example.yaml` — same.

## 8. Tests — update fixtures / env references

- [ ] `api/oss/tests/pytest/acceptance/mounts/test_mounts_basics.py` — update any
      `AGENTA_MOUNTS_STORAGE_*` env references or overrides to `AGENTA_STORE_*`.
- [ ] `api/oss/tests/pytest/acceptance/mounts/test_mounts_injection.py` — same.
- [ ] Verify the import path `from oss.src.core.mounts.storage import MountStorage` in
      any test files is updated to `from oss.src.core.store.storage import ObjectStore`.

## 9. Smoke check

- [ ] `ruff format && ruff check` pass with no errors.
- [ ] `grep -rn "AGENTA_MOUNTS_STORAGE" .` returns zero hits across the repo.
- [ ] `grep -rn "MountStorage" .` returns zero hits outside the deleted file (if any
      dangling `__pycache__` references, ignore; check only `.py` source files).
- [ ] Dev compose `docker-compose.dev.yml` starts cleanly with the renamed vars
      (`run.sh --oss --dev`).

## Out of scope (this worktree)

- Non-dev surface wiring (Railway, preview/live S3, gh/prod compose, private platform
  repo) — that is W3 (`feat/private-cloud-env`) and W4 (`feat/mounts-nondev-wiring`).
- Adding a second store consumer beyond mounts.
- Re-keying or migrating existing bucket objects.
- External-store per-row credentials (`is_external` + per-row creds/url) — deferred.
