# opencode on E2B — spec

## Scope

Add the E2B sandbox provider to this branch (opencode-local already done) so the
`harness=opencode, sandbox=e2b` combination works. E2B-specific wiring is duplicated from
the sibling `chore/add-sandbox-e2b` branch; it will be deduped after both land.

## Provider wiring (`services/agent/src/engines/sandbox_agent/provider.ts`)

```
import { e2b } from "sandbox-agent/e2b";

DEFAULT_E2B_TIMEOUT_MS = 30 * 60 * 1000  // 30 min backstop
e2bTimeoutMs(raw?)      // parse E2B_TIMEOUT_MS; clamp >= 1 ms
buildE2bCreate(piExtEnv, secrets) -> { envs, timeoutMs, autoPause: true }

buildSandboxProvider(...):
  if sandboxId === "e2b":
    template = E2B_TEMPLATE ?? "agenta-sandbox-agent"
    create = buildE2bCreate(piExtEnv, secrets)
    return e2b({ template, create: { envs }, timeoutMs, autoPause })
```

## Run-plan wiring (`services/agent/src/engines/sandbox_agent/run-plan.ts`)

```
E2B_NETWORK_UNSUPPORTED_MESSAGE   // new named constant (parallel to LOCAL_)
RunPlan.isE2b: boolean            // new field
BuildRunPlanDeps.createE2bCwd?    // injectable for tests
defaultE2bCwd()                   // /root/work/agenta-<hex>

buildRunPlan():
  isE2b = sandboxId === "e2b"
  if networkRestricted && isE2b -> error E2B_NETWORK_UNSUPPORTED_MESSAGE
  if networkRestricted && !isDaytona && !isE2b -> error LOCAL_NETWORK_UNSUPPORTED_MESSAGE
  cwd = isDaytona ? createDaytonaCwd() : isE2b ? createE2bCwd() : createLocalCwd()
  plan.isE2b = isE2b
```

## Credential provisioning

opencode reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from env. Both are present in
`plan.secrets` (from the wire request) and injected via `buildE2bCreate(...).envs`. No
auth file, no Zen key, no cookie fetch. `planMode: false` is already set in
`capabilities.ts` and does not change for E2B.

## `api/oss/src/utils/env.py` — E2bConfig

```python
class E2bConfig(BaseModel):
    api_key: str | None = os.getenv("E2B_API_KEY")
    template: str | None = os.getenv("E2B_TEMPLATE")
    model_config = ConfigDict(extra="ignore")

# EnvironSettings:
    e2b: E2bConfig = E2bConfig()
```

## `services/agent/package.json`

Add `"@e2b/code-interpreter": "^1.0.0"` to `dependencies`.

## `services/agent/sandbox-images/e2b/`

Reuse the `e2b.Dockerfile` from the Pi-only sibling template. The opencode binary is
auto-installed at runtime by the daemon (`install-agent opencode`), so no additional
bake step is needed. The README notes both Pi and opencode support.

## Sandbox teardown / leak parity

The engine `finally` calls `sandbox.destroySandbox()` on every exit path. The
`timeoutMs` backstop self-reaps a leaked sandbox when a process KILL skips the `finally`.
`autoPause: true` pauses (not deletes) after idle, so billing stops. No sandbox outlives
its run.

## Network policy enforcement

E2B exposes no egress-control API. Any restricted `network` policy on E2B is refused
up-front via `E2B_NETWORK_UNSUPPORTED_MESSAGE` — never silently accepted.

## Arch gotcha

E2B runs on real x86-64 cloud. The daemon's `install-agent opencode` fetches the linux-x64
binary, which is correct on E2B. No arch override needed. The SIGTRAP gotcha only applies
to local arm64 dev machines.
