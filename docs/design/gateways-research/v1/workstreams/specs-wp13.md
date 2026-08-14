# WP13 — Runner and harnesses

**Owns:** `services/runner/src/`, the harness configuration writers, and the wire's consumer
side. **Depends on:** WP12. **Blocks:** Checkpoint B.

The runner carries a gateway route and our credentials instead of provider secrets. Two
properties make it worth doing, and both are checkable: the per-consumer secret arrays
collapse, and the redaction set shrinks with them.

---

## What arrives from WP12

`ModelConnection` (`services/runner/src/protocol.ts:566`) with:

- `endpoint.baseUrl` — the gateway route
- `credentialMode: "none"` — no provider secret to inject
- `credentials: []` — empty
- the gateway-credentials field from the seed (W1), carrying the header name and value

The wire's field-by-field meaning is documented above the interface and is the authority; the
runner re-validates rather than trusting, as it does today, and does not invent fields.

## The harness configuration problem

A gateway credential is only useful if the harness sends it. Each harness exposes a different
mechanism, and **each must be verified against the release actually in use** (OD14) before
this package depends on it:

- Claude Code — a custom-header mechanism plus a base-URL override.
- OpenCode — provider-specific request headers plus a base URL.
- Codex — additional fixed or environment-derived HTTP headers.

`services/runner/src/engines/sandbox_agent/` holds the writers (`pi-model-config.ts`,
`codex-assets.ts`, `environment.ts`). This package writes the header into each harness's own
configuration; it does not add a proxy in front of the harness.

**If a harness cannot carry the header on its current release, that is a finding, not a
workaround.** The fallback is the local-agent shape (OD14), which is a separate package and
is only worth building for a harness that is both wanted and incapable.

## What must shrink

- **`daytona-secret-plan.ts`'s allowlist.** `local_use` exists for secrets a provider SDK
  signs with inside the sandbox, and the list is deliberately short. With the gateway holding
  provider secrets, entries should leave it. Any entry that stays needs a reason.
- **The redaction set.** Fewer secrets in the sandbox means fewer strings to redact. If it
  does not shrink, the secrets did not actually leave.

## Contracts

- **No provider secret reaches the sandbox.** Asserted by inspecting the sandbox environment
  after a run, on both the local and the Daytona sandbox — not by inspecting our resolver,
  which is WP12's own test and proves nothing about delivery.
- **`credentialMode` keeps its three values.** `runtime_provided` stays meaningful: it is a
  harness authenticating with its own vendor login, which is D32's pass-through and is not
  this package's to remove.
- **The wire is shared with WP15.** The gateway-credentials field belongs to the seed. If
  this package finds it wrong, it reports rather than editing — WP15 inherits the same shape.

## Tests

- Unit: a `ModelConnection` with `credentialMode: "none"` and the gateway field produces a
  harness configuration carrying the header, per harness.
- Unit: no provider secret appears in any harness configuration produced from a gateway
  connection.
- Unit: the Daytona secret plan produced from a gateway connection is empty or justified
  entry by entry.
- Acceptance: a run completes against the gateway with no provider secret in the sandbox
  environment, local and Daytona.

## Out of scope

- The MCP server configs (WP15), even though they are on the same wire.
- The local-agent fallback, which OD14 decides the need for.
