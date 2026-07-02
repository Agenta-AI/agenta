# Specs: Codex on E2B

## Goals

Run the codex harness inside an E2B sandbox, so codex benefits from E2B's isolated remote
execution environment and billing-based lifecycle management.

## Non-goals

- Daytona support for codex (separate concern).
- Custom E2B template build pipeline (documented below; operator concern).
- Restricted-network enforcement on E2B (not available; refused loudly).

## Axes

Two orthogonal axes compose independently:

- **Harness axis**: `codex` — the OpenAI codex CLI driven over ACP.
- **Sandbox axis**: `e2b` — an E2B cloud sandbox managed by the `sandbox-agent/e2b`
  provider.

## E2B provider options

```
template       = E2B_TEMPLATE ?? "agenta-sandbox-agent"
timeoutMs      = E2B_TIMEOUT_MS ?? 1_800_000 (30 min); must be >= 1
autoPause      = true
create.envs    = { ...piExtEnv, OPENAI_API_KEY, CODEX_API_KEY? }
```

The `timeoutMs` + `autoPause` pair is the leak backstop: a process-killed runner skips the
per-run `finally`; E2B pauses the sandbox after `timeoutMs` of inactivity, which stops
billing. The sandbox is never left running indefinitely.

## Codex credential provisioning

1. `OPENAI_API_KEY` injected into the sandbox at create time via `create.envs`.
2. `~/.codex/auth.json` written into the sandbox filesystem after start and before session
   create, via `uploadCodexAuthToE2bSandbox`. Content: `{"OPENAI_API_KEY": "<key>"}`.
3. `credentialMode === "env"`: use the resolved key. `credentialMode === "runtime_provided"`:
   skip the upload (codex uses its own login, which is NOT uploaded to E2B — no
   `shouldUploadOwnLogin` analogue for codex on E2B).

## Network restriction

A `sandbox_permission.network` (any mode other than `"on"`) is refused on E2B regardless
of `enforcement`, with `E2B_NETWORK_UNSUPPORTED_MESSAGE`. E2B exposes no egress-control
API.

## Cwd

`/root/work/agenta-<6-random-hex>` — root-owned because the E2B template daemon runs as
root. Override `E2B_TEMPLATE` to change the user.

## Fetch

Plain `createAcpFetch` (no cookie). E2B's sandbox-agent endpoint does not use the Daytona
per-sandbox auth cookie scheme.

## Teardown / leak parity

- Normal/error/client-disconnect: `finally` calls `sandbox.destroySandbox()` +
  `sandbox.dispose()`. Same as Daytona.
- Process KILL: `timeoutMs` backstop pauses the sandbox, stopping billing.
- `inFlightSandboxes` set: shutdown signal handler best-effort deletes all live sandboxes.
- No local cwd dir to clean up (workspace cleanup is skipped for E2B, same as Daytona).

## Template requirements

The baked template must contain:
- The `sandbox-agent` daemon binary.
- The codex CLI binary (or the daemon auto-installs it on first use; confirm with the
  template maintainer — the Pi template bakes it, the default codex template may not).

If the codex binary is not baked, set `E2B_TEMPLATE` to a custom template that includes it.
