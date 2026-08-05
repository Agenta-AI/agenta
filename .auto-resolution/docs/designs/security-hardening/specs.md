# Security hardening — specs

> Closes the security batch from the v3 assessment: SEC-1 (webhook SSRF), SEC-3 (user-MCP SSRF guard),
> SEC-2 (Composio replay). Source: `big-agents-audit/big-agents-assessment-v3.md`. Independent of the
> redaction and spine work. SEC-1 and SEC-3 **share one SSRF guard** — that unification is the point.

## SEC-1 — Outbound webhook SSRF default-open + validate/send TOCTOU (High)

**Problem.** `allow_insecure` defaults **true** (and there is a duplicate default-true knob, C-3), so
private/loopback targets aren't blocked out of the box. Even with it false, validation resolves the host
once but `httpx.post(url)` re-resolves at connect → **DNS-rebind** window.

**Fix.**
1. Default `allow_insecure = false`.
2. Collapse the duplicate flag (C-3) to one control.
3. **Pin the connection to the validated IP** — resolve once (`getaddrinfo` + private/loopback/range
   block), then connect to the literal IP (with the original Host header), closing the TOCTOU.

Anchors: `api/oss/src/core/webhooks/utils.py:9` (`_WEBHOOK_ALLOW_INSECURE = env.agenta.webhooks.allow_insecure`),
the delivery path in `api/oss/src/core/webhooks/delivery.py`, env in `api/oss/src/utils/env.py`.

**Secure-by-default direction (decided).** The code default is **`false`** (block private/loopback), NOT
`true`. Rationale: a security control must protect the *un-configured* deployment — the operator most
likely to forget the flag is the one who most needs the guard, which is exactly the SEC-1 "default-open"
bug. The override is asymmetric in our favor: **dev/self-host** is where you *want* insecure (webhooks to
`localhost`) and where the env file is already being edited, so opting in there is cheap and the failure
mode (a blocked localhost webhook) is loud and immediate; **prod** is where a forgotten flag is silent and
catastrophic. So default-false, and **dev env files explicitly set `=true`.**

**Paired requirement (do NOT ship the flip without this).** Flipping the code default to `false` changes
local-dev behavior: today the dev `.env.*.dev` files have the flags **commented** (`# ...=false`), so dev
runs on the old code default `true`; after the flip, local webhook/hook testing against `localhost`
regresses silently. Fix in the same change: uncomment and set `AGENTA_WEBHOOKS_ALLOW_INSECURE=true` and
`AGENTA_SERVICES_HOOK_ALLOW_INSECURE=true` in `hosting/docker-compose/{oss,ee}/.env.*.dev` (and the
`.example`/`.split` variants), and leave prod/cloud env unset → inherits the secure default.

**Done when:** default config blocks a loopback/private target; the validated-IP pin means a rebind
between validate and send cannot reach an internal host; only one `allow_insecure` knob remains; **dev env
files actively enable insecure mode so local `localhost` webhook/hook testing still works.**

## SEC-3 — User-MCP SSRF guard is literal-only (Med, Low live)

**Problem.** `isInternalHost` (`services/runner/src/engines/sandbox_agent/mcp.ts`) matches dotted-decimal
+ partial IPv6; misses hex/octal/integer IPv4, IPv4-mapped IPv6, and does no DNS resolution (no rebind
protection). Flag-gated off by default.

**Fix.** **Reuse the SEC-1 validator's `getaddrinfo` + range-block logic** — one shared SSRF guard, not
two divergent ones (Simplicity lens). The runner path is TS and the webhook path is Python, so "shared"
means **one canonical guard per runtime with identical semantics**, mirrored (the range-block table and
resolution behaviour must match). If a single guard can serve both call sites within the runner, use it.

**Done when:** the runner guard resolves the host and blocks hex/octal/integer IPv4 + IPv4-mapped IPv6 +
private/loopback ranges, with parity to the webhook validator's block list.

## SEC-2 — Composio inbound: no replay/freshness window (Med-High)

**Problem.** HMAC verify (`api/oss/src/core/triggers/service.py`) extracts `webhook-timestamp` and
`webhook-id` but checks **neither** — a captured valid request replays forever.

**Fix (the actionable gap — not per-tenant secrets).**
1. **Freshness:** reject requests whose `webhook-timestamp` is outside a bounded window (e.g. ±5 min).
2. **Replay dedup:** store seen `webhook-id` in Redis with a TTL matching the window; reject a repeat.

The global secret is **defensible** (Composio is the source of truth; per-tenant binding is enforced at
the envelope→project layer) — do **not** chase per-tenant secrets here.

**Done when:** a captured request replayed after the window (or a duplicate `webhook-id` within it) is
rejected; a fresh, first-seen request passes.

## Non-goals
No per-tenant Composio secret rework (SEC-2 note). No new SSRF architecture beyond one shared guard per
runtime. Env config through the shared `env` object only.
