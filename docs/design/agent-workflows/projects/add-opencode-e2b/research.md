# opencode on E2B — investigation

## What this worktree adds

opencode harness on the E2B sandbox. opencode-local (`add-harness-opencode`) is
already done on this branch; this layer adds the E2B sandbox axis.

## Sandbox-agent/e2b provider (sourced from sibling `chore/add-sandbox-e2b`)

The `sandbox-agent@0.4.2` package exports `sandbox-agent/e2b`. It requires
`@e2b/code-interpreter >=1.0.0` as an optional peer dep — add it as a direct dep
so the subpath import resolves. The provider options are:

| Option | Purpose |
|---|---|
| `template` | E2B template ID (env `E2B_TEMPLATE`, default `agenta-sandbox-agent`) |
| `create.envs` | In-sandbox env vars (piExtEnv + secrets merged) |
| `timeoutMs` | Sandbox lifetime backstop; self-reaps a leaked sandbox on process KILL |
| `autoPause` | Pause (not delete) after idle; reduces billing; set `true` |

`E2B_API_KEY` is picked up by the `@e2b/code-interpreter` SDK automatically from env;
the runner does not need to pass it. `SANDBOX_AGENT_PROVIDER=e2b` routes the run.

### Leak backstop

`timeoutMs` is the E2B equivalent of Daytona's `ephemeral + autoStopInterval`. A process
KILL skips the `finally` teardown; `timeoutMs` self-reaps the sandbox after it goes idle.
Default: 30 min (`DEFAULT_E2B_TIMEOUT_MS`). Override with `E2B_TIMEOUT_MS`.
Clamped to >= 1 ms (0 would re-disable the backstop).

### Network policy on E2B

The `sandbox-agent/e2b` wrapper exposes no egress-control API. A restricted
`network` policy on E2B is therefore refused up-front (same rule as local), not silently
accepted. `E2B_NETWORK_UNSUPPORTED_MESSAGE` mirrors `LOCAL_NETWORK_UNSUPPORTED_MESSAGE`.

### Default cwd on E2B

The E2B base image (`e2bdev/code-interpreter`) uses `/root/work` as working dir.
`defaultE2bCwd()` returns `/root/work/agenta-<6-byte-hex>` so each run gets an isolated
subdir without conflicting across concurrent runs.

## opencode credential on E2B

opencode uses a **plain managed provider key** — `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
No Zen gateway, no auth file, no cookie fetch. The key is injected through `create.envs`
(the same secrets dict that `plan.secrets` carries from the wire request). The daemon on
the E2B template auto-installs opencode on first use (same as local); no bake is needed
for the binary itself.

### planMode: false

Unchanged from opencode-local: `capabilities.ts` static fallback already excludes opencode
from `session/set_mode`. No E2B-specific change needed here.

### Plain `createAcpFetch`

No Daytona auth cookie — use `createAcpFetch()` directly (same as local). The engine
already selects `createCookieFetch` only for `isDaytona`.

## The arch gotcha (opencode binary on E2B)

The daemon's `install-agent opencode` downloads the linux-**x64** Bun binary even on
arm64 hosts → SIGTRAP (`rosetta error … ld-linux-x86-64.so.2`). E2B runs on real x86-64
cloud hardware, so the default x64 download is **correct** — no arch override needed on
E2B. The gotcha only bites on local arm64 dev machines. Document but do not fix (not
applicable to E2B).

This "E2B is always x86-64" assumption is load-bearing: if E2B ever offers arm64
templates, the opencode arch override must be ported here too (see the daytona
sibling's `opencodeArchEnv` in `daytona.ts`).

## Node version in the E2B template

The `e2bdev/code-interpreter` base image ships Node 20. `pi-acp` requires `>=22.19`. The
template must upgrade to Node 22 before installing the pi-acp adapter. The sibling
`chore/add-sandbox-e2b` Dockerfile already handles this. For opencode the daemon
auto-installs the binary at runtime; no Node constraint applies to the opencode binary
(it is a Bun single-file binary, not a Node script). Node 22 is still required in the
template because the `sandbox-agent` daemon itself is a Node process.

## Overlap with sibling branch `chore/add-sandbox-e2b`

These files are modified in both this branch and `chore/add-sandbox-e2b`:

| File | Overlap nature |
|---|---|
| `services/agent/src/engines/sandbox_agent/provider.ts` | E2B wiring (`buildE2bCreate`, `e2bTimeoutMs`, `e2b` branch) is byte-identical |
| `services/agent/src/engines/sandbox_agent/run-plan.ts` | E2B wiring (`isE2b`, `E2B_NETWORK_UNSUPPORTED_MESSAGE`, `defaultE2bCwd`, `createE2bCwd`) is byte-identical; opencode acpAgent comment differs |
| `services/agent/package.json` | `@e2b/code-interpreter` dep added in both |
| `api/oss/src/utils/env.py` | `E2bConfig` + `EnvironSettings.e2b` added in both |
| `services/agent/sandbox-images/e2b/e2b.Dockerfile` | Sibling has Pi-only; this branch adds opencode note to README but Dockerfile is same |
| `services/agent/tests/unit/sandbox-agent-provider.test.ts` | E2B tests are identical |
| `services/agent/tests/unit/sandbox-agent-run-plan.test.ts` | E2B tests are identical; opencode tests differ (this branch only) |

Dedup strategy: when these branches merge, keep one copy of the shared E2B wiring and
deduplicate in a follow-up chore.
