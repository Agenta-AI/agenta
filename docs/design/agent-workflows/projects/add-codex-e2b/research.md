# Research: Codex on E2B

## E2B sandbox-agent provider

The `sandbox-agent/e2b` provider (from the `chore-add-sandbox-e2b` sibling branch) wraps
the E2B SDK's sandbox lifecycle behind the sandbox-agent provider interface. Key options:

- `template` — E2B sandbox template ID (default `agenta-sandbox-agent`; override with
  `E2B_TEMPLATE`).
- `create.envs` — environment variables injected into the sandbox at creation time.
- `timeoutMs` — sandbox wall-clock timeout; the sandbox is paused (and billing stops) after
  this interval of inactivity. Must be > 0 so a process-killed runner never leaks a
  running sandbox indefinitely. Default 30 min; override with `E2B_TIMEOUT_MS`.
- `autoPause` — when `true`, E2B pauses the sandbox (rather than terminating it) on
  timeout; resumed by the next request. Set `true` to avoid losing work on idle.

Auth: the provider reads `E2B_API_KEY` from the environment directly; no cookie is needed.
The ACP fetch for E2B uses plain `createAcpFetch` (not `createCookieFetch`, which is
Daytona-specific). 

Baked template `agenta-sandbox-agent` contains the sandbox-agent daemon and (for Pi) the
Pi binary. The codex binary is auto-installed by the daemon on first use if the template
does not bake it, or can be baked into a custom template (`E2B_TEMPLATE`).

Node >= 22.19 is required by the `sandbox-agent/e2b` peer; the default sidecar image pins
Node 24, so this is satisfied.

Restricted-network (`sandbox_permission.network`) is refused on E2B because the
`sandbox-agent/e2b` provider exposes no egress-control API (unlike Daytona's
`networkBlockAll`/`networkAllowList`). The refusal is unconditional (not gated on
`enforcement`) — there is no path where the boundary is applied on E2B.

## Codex credential requirements

Codex reads `~/.codex/auth.json` as a FILE on startup; environment variables alone are
insufficient. The file format is `{"OPENAI_API_KEY": "<key>"}`. The daemon also needs
`OPENAI_API_KEY` in its environment for the ACP session to launch with the correct key.

For local runs, `writeCodexAuthFile` (in `pi-assets.ts`) writes the file to the host's
`~/.codex/auth.json` before the daemon starts.

For E2B runs, the file must be uploaded into the sandbox via the sandbox FS API
(`sandbox.mkdirFs` + `sandbox.writeFsFile`) after the sandbox starts but before the
session is created. The daemon's `OPENAI_API_KEY` is injected at sandbox creation time via
`create.envs`. Mode `agent-full-access` is selected by the harness adapter in the Python
SDK (`CodexAgentTemplate`).

## Credential modes

- `credentialMode === "env"` (managed key): `OPENAI_API_KEY` is in `plan.secrets`; the
  daemon env is cleared then the key applied. The auth.json upload uses the resolved key.
- `credentialMode === "runtime_provided"`: the codex CLI uses its own login; no key upload.
- `credentialMode === "none"` / absent: back-compat heuristic — upload only if no key
  present.

## Overlap with chore-add-sandbox-e2b

The following files in this branch duplicate work from the `chore-add-sandbox-e2b` sibling
branch and will need to be reconciled when the branches merge:

| File | Overlap |
|------|---------|
| `services/agent/src/engines/sandbox_agent/e2b.ts` | Both branches add this file. The sibling branch's version covers Pi only; this version adds `uploadCodexAuthToE2bSandbox`. Merge: combine into one file. |
| `services/agent/src/engines/sandbox_agent/provider.ts` | Both add `buildE2bCreate`, `e2bTimeoutMs`, `DEFAULT_E2B_TIMEOUT_MS`, and the `e2b` branch in `buildSandboxProvider`. The implementations are identical. |
| `services/agent/src/engines/sandbox_agent/run-plan.ts` | Both add `isE2b`, `E2B_NETWORK_UNSUPPORTED_MESSAGE`, `defaultE2bCwd`, `createE2bCwd` dep. Identical. |
| `services/agent/src/engines/sandbox_agent/usage.ts` | Both rename `isDaytona` → `isRemote` in `readRunUsage` and add `isE2b?` to `resolveRunUsage`. Identical. |
| `services/agent/src/engines/sandbox_agent.ts` | Both add `isE2b` branches for workspace cleanup, MCP, piExtEnv, emitSpans, tool-relay, swallowed-error. This branch additionally gates the local codex auth write on `!isE2b` and adds the E2B codex auth upload. |
| `api/oss/src/utils/env.py` | Both add `E2bConfig`. Identical. |
| `tests/unit/sandbox-agent-e2b-run-plan.test.ts` | Both add this test file. This branch additionally covers codex-on-E2B scenarios. |
| `tests/unit/sandbox-agent-e2b-provider.test.ts` | Both add this test file. Identical. |
