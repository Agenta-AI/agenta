# opencode on E2B — tasks

## T1: TypeScript runner — E2B provider

- [x] `provider.ts`: `import { e2b } from "sandbox-agent/e2b"`
- [x] `provider.ts`: `DEFAULT_E2B_TIMEOUT_MS`, `e2bTimeoutMs()`, `buildE2bCreate()`
- [x] `provider.ts`: `buildSandboxProvider` E2B branch
- [x] `run-plan.ts`: `E2B_NETWORK_UNSUPPORTED_MESSAGE`
- [x] `run-plan.ts`: `RunPlan.isE2b`, `BuildRunPlanDeps.createE2bCwd`, `defaultE2bCwd()`
- [x] `run-plan.ts`: E2B network gate + cwd selection + `plan.isE2b`
- [x] `package.json`: `@e2b/code-interpreter ^1.0.0`

## T2: Python API — E2bConfig

- [x] `api/oss/src/utils/env.py`: `E2bConfig` class + `EnvironSettings.e2b`

## T3: Sandbox image

- [x] `services/agent/sandbox-images/e2b/e2b.Dockerfile`: Node 22, sandbox-agent, pi-acp
- [x] `services/agent/sandbox-images/e2b/README.md`: note Pi + opencode (auto-installed)

## T4: Unit tests

- [x] `sandbox-agent-provider.test.ts`: `buildE2bCreate`, `e2bTimeoutMs`, `DEFAULT_E2B_TIMEOUT_MS`
- [x] `sandbox-agent-run-plan.test.ts`: opencode-on-E2B normalizes; isE2b=true; restricted network refused
- [x] `sandbox-agent-run-plan.test.ts`: opencode-on-E2B with ANTHROPIC_API_KEY carries key via secrets

## T5: Integration test (deferred — requires live E2B account)

- [ ] opencode-on-E2B returns `ok:true` output + trace (needs `E2B_API_KEY` + `ANTHROPIC_API_KEY`)
- [ ] sandbox is torn down after run (verify no leaked sandboxes)

## Decisions already made

- No Zen, no auth file: opencode uses plain provider key only.
- No cookie fetch: `createAcpFetch()` like local (cookie is Daytona-only).
- Arch override not needed on E2B (real x64 hardware, daemon fetches correct binary).
- E2B network policy: refused (not silently accepted) — no egress control API.
- Template default: `agenta-sandbox-agent` (shared with Pi template, opencode auto-installs).
