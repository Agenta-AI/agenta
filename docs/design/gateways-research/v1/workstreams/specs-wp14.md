# WP14 — Agent v0

**Owns:** agent v0's model call path. **Depends on:** WP12. **Blocks:** Checkpoint B.

The remaining caller. Smallest of the wave-2 packages, and the one that proves the resolver
change is general rather than runner-shaped.

---

## What changes

Agent v0 resolves a connection the same way the runner does, so this package is mostly the
consequence of WP12 rather than work of its own. What it must establish:

- The agent's model calls go through the gateway route, with our credentials.
- No provider secret is read, held or logged anywhere in the agent's path.
- The agent's own protocol matches a front door (WP23). If it speaks Chat Completions it is
  served today; if it speaks anything else, it needs the door and the dependency is real.

`services/oss/src/agent/secrets.py` is where the current secret handling lives and is the
first thing to read — what it does today is the list of what must stop happening.

## Contracts

- **The agent stops reading provider secrets at all.** Not "reads them and does not use
  them" — the code path goes away, or the secret is still one deployment mistake from being
  used.
- **Failures are legible.** A gateway refusal (model not allowed, endpoint deactivated,
  ceiling exceeded) reaches the agent as the platform's error envelope and surfaces with its
  code, not as a generic upstream error. `api/AGENTS.md`'s agent-actionable-errors rule
  applies: a payload the caller must change is `retryable: false` with a `next_step`.
- **No fallback.** If the gateway is unreachable the agent fails; it does not call a provider
  directly. A silent bypass is worse than an outage because nothing records it.

## Tests

- Unit: the agent's resolved connection carries the gateway route and no provider secret.
- Unit: a gateway refusal surfaces with its code and its `next_step`, not flattened into a
  generic failure.
- Unit: no code path in the agent reads a provider secret.
- Acceptance: an agent run completes through the gateway, and its calls appear as audit
  events with the right principal.

## Out of scope

- The runner and the harnesses (WP13), which resolve the same way but deliver differently.
- Evaluators and the playground, whose model call sites are deferred with the evaluator path
  (D15).
