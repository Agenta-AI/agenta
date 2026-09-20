# WP13 — tasks

Read [`specs-wp13.md`](specs-wp13.md) first. Branch from WP12's merge (IM4).

## Phase 0 — the harness matrix, before any code

- [ ] For Claude Code, OpenCode and Codex, at the release actually in use: does it send a
      custom header on model requests, and does pointing its base URL at us preserve that
      behaviour? Record per harness and per version (OD14).
- [ ] A harness that fails is a finding. Do not work around it here — the fallback is the
      local-agent shape and it is a separate package.
- [ ] Commit the matrix into `open-designs.md` OD14.

## Phase 1 — the wire's consumer side

- [ ] Read the gateway-credentials field's declaration in the seed. Re-validate it in the
      runner rather than trusting it, following the existing pattern.
- [ ] A `ModelConnection` with `credentialMode: "none"` and the gateway field is legal and is
      the normal case; one with both a provider secret and the gateway field is not.
- [ ] Unit: validation accepts the first and rejects the second.

## Phase 2 — the harness writers

- [ ] `pi-model-config.ts`, `codex-assets.ts` and the equivalent per harness: write the
      gateway header into that harness's own configuration mechanism.
- [ ] Base URL points at the gateway route from `endpoint.baseUrl`. Do not append a protocol
      path — the harness owns that.
- [ ] Unit per harness: a gateway connection produces a configuration carrying the header and
      no provider secret.

## Phase 3 — what must shrink

- [ ] `daytona-secret-plan.ts`: remove entries that exist only for provider keys the gateway
      now holds. Every entry that stays gets a reason in the file.
- [ ] The redaction set shrinks with it. If it does not, the secrets did not leave — stop and
      find out why.
- [ ] Unit: the secret plan for a gateway connection is empty, or each entry is justified.

## Tests

- [ ] Acceptance: a run completes with no provider secret in the sandbox environment, on the
      local sandbox and on Daytona. Assert by inspecting the sandbox, not the resolver.
- [ ] Acceptance: the run's model calls appear as audit events (WP4) with the right
      principal.
- [ ] Commit: "gateways(runner): carry a gateway route instead of provider secrets".

## Definition of done

- No provider secret reaches a sandbox, proven from inside the sandbox.
- Each harness sends our credentials header, verified on the release in use.
- The secret plan and the redaction set are both smaller.
