# Status

**2026-07-10** — Workspace created (draft PR). Plan drafted from a repo exploration pass against `origin/main` plus prior strategy discussion (self-hosters should not need Composio; MCP = actions plane, webhook/poll providers = events plane). No code written yet.

## State

- [x] Repo research (`research.md`) — triggers provider seam, vault (`webhook_provider` kind exists), frontend drawers/`AppLogo`, builder-agent op catalog all located
- [x] Phased plan (`plan.md` A–F) with file-level targets
- [x] Agent op + prose drafts (`agent-instructions.md`)
- [x] Secrets model + UX spec (`secrets-and-ux.md`)
- [ ] Owner review of open questions below
- [ ] Spikes: expression engine (Q1), connection_id call-site audit (Q2)
- [ ] Phase A start

## Questions waiting on the owner

1. **Q1 — JSONata vs CEL** for filter/transform. Recommendation: JSONata; needs a maturity spike on `jsonata-python` (timeout/size caps).
2. **Q2 — connection_id**: nullable for webhook subscriptions vs synthetic gateway connection. Leaning synthetic; needs the call-site audit before committing.
3. **Q4 — logos**: bundle SVGs (per-logo licensing check) vs hotlink URLs like the Composio catalog.
4. **Launch recipe set**: proposed GitHub, Telegram, Stripe, Slack Events, PostHog, Shopify, Linear, Cal.com, Typeform + Custom — trim or extend?
5. **Placement of `request_secret` UI work** relative to any in-flight chat-UI projects (`docs/design/agent-chat-*`) — who owns the inline secure-form pattern?
6. Should Phase D wording land together with the `trigger-latest-binding` op-catalog revisions to avoid two consecutive rewrites of the same prose?

## Decisions log

- 2026-07-10 — Webhook provider behind the existing `TriggersGatewayRegistry` seam; no parallel system (context D1).
- 2026-07-10 — Verification = closed set of 5 schemes; per-provider knowledge is recipe/agent config, not code (context D2).
- 2026-07-10 — Secrets never transit the conversation; `request_secret` op with out-of-band browser→vault entry (context D4).
- 2026-07-10 — Poll/MCP-poll provider and vault egress substitution deferred to v2, seam-compatible (plan.md "Later").
