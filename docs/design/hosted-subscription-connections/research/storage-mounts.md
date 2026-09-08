# Storage mounts and a shared auth home

Question: can one small `auth.json`, read and rewritten by several harness processes, live on
Agenta's object-store mounts?

Answer: no, not as a shared POSIX file. Measured on the live stack on 2026-09-08, with the
runner's own geesefs flags:

| What | Measured |
| --- | --- |
| A second mount kept serving the old bytes for | 58.2 seconds |
| Two writers, 20 writes each, on one key. Values that survived | one writer's |
| Exclusive `flock` held on both mounts at the same time | yes |
| A symlink read from a mount created after it was written | zero-byte file |

The mount is geesefs over S3. Upstream states that concurrent updates of one file from several
mounts are unsupported. The 58.2 seconds match the 60-second stat cache time to live, which the
runner does not override. There is no cross-mount lock, and a rename is a copy plus a delete, so
the temp-plus-rename idiom gives no atomic replace.

A cheap alternative exists. The store under the mount is SeaweedFS 4.37, and it answers
conditional PUT. The same probe returned 200 for `If-None-Match: *` on an absent key, 412 on an
existing key, 200 for a correct `If-Match`, and 412 for a stale one. That is a compare-and-swap
primitive. It needs a direct S3 call, not the mount.

This document records how the mounts work, what geesefs guarantees, what the store guarantees,
what the alternatives cost, and the experiment that measured all of it.

> Correction (2026-09-08, after Codex review): the lock cell below tests `flock`. Pi uses
> `proper-lockfile`, which coordinates through a lock directory (`mkdir`), not `flock`. The
> measured result shows that `flock` does not cross mounts. It does not show that Pi's own lock
> fails across mounts, and it does not show that an overwritten token is unusable, because the
> provider accepts overlapping token lineages for about an hour (see working-research.md). The
> 58-second cache staleness stands on its own. The mount candidate was not chosen for the
> staleness and the lost-update behavior, not for the lock result.

## 1. How the durable session cwd is mounted

### 1.1 The geesefs command line

The runner builds one argv for every mount, local and remote
(`services/runner/src/engines/sandbox_agent/mount.ts:223-243`):

```
geesefs --endpoint <url> --region <region> --no-detect --fsync-on-close [-f] \
        -o allow_other <bucket>:<prefix> <mountpoint>
```

That is the complete flag set. The runner sets no cache flag, no `--memory-limit`, no
`--stat-cache-ttl`, no `--dir-mode` or `--file-mode`, no `--no-dir-object`, no `--enable-mtime`,
and no `--ignore-fsync`. Every cache default therefore applies.

The defaults come from the binary in the runner image. The image pins geesefs `v0.43.0`
(`services/runner/docker/Dockerfile.dev:38`, `services/runner/docker/Dockerfile.gh:50`). Running
`geesefs --help` in `agenta-ee-dev-hostedsub-runner-1` gives:

| Flag | Default | Effect |
| --- | --- | --- |
| `--stat-cache-ttl` | `1m0s` | How long to cache file metadata. |
| `--memory-limit` | `1000` MB | Maximum memory for the data cache. |
| `--entry-limit` | `100000` | Metadata entries cached in memory. |
| `--single-part` | `5` MB | Maximum size uploaded as a single part. |
| `--refresh-attr` | `.invalidate` | The xattr name that refreshes one entry's cache. |
| `--cache` | off | On-disk data cache directory. |
| `--fsync-on-close` | off, but the runner turns it ON | Wait for the server on close. |

`--no-detect` only turns off the start probes for anonymous access, bucket location, and
signature algorithm. It changes no cache or consistency behavior.

`-f` keeps geesefs in the foreground for a local mount, because a detached daemon died under
write-heavy load and left `ENOTCONN` behind (`mount.ts:235-237`). The remote mount omits `-f`,
because the sandbox RPC blocks until the command exits (`mount.ts:686-690`,
`mount.ts:713-716`).

### 1.2 Credentials, and how they reach geesefs

The runner never holds the store master key. It calls
`POST /sessions/mounts/sign?session_id=...&name=...` and gets short-lived, prefix-scoped
credentials (`mount.ts:75-140`). The credentials ride the child process environment as
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN`, never argv, so they do
not leak to the process table (`mount.ts:245-253`).

The API mints them in two ways, selected by the presence of `AGENTA_STORE_SIGNING_KEY`
(`api/oss/src/core/store/storage.py:106-110`):

- SeaweedFS, which is the bundled and self-hosted store: `AssumeRoleWithWebIdentity` against the
  S3 endpoint, with a self-minted RS256 JWT and role `arn:aws:iam::role/agenta-store`
  (`storage.py:239-276`, `api/oss/src/core/store/webidentity.py:91-119`).
- A remote S3-compatible store, which is what Agenta cloud uses: SigV4 `GetFederationToken`
  (`storage.py:278-336`).

Both attach an inline session policy scoped to the mount's own prefix (`storage.py:145-199`).
Object read and write are limited to `arn:aws:s3:::<bucket>/<prefix>/*`, and `ListBucket` carries
an `s3:prefix` condition. Signing fails closed when the prefix or the policy is empty
(`storage.py:229-233`).

The time to live is `AGENTA_MOUNTS_CREDENTIALS_TTL_SECONDS`, default 43200 seconds, which is 12
hours (`api/oss/src/utils/env.py:1377-1394`). The bundled SeaweedFS caps a session at the same 12
hours through `maxSessionLength` in its IAM config
(`hosting/docker-compose/ee/docker-compose.dev.yml:660-662`).

### 1.3 The key layout in the bucket

`MountsService._storage_key` builds the prefix (`api/oss/src/core/mounts/service.py:420-433`):

```
mounts/<project_id>/<mount_id>                       # AGENTA_STORE_NAMESPACE unset
<namespace>/mounts/<project_id>/<mount_id>           # namespace set
```

`sign_mount_credentials` strips the trailing slash and returns that string as `prefix`
(`service.py:875`). Note a comment drift: `service.py:874` describes the prefix as
`<project_id>/<mount_id>` and omits the literal `mounts/` segment the code emits.

`mount_id` is the mount row's uuid7 id. The row is get-or-create per session and name, keyed by a
deterministic slug `__ag__session__<uuid5(namespace, session_id)>__<slug(name)>`
(`service.py:85-92`, `service.py:475-507`). The same session and name therefore always resolve to
the same prefix, and re-binding un-archives the row
(`api/oss/src/dbs/postgres/mounts/dao.py:81-96`).

The runner derives the mountpoint from that same prefix, so there is one source of truth
(`services/runner/src/engines/sandbox_agent/environment-setup.ts:150-159`):

```
local:   /tmp/agenta/<prefix>
daytona: /home/sandbox/agenta/<prefix>
```

### 1.4 When the mount is created and torn down

Local. `mountLocalDurableCwd` mounts the durable cwd on the runner host during environment
acquisition (`services/runner/src/environment/mount-lifecycle.ts:193-231`). `mountStorage` is
idempotent: it first probes the path and returns early when the mount already serves input and
output (`mount.ts:309-328`). The probe is not `mountpoint -q` alone. A dead geesefs leaves a
stale kernel entry that answers every operation with `ENOTCONN`, so `isMounted` also runs
`ls -A` and treats a failure as not mounted (`mount.ts:264-285`).

Teardown runs `fusermount -uz`, which is a lazy unmount, and then confirms the mountpoint is
gone. Only a confirmed detach lets the caller delete the directory (`mount.ts:475-502`).

Remote. `mountStorageRemote` runs geesefs inside the sandbox, backgrounded, with its log in
`/tmp/geesefs-mount.log`, then polls for liveness for about a minute
(`mount.ts:687-783`). The durable cwd is mounted before the session is created and before the
workspace is materialized, so `CLAUDE.md`, harness files, and skills land in the durable prefix
instead of under the mount (`services/runner/src/engines/sandbox_agent/environment.ts:895-945`).

### 1.5 What happens when the credentials expire

There is no in-place credential refresh. geesefs keeps the credentials it started with, and the
API has no renewal endpoint. The service docstring says so directly: a turn that outlives the
time to live hits `ExpiredToken` (`service.py:866-867`).

The runner reacts after the fact. When an ACP event contains "Transport endpoint is not
connected", it re-signs and remounts every eligible local mount
(`mount-lifecycle.ts:352-388`). The cwd path is `reSignAndRemountLocalCwd`
(`mount-lifecycle.ts:322-349`) and the agent path is `reSignAndRemountLocalAgentMount`
(`mount-lifecycle.ts:276-313`). Both take a bounded remount budget. The Daytona path has no
equivalent remount.

### 1.6 Daytona, and whether a second prefix can be mounted beside the cwd

Daytona mounts the store from inside the virtual machine. geesefs runs there, not on the runner
host. In dev the sandbox cannot reach `seaweedfs:8333` on the compose network, so the runner
discovers an ngrok tunnel through the agent API at `http://ngrok:4040/api/tunnels` and passes the
public URL as `--endpoint` (`mount.ts:546-578`, `environment.ts:905-915`). The compose profile is
`with-tunnel` (`hosting/docker-compose/ee/docker-compose.dev.yml:697-737`). In Agenta cloud the
store is real AWS S3, the sandbox reaches it directly, and no tunnel is used
(`docs/designs/platform/mounts-nondev-wiring/specs.md:116-124`). `storeReachableFromSandbox`
decides which case applies (`mount.ts:195-216`). With neither a reachable store nor a tunnel the
mount is refused, and the refusal is announced to the operator and to the model
(`environment.ts:882-925`).

A second prefix can be mounted beside the cwd. The code already does it three times.

1. Per-harness transcript mounts. `harnessSessionMounts` returns `~/.claude/projects` for Claude
   and `~/.pi/agent/sessions` for Pi. Each is its own sign call and its own geesefs mount, with
   its own `mount_id` and prefix (`mount.ts:175-188`, `mount.ts:803-843`). These are remote only.
2. The agent mount. It is keyed by artifact rather than session, signed through
   `POST /mounts/agents/sign`, and mounted at the sibling path `<cwd>-agent`
   (`services/runner/src/engines/sandbox_agent/agent-mount.ts:35-37`,
   `mount-lifecycle.ts:233-273`).
3. The attachments mount, which the API reserves and refuses to sign
   (`service.py:495-496`).

The `name` query parameter is free-form. It is slugified, checked for emptiness, and rejected
only for the reserved name `attachments` (`service.py:72-82`, `service.py:494-496`). No allowlist
exists, and no per-session mount cap exists. A new mount named `auth-home` would sign today with
no API change, and would get its own prefix, isolated from the cwd and transcript prefixes.

So the mechanism is available. The rest of this document is about whether the file semantics on
top of it are usable.

### 1.7 What the subscription path does today

Today's ChatGPT subscription run does not put `auth.json` on the store. `CODEX_HOME` on the runner
is an operator bind mount, a plain host directory. The runner creates a per-session home at
`<cwd>/.codex` on the durable mount, and symlinks `<cwd>/.codex/auth.json` to
`$CODEX_HOME/auth.json` on that host directory, so codex's in-place refresh lands in the operator's
real login (`services/runner/src/engines/sandbox_agent/codex-assets.ts:167-213`).

Two facts follow. First, the shared auth home already exists and is already multi-writer, but it
sits on an ordinary local filesystem where POSIX rules hold. Second, the symlink itself is a known
hazard on the mount. Object storage has no symlinks, so a round trip hands the entry back as a
zero-byte file, a run read an empty token file, and it reported an authentication failure
(issue #5692). `ensureDurableSymlink` re-materializes the link after every mount rather than
trusting that the path exists
(`services/runner/src/engines/sandbox_agent/durable-symlink.ts:1-19`,
`mount-lifecycle.ts:214-224`).

The agent mount README already states the concurrency rule the product accepted for durable
folders: "Concurrent runs share this folder, so the last writer wins for each file."
(`agent-mount.ts:24-29`). Last writer wins is acceptable for agent files. It is not acceptable for
a refresh token, because the loser's token is the only copy of a value the provider has already
rotated.

## 2. geesefs semantics for one small JSON file

Sources are the geesefs README and the `master` source at
<https://github.com/yandex-cloud/geesefs>, plus the `--help` output of the pinned `v0.43.0`
binary in the runner container. Inference is marked.

### 2.1 Write-back caching

`write()` never talks to S3. The FUSE flush handler is a documented no-op: "FlushFile is a no-op
because we flush changes to the server asynchronously. If the user really wants to persist a file
to the server he should call fsync()" (`core/goofys_fuse.go`). Uploads run on background
goroutines dispatched by `sendUpload()` in `core/file.go`.

There is no flush timer and no `--flush-delay` flag. The flusher is a condition-variable loop
woken by `WakeupFlusher()` (`core/goofys.go`). The gate for a small dirty file is that no file
descriptor is open:

```go
if inode.IsFlushing == 0 && (inode.fileHandles == 0 || inode.forceFlush ||
    atomic.LoadInt32(&inode.fs.wantFree) > 0) {
```

`--fsync-on-close`, which the runner sets, makes `ReleaseFileHandle` call `SyncFile()`, and
`SyncFile()` sets `forceFlush` and blocks until the PUT completes (`core/goofys_fuse.go`,
`core/cfg/flags.go`). So on this deployment the writer's close does wait for the store.

A landed PUT is not the same as visibility on another mount. See the next section.

### 2.2 Read-side caching

`--stat-cache-ttl` defaults to one minute and feeds two caches. It sets the kernel attribute and
entry expiration on every lookup, and it drives geesefs's own inode cache and its metadata
evictor (`core/goofys_fuse.go`, `core/handles.go`, `core/goofys.go`). Until an entry expires,
neither the kernel nor geesefs issues any S3 request, so a reader sees the old size and the old
content.

`--type-cache-ttl` does not exist in geesefs. It is a goofys flag. The pinned binary's help output
does not list it.

The kernel page cache is off. `OpenFile` sets `KeepPageCache = false` with the comment that
geesefs has its own in-memory cache, and the mount sets `DisableWritebackCaching = true`. Stale
data therefore comes from geesefs's own buffers.

Cached data is dropped only when a refreshed listing or HEAD shows a different ETag or size
(`SetFromBlobItem` in `core/handles.go`, log line "File is changed remotely, dropping cache").

The documented escape hatch is the `.invalidate` xattr, which is `--refresh-attr` and which the
pinned binary confirms defaults to `.invalidate`. Setting it refreshes one file's or directory's
cache.

The README states the rule that governs this whole question:

> GeeseFS doesn't support concurrent updates of the same file from multiple hosts. If you try to
> do that you should guarantee that one host calls `fsync()` on the modified file and then waits
> for at least `--stat-cache-ttl` (1 minute by default) before allowing other hosts to start
> updating the file. Other way is to refresh file/directory cache forcibly using
> `setfattr -n .invalidate <filename>`.

The Yandex-only `--enable-patch` mode relaxes this, and SeaweedFS does not implement the PATCH
extension, so that path is closed here.

### 2.3 Rename

Rename is applied to the local tree at once and executed on S3 later by the flusher.
`Rename()` in `core/dir.go` moves the inode and records `oldParent` and `oldName`; `sendUpload()`
then calls `sendRename()`, which does `CopyBlob` followed by `DeleteBlob`. The README lists
"asynchronous rename" as a feature.

Rename is therefore not atomic for a reader on another mount. Between the copy and the delete
both keys exist. The reader can see the old file, the new file, or both, and the stat cache
extends the old view further. The body of a single key is never torn on AWS S3, because updates
to one key are atomic there. Inference: SeaweedFS is expected to be per-key atomic too, but
SeaweedFS documents no such guarantee.

The practical consequence is the one that matters. The temp-plus-rename idiom, which is how a
POSIX program replaces a config file atomically, does not give an atomic replace here.

### 2.4 Symlinks

geesefs does support symlinks, but through S3 user metadata, not a real object type.
`CreateSymlink` writes the target into `userMetadata[--symlink-attr]`, default header
`x-amz-meta---symlink-target`, and leaves the object zero bytes (`core/dir.go`). `ReadSymlink`
returns `EIO` when that metadata is absent.

The README limits this to one provider:

> File mode/owner/group, symbolic links, custom mtimes and special files ... are supported, but
> they are restored correctly only when using Yandex S3 because standard S3 doesn't return user
> metadata in listings and reading all this metadata in standard S3 would require an additional
> HEAD request for every file in listing which would make listings too slow.

Inference: an inode populated from a directory listing has no `userMetadata`, so the entry appears
as an ordinary zero-byte file, which matches the Agenta code comment. An inode populated by a
single-file HEAD may resolve. That makes the behavior depend on the access path. Upstream issues
14 and 35 report symlinks that do not restore after a remount. Section 5 measures the real
behavior on SeaweedFS.

### 2.5 File locks

The README lists "does not support locking" among the POSIX incompatibilities. geesefs implements
no `getlk`, `setlk`, or `flock` handler. The libfuse contract says the kernel then implements
locking itself, and that a network filesystem must implement the lock operations for locking to
work between clients. So `flock` and `fcntl` locks on a geesefs mount are local to that mount and
that machine. Two processes on the same mount exclude each other. Two processes on two mounts of
the same prefix do not see each other's locks. Section 5 measures this.

### 2.6 In-place overwrite and truncate

Truncate touches only local memory. `ResizeUnlocked` drops buffers, sets the size, and marks the
inode modified (`core/file.go`). No S3 request is issued by the truncate.

The rewrite is one full PUT, never multipart, because `--single-part` defaults to 5 MB and the
file is a few kilobytes. A modified small file is read back from the store before the PUT, and a
conflict there discards the local changes with only a log warning:

```
Conflict detected (inode %v): File %v is deleted or resized remotely, discarding local changes
```

That is silent data loss from the application's point of view. No error reaches the writer. The
experiment did not trigger this path, and it did not need to: section 5.2 cell 5 shows that plain
last-writer-wins already loses one writer's value, with a 200 from the store on every PUT.

Inference: a zero-length or partial object can still be PUT in three cases. The application calls
`fsync()` after truncating to zero and before writing. Memory pressure sets `wantFree`. Or one
descriptor closes mid-update while another still holds the file open with `--fsync-on-close` set.
Section 5 looks for these.

## 3. SeaweedFS S3 against AWS S3

| Property | AWS S3 | SeaweedFS 4.37 |
| --- | --- | --- |
| Read after write on PUT then GET | Strongly consistent since December 2020. | Not documented. Measured strongly consistent on the local stack, see section 5. |
| Concurrent PUT to one key | Last writer wins, by timestamp. No object locking for concurrent writers. | Same behavior measured. |
| Partial or torn read of one key | Never. Updates to a single key are atomic. | No partial or torn read observed, see section 5. |
| `If-None-Match: *` on PutObject | Yes, since August 2024. 412 when the key exists. | Yes. Measured 200 then 412. |
| `If-Match: <etag>` on PutObject | Yes, since November 2024. 412 on mismatch. | Yes. Measured 200 on match, 412 on a stale ETag. |
| Object versioning | Yes. | Yes, since release 3.94. |

SeaweedFS added conditional read and write in pull request 7154, merged 2025-08-22, and shipped
it in release 3.97 on 2025-09-01. A later bug made conditional write fail on versioned buckets
(issue 8073, against 4.07), and pull request 8080 fixed it in January 2026. The pinned 4.37
release is from June 2026, so it carries the fix. The measurement in section 5 confirms the
non-versioned case on the live stack.

AWS S3 has the same primitive, so a compare-and-swap design works in Agenta cloud and in
self-hosted deployments alike. Cloudflare R2 is out of scope: the API's remote path needs
`GetFederationToken`, which R2 does not offer
(`docs/docs/self-host/reference/01-configuration.mdx:610-700`).

geesefs never emits a conditional header. `flushSmallObject()` builds a plain `PutBlobInput`. The
compare-and-swap primitive is only reachable by bypassing the mount.

## 4. Alternatives to a mount for the auth home

### 4.1 Direct S3 GET and PUT around each run

The runner fetches `auth.json` to local disk before the harness starts, and uploads it after the
harness rewrites it. The mount stays out of the credential path.

The code that makes this cheap already exists. `signSessionMountCredentials` and
`signAgentMountCredentials` already return `endpoint`, `region`, `bucket`, `prefix`, and an STS
triple (`mount.ts:75-140`, `agent-mount.ts:44-112`). A new mount name such as `auth-home` needs no
API change (section 1.6). The runner would add a small SigV4 client; the experiment driver in
`research/experiments/mount-semantics.mjs` contains a working one in about 70 lines.

A concurrent refresh loser overwrites the winner's new token with its own, unless the upload uses
`If-Match` on the ETag it read. With `If-Match`, the loser gets 412, re-reads, and finds that the
provider already rotated the token. It must then either use the winner's token or perform its own
refresh. This is the cheapest correct option, because the compare-and-swap is one HTTP header.

Cost: the harness still writes the file locally during the run, so a refresh that happens mid-turn
is only uploaded at the end of the turn. A long turn can hold a rotated token for its whole
duration. That is acceptable when the refresh interval is much longer than a turn, and it is not
acceptable when the provider rotates a refresh token on every use.

### 4.2 A Postgres row through the API

The API stores the credential blob in a row and serves it over an authenticated endpoint. The
runner reads it at start and writes it back after a refresh.

Postgres gives real transactions, so the compare-and-swap is a version column and a conditional
`UPDATE`. It also gives a place to record who refreshed and when, which the object store does not.
The vault already exists for project credentials, so the shape is familiar.

A concurrent refresh loser gets a version conflict, re-reads the row, and sees the winner's token.
Nothing is lost. This is the strongest option for correctness.

Cost: a new endpoint, a new table or a new vault kind, migrations, and the permission surface that
comes with storing an OAuth refresh token in the product database. It is more work than 4.1 and
it puts a live provider credential in a place the current design deliberately keeps credentials
out of. The runner's mount comment states the standing rule: credentials are excluded from durable
mounts because the runner re-injects managed credentials per run (`mount.ts:142-155`).

### 4.3 A watcher or a poll in the runner that re-uploads on change

The runner watches the local `auth.json` with `inotify` or polls its modification time, and
uploads whenever it changes.

This narrows the window in 4.1 from a whole turn to the watcher's latency. It composes with
either 4.1 or 4.2 as the upload path.

A concurrent refresh loser is in the same position as in 4.1, and the outcome depends entirely on
whether the upload is conditional. Without `If-Match` the last writer wins and a rotated token is
lost. With `If-Match` the loser learns it lost and can re-read.

Cost: a watcher is another moving part in a process that already manages mounts, and it fires on
every harness write, not only on a refresh. It also cannot see a refresh that happens inside a
Daytona sandbox, because the file is in the virtual machine. For Daytona the upload has to be
driven from inside the sandbox or at the turn boundary.

### 4.4 What not to do

Do not put the shared `auth.json` on a geesefs mount and rely on POSIX. Upstream documents this
exact case as unsupported. Measured on the live stack: a reader on a second mount was stale for
58 seconds, two writers each landed 20 successful PUTs on one key and only one writer's value
survived, and an exclusive lock taken on one mount did not exclude the other mount at all.

Do not fix it with a lock file on the mount. Cell 6 shows the lock does not cross mounts.

Do not fix it with temp plus rename. Cell 4 shows it removes the torn-read risk, which was never
the problem, and leaves the lost update untouched.

Do not rely on a symlink into the mount to carry a credential. Object storage has no symlinks and
the entry comes back as a zero-byte file. That is issue #5692, and the existing code works around
it by re-creating the link after every mount.

## 5. The experiment

The scripts are in `research/experiments/`. They run inside the runner container of a live compose
stack, on the real geesefs mount path, with the exact production argv from `geesefs Args()` in
`mount.ts:223-243`. They never touch a real session prefix; they write under
`research/storage-mounts/<run id>` in the same bucket.

- `research/experiments/run.sh` is the host orchestrator. It reads the store master keys from the
  stack env file, passes them to the container through `docker exec -e`, copies the driver in,
  runs it, copies the results out, and unmounts everything it created. No key value is printed or
  written to a file.
- `research/experiments/mount-semantics.mjs` is the in-container driver. It mounts the same prefix
  two or three times and runs eight cells.

Run it with:

```
bash docs/design/hosted-subscription-connections/research/experiments/run.sh
# optional: --container <name> --env-file <path> --out <dir>
# optional: EXP_CELLS=7_conditional_put to run one cell
```

### 5.1 The cells

| Cell | What it does | What it decides |
| --- | --- | --- |
| 1 cold read | Mount A writes, then mount B is mounted fresh and reads. | Whether the store itself is the problem. |
| 2 warm staleness | Mount B reads first to warm its cache, mount A rewrites, mount B polls. | How long a second mount serves stale bytes. |
| 3 invalidate xattr | Cell 2 with the `.invalidate` xattr set before each read. | Whether the documented escape hatch works here. |
| 4 concurrent rename | Two writers, one per mount, each doing temp plus rename 20 times. A mount reader and a direct S3 reader poll for a torn, empty, or missing file. | Whether temp plus rename is safe. |
| 5 concurrent in place | Two writers rewriting the same file in place 20 times each. | Whether an in-place token rewrite loses updates. |
| 6 flock | One process locks the file on mount A, another locks it on mount B. | Whether a lock crosses mounts. |
| 7 conditional PUT | `If-None-Match: *` and `If-Match` straight against the store. | Whether compare-and-swap is available. |
| 8 symlink round trip | Create a symlink on mount A, read it on a fresh mount C and through direct S3. | What a new sandbox sees. |

### 5.2 Results

The experiment ran on 2026-09-08 against the compose stack `agenta-ee-dev-hostedsub`, in
container `agenta-ee-dev-hostedsub-runner-1`, with geesefs `0.43.0` and SeaweedFS `4.37`. The
argv the driver recorded is the production one:

```
geesefs --endpoint http://seaweedfs:8333 --region us-east-1 --no-detect --fsync-on-close \
        -f -o allow_other agenta-store:research/storage-mounts/20260908-115257 <mountpoint>
```

Evidence:

- `~/agenta-qa-evidence/2026-09-08-storage-mounts/results-20260908-115257.json` (all eight cells)
- `~/agenta-qa-evidence/2026-09-08-storage-mounts/results-20260908-115718.json` (cell 5 repeated
  with `--debug_s3`)
- `~/agenta-qa-evidence/2026-09-08-storage-mounts/driver-*.log` and `geesefs-*.log`

| Cell | Measurement |
| --- | --- |
| 1 cold read | A wrote, the store returned the same bytes, a mount created after the write read the same bytes. Match. |
| 2 warm staleness | Round 1: 58189 ms. Round 2: 58179 ms. |
| 3 invalidate xattr | Round 1: 28 ms. Round 2: 14 ms. One poll each. |
| 4 concurrent rename | 40 renames, 0 failures. 115 direct store reads and 102 mount reads, 0 torn, empty, or missing. No temporary key left in the store. |
| 5 concurrent in place | 40 writes to one key, all PUTs returned 200. The store kept 20 of writer B's versions and 1 of writer A's. |
| 6 flock | Both processes acquired an exclusive lock at the same time. |
| 7 conditional PUT | `If-None-Match: *` 200 then 412. `If-Match` correct 200, stale 412. |
| 8 symlink | The writing mount showed a symlink. A fresh mount showed a zero-byte regular file. |

#### What each result means

**Cell 2 is the decisive one.** Both rounds measured about 58.2 seconds of staleness, which
matches the 60-second `--stat-cache-ttl` default the runner does not override. The clock starts
after a direct store read confirmed the new bytes, so this is cache staleness and not store
latency. Mount B's own log shows why: during the stale window it reports `99.10 % hits` and
`100.00 % hits`, meaning it answered the reads from cache and sent no request to the store.

Round 1 shows a worse case than expected. Mount B had looked for the file before it existed, so
it cached the negative lookup, and it kept returning `ENOENT` for 58 seconds after the file was
created and confirmed in the store. A process that checks for `auth.json` before another process
creates it reports "no login" for a minute.

**Cell 3 shows the escape hatch works here.** The `.invalidate` xattr is accepted on this mount,
and after it the new value appears in 14 to 28 milliseconds. The image has no `setfattr`, so the
driver uses `python3 -c "os.setxattr(path, b'.invalidate', b'1')"`. This makes a read-side
protocol possible, but it does not fix the write side. Every reader must know to call it before
every read, and nothing in a harness does.

**Cell 4 shows the store is not the weak part.** Two writers did temp plus rename 40 times, and
neither a mount reader nor a direct store reader ever saw a torn, empty, or missing file. No
temporary key survived. The one `ENOENT` on the mount reader is its first poll, before the first
rename. So SeaweedFS gave read-after-write consistency and per-key atomicity in this run.

But the two mounts ended up disagreeing. Mount A read `{"who":"A","seq":20}`, mount B read
`{"who":"B","seq":20}`, and the store held B's value. Each mount served its own last write from
cache. Temp plus rename removed the torn-read risk and did nothing about the lost update.

**Cell 5 shows the lost update plainly.** With `--debug_s3`, each mount's log holds exactly 20
`PUT` lines for the shared key, and every response was 200. Both writers succeeded at the store,
40 times, on one key. The store keeps whichever PUT landed last. Writer A's last value exists
nowhere afterwards, and writer A got no error. For a token file that is a lost refresh, and the
provider has already rotated the value that was lost.

No "discarding local changes" warning appeared in either run, so geesefs's documented conflict
path was not what caused the loss here. Plain last-writer-wins was enough.

**Cell 6 confirms locks do not cross mounts.** Process one took an exclusive `flock` on mount A.
Process two took an exclusive `flock` on the same object through mount B, at the same time, and
succeeded. A lock file on the mount gives no mutual exclusion between two sandboxes.

**Cell 7 gives the alternative.** SeaweedFS 4.37 answers conditional PUT correctly on this stack:
create with `If-None-Match: *` returns 200, a second create returns 412, `If-Match` with the
current ETag returns 200, and `If-Match` with a stale ETag returns 412. An unconditional PUT still
overwrites, which confirms the 412 came from the condition and not from a permission.

**Cell 8 reproduces issue #5692 first hand.** A symlink written on mount A shows as a symlink on
that mount, because that mount holds the metadata in its own cache. On a mount created afterwards
the same entry is a plain zero-byte file, reading it returns an empty string, and the object in
the store is zero bytes with `content-length: 0`. Any new sandbox reads an empty credential file.

### 5.3 Leftovers

The scripts unmount everything they created and delete the scratch directory in the container.
The objects stay in the bucket under `agenta-store/research/storage-mounts/<run id>` so the runs
can be re-checked. Delete them when the design is settled. They are outside the `mounts/` prefix,
so no session or agent mount can see them.

## 6. Recommendation

Do not host the shared `auth.json` as a POSIX file on a geesefs mount.

Use the object store, but talk to it directly, and make every write conditional. Sign a new mount
named `auth-home` for the credential prefix, which needs no API change, and have the runner do
`GET` before the run and `If-Match` `PUT` after it. Treat a 412 as "someone else refreshed", re-read,
and use the newer token. That satisfies the requirement that one subscription serves many parallel
sessions, without a lock and without a lease.

If the product later needs a record of who refreshed and when, or needs to reject a stale refresh
rather than only detect it, move the blob to a Postgres row through the API and keep the same
compare-and-swap shape. The object-store version does not have to be thrown away to get there.
