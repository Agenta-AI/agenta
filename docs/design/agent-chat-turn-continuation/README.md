# agent-chat-turn-continuation

Fix for the duplicated turn blocks in the agent playground: after every tool
approval, the whole previous assistant turn stacks again as a new block. Root cause:
the AI SDK client continues the last assistant message on a resume, but our server
mints a fresh `msg-{trace_id}` per HTTP request, so the client's identity check fails
and it pushes a full clone instead of replacing in place.

Design-only workspace (2026-07-06). No product code changed here.

## Files

| File | What it holds |
|---|---|
| `context.md` | The symptom, why it happens (one paragraph), goals and non-goals |
| `research.md` | The full verified flow: message-id lifecycle, why the client clones, frontend decision points, wire frames for normal/pause/resume, before/after playground mock. Read this to understand the system. |
| `fix-options.md` | Options A/B/C evaluated, interface-role review, the trace-per-message implications, recommendation (A: server echoes the continuation id) |
| `plan.md` | Implementation slices, unit + manual test plan, rollout |
| `status.md` | Current progress and decisions |

## Related

- Original investigation:
  `docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md`
  (this workspace verifies and extends its root cause 1; root cause 2, the phantom
  tool failure, is out of scope here).
- Key code: `sdks/python/agenta/sdk/decorators/routing.py` (fix site),
  `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py` (id minting),
  `web/oss/src/components/AgentChatSlice/` (playground UI),
  `web/packages/agenta-playground/src/state/execution/` (resume predicate, request
  builder).
