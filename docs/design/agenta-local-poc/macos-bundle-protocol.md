# macOS bundle build protocol

Date: 2026-08-25
Host: Apple Silicon Mac (arm64), macOS, branch `feat/agenta-local-poc` at `2e928970e5`.

This records the first end-to-end darwin-arm64 bundle build: the exact toolchain, every
defect the run surfaced, the minimal fix for each, and how each fix was verified. It is
the recipe + checklist for future macOS (and by symmetry darwin-x64) bundle releases.

## Toolchain notes (build machine)

- `corepack` from Homebrew was ancient and failed pnpm signature verification
  (`Cannot find matching keyid`). Fix: `npm install --global corepack@latest --force`.
  Project `packageManager` fields then select pnpm 11.1.2 (web) / 10.30.0 (runner).
- Homebrew `uv` 0.6.5 predates `uv export --no-annotate` used by `build_bundle.py`.
  Fix: `brew upgrade uv` (0.12.5). The bundle builder requires a current uv.

## Build sequence that works

```bash
git fetch origin && git checkout feat/agenta-local-poc && git pull --ff-only
uname -m                       # arm64 -> darwin-arm64

cd web
corepack pnpm install --frozen-lockfile && corepack pnpm build-local

cd ../services/runner
corepack pnpm install --frozen-lockfile
corepack pnpm run build:extension
corepack pnpm exec tsx scripts/patch-pi-validation-message.ts

cd ../local
uv sync --locked
uv run --no-sync pytest tests/pytest -q          # gate: must be green

uv run --no-sync python packaging/runner/build_runner.py \
    --output dist/agenta-local-runner-darwin-arm64
uv run --no-sync python packaging/linux/build_bundle.py --platform darwin-arm64
uv run --no-sync python packaging/linux/verify_bundle.py dist/agenta-local-darwin-arm64
```

`verify_bundle.py` on the matching host runs everything: layout/checksum/self-containment
gates, a copy to a path WITH SPACES, runtime version probes, staged import + syntax
probes, launcher smoke (startup, SIGTERM, survivor scan via pgrep).

## Defects found and fixed

### 1. SQLAlchemy async engine unusable on macOS (107 test failures)

- Symptom: `ValueError: the greenlet library is required ... No module named 'greenlet'`
  at service startup; every integration/acceptance DB test errored.
- Root cause: SQLAlchemy's greenlet dependency marker enumerates
  `platform_machine == 'aarch64'` but macOS reports `arm64`, so uv resolved the lockfile
  without greenlet on this host. The service requires async SQLAlchemy, so greenlet is a
  direct runtime dependency, not a transitive one.
- Fix: declare `greenlet>=3,<4` in `services/local/pyproject.toml`; `uv lock`.
- Verify: full suite green (229 passed / 5 env-skips).

### 2. Launcher-path unit test assumed Linux XDG fallback

- Symptom: `test_relative_xdg_values_are_ignored_instead_of_becoming_cwd_relative`
  expected `~/.local/share` on darwin.
- Fix: pin `sys.platform` to `linux` in the test; darwin fallback already has its own
  dedicated test (`test_darwin_defaults_data_to_application_support_but_xdg_override_wins`).

### 3. `build_runner.py` could not produce darwin stages (BUILDING.md known gap)

- Symptom: Node tarball name/hash and the sandbox-agent daemon path were hardcoded to
  linux-x64; the bundle builder refuses to run without a platform-matched runner stage.
- Fix (minimal parameterization):
  - `NODE_PINS` table (linux-x64 keeps its verified digest; darwin pins carry
    `sha256=None` and record the computed digest with
    `hash_verified_against_upstream: false`).
  - `--platform` flag defaulting to host detection; tarball mode `r:xz` vs `r:gz`.
  - `find_daemon_binary(runner_root, platform_id)` resolves `cli-<platform>`.
  - Manifest `node.arch` records the platform id (what `build_bundle.py` validates).
- Verify: darwin-arm64 stage builds, self-containment + checksum gates pass.

### 4. pnpm `.bin` shims broke the stage self-containment scan on macOS

- Symptom: 54 `self-containment problem: ... .bin/... contains '<repo path>'` failures.
- Root cause: pnpm's cmd-shim writes absolute `NODE_PATH` entries on macOS (Linux shims
  are relative). The staged runtime never executes through `.bin` (tsx runs via
  `dist/cli.mjs`; the daemon via its real package path).
- Fix: `strip_bin_shims()` removes `node_modules/.bin` directories from the staged copy
  only (source checkout untouched).

### 5. Newer uv writes `direct_url.json` into installed wheels

- Symptom: `error: payload contains checkout reference: .../direct_url.json` (the file
  records the file:// wheel-build path; the payload gate forbids checkout references).
- Fix: `install_python_payload()` deletes `*.dist-info/direct_url.json` from the staged
  site-packages after install (pure provenance metadata, not needed at runtime).

### 6. Verifier JSON probe choked on SDK import-time stdout logging

- Symptom: `json.loads(result.stdout)` -> `Extra data` because importing `agenta` logs
  two INFO lines ("egress is in restricted mode...") to **stdout** before the probe's
  JSON line.
- Fix: `verify_bundle.py` extracts the last `{`-prefixed line before parsing.
  (Follow-up worth filing upstream: the SDK should log to stderr.)

### 7. One-time macOS code-signature verification exceeded the 10s runtime probe

- Symptom: first launcher run failed with `Node runtime: runtime probe failed: ...
  timed out after 10 seconds`; every later run was instant.
- Cause: Gatekeeper verifies the freshly-downloaded unsigned Node binary on first exec
  (~1.5-15s), then caches the verdict.
- Mitigation: none needed in code; document it. If it recurs on clean machines, raise
  `_probe_runtime`'s timeout for first-run probes or pre-touch the binaries at build
  time (`xattr -c`, spc verification warm-up).

### 8. Service crashed when the launcher set STATIC_DIR/MIGRATIONS_DIR (blocker)

- Symptom: `TypeError: _env() missing 1 required positional argument: 'default'` in
  `config.py`; service never became ready -> "local service failed to become ready".
- Root cause: `Path(_env("STATIC_DIR"))` (one arg) is evaluated exactly when the env var
  IS set — i.e. always, when launched from the bundle. Source-checkout tests never set
  it, so the suite was green.
- Fix: `Path(_env("STATIC_DIR", ""))` (same for `MIGRATIONS_DIR`).
- Regression tests: `tests/pytest/unit/launcher/test_config.py` (set + unset cases).

### 9. Renderer fed CSS `var()` strings to antd theme tokens (black blocks)

- Symptom: Inputs, Selects, TextArea, search box rendered as solid black rectangles in
  the bundled UI (light theme); page shell was fine.
- Root cause: `ThemeProvider.tsx` passed `colorPrimary: "var(--ag-colorPrimary)"` etc.
  as antd `token` values. antd derives `colorBgContainer`/`colorFill` from
  `colorBgBase`/`colorTextBase` with JS color math; a `var()` string fails to parse and
  derived surfaces collapse to black. `web/oss` never does this — it passes real hex
  values from the generated overrides.
- Fix: `LIGHT_TOKENS`/`DARK_TOKENS` hex constants mirroring the generated palette
  (`theme-variables.css`, `DARK_TOKEN_OVERRIDES`); dark mode only pins
  `colorPrimary`/`colorLink` and lets `darkAlgorithm` derive surfaces (oss pattern).
- Verify: headless-Chrome screenshots of all four routes in light + dark; no black
  regions, banner gone, both themes readable.

### 10. "Local service unavailable" banner shown while the service was healthy

- Symptom: banner rendered on every page even though all API calls succeeded (agent and
  session data visible).
- Root cause: wire drift. `/api/runtime` passes the runner `/health` payload through
  (`{"status": "ok", ...}`) but its own error path emits `{"ok": false}`; the renderer
  schema demanded `runner.ok` always exist -> Zod parse failure on the happy path.
- Fix: normalize in `runtimeSchema` (accept `ok` or `status`, transform to `ok`);
  `RuntimeBanner` unchanged.
- Regression tests: three `runtimeSchema` cases in `web/agenta-local/tests/unit/client.test.ts`.

## Hash honesty gate (darwin-arm64, done)

Computed digests recorded in the bundle manifest were compared to upstream:

| Runtime | Digest | Upstream source | Match |
| --- | --- | --- | --- |
| node v24.19.0 darwin-arm64.tar.gz | `8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d` | nodejs.org/dist/v24.19.0/SHASUMS256.txt | yes |
| cpython 3.13.15+20260814 aarch64-apple-darwin install_only_stripped | `6d472fc49a4d95e58214a992c4c92aa73fe2a935837a01a9a36bab0bec6d72f3` | python-build-standalone 20260814 SHA256SUMS | yes |

After matching, `hash_verified_against_upstream` was flipped to `true` for both entries
in `manifest.json` and the manifest's `SHA256SUMS` line regenerated; `verify_bundle.py`
re-run green afterwards.

## Product-journey state at pause

Verified working from the bundle launcher: UI opens (light + dark), provider key stored
(0600, write-only), agent create/commit revision, session create, runtime banner logic,
graceful shutdown with no surviving processes (verifier smoke + manual pgrep).

Remaining unverified: one real streamed turn and mid-turn Stop against the stored OpenAI
key from the bundle (the API surface works; replay-backed tests cover the stream
contract). Run: launch `bin/agenta-local`, create session, send a message, Stop, Quit,
then `pgrep -fl agenta-local-darwin-arm64` (expect no output).

## Artifact

- `services/local/dist/agenta-local-darwin-arm64` (968.0 MiB, read-only install).
- Runner stage: `services/local/dist/agenta-local-runner-darwin-arm64`.
- Both are reproducible from the sequence above; neither is committed.
