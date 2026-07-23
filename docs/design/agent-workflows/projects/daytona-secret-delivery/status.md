# Status

## Phase

Design-only. The recommended architecture is defined, but implementation is blocked on the
questions in `open-questions.md` and the Phase 0 Daytona security spike.

## Recommendation

Use one consumer-owned resolved credential contract for local and Daytona. On Daytona, materialize
opaque HTTP credentials as per-sandbox organization Secrets with exact host policies. On local,
materialize the same contract with current plaintext behavior and make the weaker boundary clear.

Support direct model keys, Azure and custom-provider keys, and HTTP MCP authorization when the
consumer supplies an effective HTTPS route. Treat Bedrock bearer tokens as a live-spike candidate.
Do not group them with SigV4 credentials. Keep SigV4 and Vertex service-account flows as an
explicit non-isolated mode or route them through a gateway.

## Current technical constraints

- The runner still sends model credentials as plaintext Daytona `envVars`.
- The MCP resolver merges secret values into `env`, and the runner turns HTTP MCP `env` entries
  into plaintext headers. The new contract must keep credential headers distinct.
- The active warm-Daytona worktree has a runner-owned lifecycle wrapper with native pause,
  reconnect, and delete, and it removes Agenta auto-archive configuration. Secret lifecycle should
  build on that boundary rather than add an upstream patch.
- The runner still uses `@daytonaio/sdk` 0.187.0. Daytona Secrets require at least 0.192.0; the
  current package observed on 2026-07-11 is `@daytona/sdk` 0.196.0.
- Daytona Secrets remain organization-scoped and require organization-wide `manage:secrets`.
- Agenta's named-secret SDK client and current backend resolution surface still need alignment for
  fail-closed custom-secret resolution.

## Implementation gate

Before implementation starts, decide the production organization boundary, unsupported-cloud
policy, endpoint ownership, durable lease store, public isolation requirement, Vertex API-key
scope, and exact Daytona version. Then run Phase 0. No production code should assume direct HTTP
MCP placeholder substitution until the live test proves it.
