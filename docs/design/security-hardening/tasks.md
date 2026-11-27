# Security hardening — tasks

> Companion to `specs.md`. One worktree (`feat/security-hardening`). Do **WP1 before WP2** — WP2 reuses
> WP1's validated-IP/range-block logic. WP3 is independent. Effort: Low · Low-Med.

- **WP1 — SEC-1 webhook SSRF default-false + collapse duplicate flag + IP-pin.** Effort: Low-Med. Level: API.
  - Flip default `allow_insecure = false` (`core/webhooks/utils.py:9`, env in `utils/env.py`).
  - Collapse the duplicate `allow_insecure` knob (C-3) to one control.
  - Resolve-once (`getaddrinfo` + private/loopback/range block) then connect to the literal IP with the
    original Host header, in the delivery path (`core/webhooks/delivery.py`). Factor the resolve+block as a
    reusable guard (WP2 mirrors it).
  - Test: loopback/private target blocked by default; rebind between validate and send cannot reach an
    internal host.

- **WP2 — SEC-3 runner MCP SSRF guard, parity with WP1.** Effort: Low. Level: runner. *After WP1.*
  - Replace literal-only `isInternalHost` (`engines/sandbox_agent/mcp.ts`) with a resolve-and-range-block
    guard mirroring WP1's block list: hex/octal/integer IPv4, IPv4-mapped IPv6, private/loopback, DNS
    resolution. One canonical guard in the runner if both call sites can share it.
  - Test: each evasion form (hex/octal/integer IPv4, mapped IPv6) is blocked; parity with the webhook
    block list.

- **WP3 — SEC-2 Composio replay/freshness window.** Effort: Low. Level: API.
  - In `core/triggers/service.py` HMAC verify: reject `webhook-timestamp` outside a bounded window; dedup
    `webhook-id` in Redis with a matching TTL.
  - Do NOT touch the global-secret model.
  - Test: replay after window rejected; duplicate `webhook-id` within window rejected; fresh request passes.

## Verify
- API: `ruff format` then `ruff check --fix` from `api/`; `cd api && py-run-tests` for affected tests.
- Runner: build/typecheck + the SSRF guard unit tests.
- Report real results; do NOT commit; do NOT deploy the stack.

## Constraints
- Env config via `api/oss/src/utils/env.py` + shared `env` object, never raw `os.getenv`.
- Keep the webhook and runner guards semantically identical (mirrored block list) — divergence is the
  original SEC-3 defect.
- One terse comment line max, or none.
