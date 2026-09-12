# WP14 — tasks

Read [`specs-wp14.md`](specs-wp14.md) first. Branch from WP12's merge (IM4).

## Read first

- [ ] `services/oss/src/agent/secrets.py` — what it does today is the list of what must stop
      happening.
- [ ] Confirm which protocol the agent speaks. If it is not Chat Completions, this package
      depends on WP23's matching door and says so before starting.

## The change

- [ ] Resolve through WP12's `resolve_connection`; use the gateway route and our credentials.
- [ ] Delete the provider-secret path rather than leaving it unused. Code that can read a
      secret is one deployment mistake from reading one.
- [ ] No direct-provider fallback when the gateway is unreachable. Fail, and let the failure
      be visible.

## Errors

- [ ] A gateway refusal surfaces with its `code` and, where the caller must change something,
      its `next_step` (`api/AGENTS.md`). Do not flatten a 403 `model_not_allowed` into a
      generic upstream error — a small model cannot act on that.
- [ ] Unit: each refusal shape reaches the agent with its code intact.

## Tests

- [ ] Unit: the resolved connection carries the gateway route and no provider secret.
- [ ] Unit: no code path reads a provider secret — a grep-style guard is legitimate, the same
      way WP24 guards its body-parse invariant.
- [ ] Acceptance: an agent run completes through the gateway and appears as audit events.
- [ ] `ruff format` && `ruff check --fix`; run the service unit tests.
- [ ] Commit: "gateways(agent): route model calls through the gateway".

## Definition of done

- The agent holds no provider secret and has no path that could.
- Gateway refusals are actionable where the agent can act on them.
