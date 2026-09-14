# Track D — tasks

Execution order for `feat/metering-track-d` (stacked on
`feat/metering-track-c`). Rebase onto C's post-re-partition tip before
starting (this branch carries no code commits of its own yet, so the rebase is
a fast-forward reset).

## D0 — internal-resolve prerequisite
- [ ] Map every caller of `GET /secrets/` (three vault readers + agent path).
- [ ] Server-side / internal-only resolution path; the agent connection step
      stops reading the wholesale plaintext endpoint.
- [ ] RBAC review of `VIEW_SECRET` on the remaining surface.

## D1 — sandbox secret kinds + resolver (Daytona)
- [ ] New `SecretKind` values (sandbox providers, gateway provider key).
- [ ] Resolver candidate kind matching on backend/provider; env mapping for
      `DAYTONA_API_KEY`/`DAYTONA_API_URL`; extend `KNOWN_PROVIDER_ENV_VARS`.
- [ ] Route the SDK evaluator runner's vault→env mapping through the resolver.
- [ ] Acceptance: a vault Daytona secret provisions a sandbox in the customer
      org end-to-end.

## D2 — secret_origin stamp + zero-rating
- [ ] Stamp `secret_origin: vault | local` (+ connection id) at resolve time;
      propagate to span attributes and the session record.
- [ ] Gate ordering: origin known before the sandbox Layer-1 quota check.
- [ ] `record_usage_debits(..., secret_origin=...)`: explicit zero-rate for
      `vault`; unit tests both origins.
- [ ] Analytics keep measuring BYOS runs (wall-clock) even though debits are
      zero.

## D3 — E2B mapping (design-ahead)
- [ ] `team_id → (organization, webhook_secret)` table + HMAC resolution by
      team.
- [ ] Webhook self-registration at connection-save (customer API key,
      per-connection secret).

## D4 — Composio per-org adapters
- [ ] Per-org adapter factory with caching; platform-singleton fallback; thread
      the org through call sites.
- [ ] Per-org trigger registration at connection-save; inbound trigger webhook
      disambiguation (workspace → org, verified per-org secret).

## D5 — Composio pricing research
- [ ] Findings note: how Composio bills; implications for `GATEWAY_DEBITS`
      rate and BYO-gateway zero-rating; the rate-table entry shape.
