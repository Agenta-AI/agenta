# Agent workflows — status for Mahmoud

_Maintained by the assistant — you only read this; GitHub is the source of truth._

Last updated: 2026-06-25

This is the plain-language picture of the agent-workflows work. It tells you where your
feedback is needed and what is happening. For the full detail, the PRs on GitHub are the
real thing.

---

## 👉 Needs your feedback

Nothing. `needs-review` is empty.

---

## ✅ Done

The entire agent-workflows stack is merged into `big-agents` (tip `0c8226acb4`). This
session closed ~18 PRs across two stages.

What's live and verified on the dev stack:

- Playground loads; harness, provider, and model pickers all populate.
- Sandbox enforcement works (stdio MCP disabled, network/fs errors shown correctly).
- Gateway tools work for Claude.
- HITL Approve/Deny renders and completes.
- Fail-loud: Pi no-response now surfaces as an error instead of a silent empty turn.
- HTTP MCP transport wired in.
- Subscription-auth Claude sidecar running at :8790.

The `big-agents` → `main` umbrella PR is **#4791** and is the eventual endgame once the
two parked items below are resolved.

---

## ⏳ Awaiting your go

| Item | What's needed |
|------|---------------|
| #4836 — sidecar URI | Rework: keep sandbox local/daytona; FE builds the composite URI. Design call needed before impl. |
| #4837 — embedref impl | Design lgtm'd; implementation deferred. Say the word to start. |
| Final AI QA sweep | End-to-end QA of the merged stack before the umbrella PR lands. |
| HITL FE Approve settle | "Approve" button sits disabled ~30–60 s (front-end rendering settle, backend fine). Small FE fix. |

---

## Nothing blocking

No decisions needed to keep the stack stable. The two open PRs are parked by design.
