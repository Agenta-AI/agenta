# Building Agenta Local bundles

`packaging/linux/` (historical name — it now builds every supported target) produces a
relocatable directory bundle for:

| target platform | arch | pinned CPython triple | min OS/libc |
| --- | --- | --- | --- |
| `linux-x64` | x86_64 | `x86_64-unknown-linux-gnu` | glibc >= 2.28 |
| `darwin-arm64` | aarch64 | `aarch64-apple-darwin` | macOS >= 11 |
| `darwin-x64` | x86_64 | `x86_64-apple-darwin` | macOS >= 11 |

Runtimes are pinned: python-build-standalone cpython-3.13.15+20260814
(`install_only_stripped`) and Node v24.19.0 per the pins table at the top of
`build_bundle.py`. macOS 11 is recorded conservatively: python-build-standalone needs
10.15+, Node 24 needs 11+.

## Rules

- **Build on the target OS.** The runner `node_modules` carries OS-specific native
  packages (`@sandbox-agent/cli-<platform>`, `@esbuild/<os>-<arch>`); they cannot be
  cross-installed reliably. The builder refuses to run for a platform that does not match
  the host and fails fast if a runner stage was installed for another platform.
- **Consume a verified S1.3 runner stage.** Build it first
  (`dist/agenta-local-runner-<platform>`) or pass `--runner-stage`; when the stage's
  platform matches the target it is consumed as-is.
- Select the target with `--platform <id>` (default: detect the host) or
  `AGENTA_LOCAL_BUNDLE_PLATFORM`.

## Common prerequisites

- `uv` (Python payload build/install)
- corepack pnpm (runner install/build)
- network access for the pinned runtime downloads (or pass `--python-archive` with a local
  copy; its SHA256 must still match the pin)

## linux-x64 (from this repo, on Linux)

```bash
cd services/local
uv run --no-sync python packaging/runner/build_runner.py \
    --output dist/agenta-local-runner-linux-x64
uv run --no-sync python packaging/linux/build_bundle.py --platform linux-x64
uv run --no-sync python packaging/linux/verify_bundle.py dist/agenta-local-linux-x64
```

The default `--platform` on a Linux x86-64 host already resolves to `linux-x64`.

## darwin-arm64 / darwin-x64 (on the Mac)

A darwin bundle must be built on that Mac. Clone the repo there, then from
`services/runner`:

```bash
corepack pnpm install --frozen-lockfile
pnpm run build:extension
corepack pnpm exec tsx scripts/patch-pi-validation-message.ts
```

Then produce the S1.3 runner stage for the Mac's architecture and assemble the bundle from
`services/local`:

```bash
uv run --no-sync python packaging/linux/build_bundle.py --platform darwin-arm64   # or darwin-x64
uv run --no-sync python packaging/linux/verify_bundle.py dist/agenta-local-darwin-arm64
```

Known gap (owned by the launcher/packaging work packet): `packaging/runner/build_runner.py`
currently pins the linux-x64 Node tarball name/hash and hardcodes the
`@sandbox-agent/cli-linux-x64` daemon path, so until it gains darwin support the S1.3 stage
for a Mac cannot be produced by that script alone. Do not work around it by copying a
Linux stage — the builder rejects it.

## Verifying darwin hashes

Only the linux-x64 digests embedded in the pins table were verifiable from this repo's
Linux build host. For darwin bundles, the build computes SHA256 values and records them in
the bundle manifest with `"hash_verified_against_upstream": false`. After building on the
Mac, confirm both against upstream and keep the evidence with the release:

```bash
# Node (official SHASUMS256.txt):
curl -fsSL https://nodejs.org/dist/v24.19.0/SHASUMS256.txt | grep 'darwin-arm64.tar.gz$'
shasum -a 256 "$(find . -name 'node-v24.19.0-darwin-arm64.tar.gz')"

# CPython (consolidated SHA256SUMS asset of the release):
curl -fsSL \
  https://github.com/astral-sh/python-build-standalone/releases/download/20260814/SHA256SUMS \
  | grep 'aarch64-apple-darwin-install_only_stripped'
shasum -a 256 "$(find . -name 'cpython-3.13.15+20260814-aarch64-apple-darwin-install_only_stripped.tar.gz')"
```

Compare each computed digest against the bundle's `manifest.json`
(`python.sha256`) and the embedded runner stage manifest (`runner_stage.manifest.node.sha256`).

## What verification can and cannot check cross-host

`verify_bundle.py` always runs the structural gates (layout, SHA256SUMS coverage,
self-containment). Gates that execute bundle binaries require the host to match the
bundle's `target_platform`; otherwise they are skipped with an explicit NOTE. This means a
Mac-built darwin bundle checked from Linux has NOT been proven to run.

Untested-from-Linux for darwin artifacts (run these on the Mac before shipping):

- staged `runtime/python/bin/python3` and `runtime/node/bin/node` execute and report the
  pinned versions
- staged Python import probes and payload syntax compile pass
- launcher smoke: startup, readiness, SIGTERM shutdown, no surviving child processes
  (survivor scan uses `/proc` on Linux and falls back to best-effort `pgrep` elsewhere)
- `--strace` network evidence (strace is Linux-only; macOS has no equivalent wired up)

## Test hooks

- `AGENTA_LOCAL_BUNDLE_DIR` — acceptance test verifies this prebuilt artifact end-to-end.
- `AGENTA_LOCAL_BUNDLE_PLATFORM` — default/asserted platform for builds and the acceptance
  real-bundle check.
