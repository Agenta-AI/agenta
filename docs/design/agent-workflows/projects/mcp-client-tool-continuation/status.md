# Status

Last updated: 2026-07-11

## Current phase

Design review. No implementation code has been changed.

Draft design PR: [#5201](https://github.com/Agenta-AI/agenta/pull/5201), labelled
`needs-review`.

## Completed

- Read the Codex onboarding, plan-feature, interface-design, GitButler, documentation, and PR
  writing guidance.
- Reviewed the current internal MCP server, client-tool relay, responder, session pool, keepalive
  dispatch, and MCP delivery boundary.
- Confirmed PR #5185 is merged and Pi approval parking is a separate completed path.
- Confirmed PR #5153 remains the draft home of the original hold-open recommendation.
- Refreshed PR #5197 at head `343d7146935a8eb3ed41a203cd9a3db6ee954eef` and incorporated its
  continuity invalidation, sandbox lifecycle, native session load, and ownership work.
- Classified existing risks separately from risks introduced by holding sockets open.
- Defined a gateway-neutral pending-operation and delivery-port contract.
- Split the implementation into six progressive work packages with rollback gates.
- 2026-07-11: folded in the cross-consistency review round (requested by the owner alongside
  his own review of the event-driven-tool-relay PR). interface.md now states the
  transport-specific limits of `cancel` and `onClosed`, opens the `transport` union, and adds
  the future in-sandbox stdio mapping (PR #5234) with its three missing prerequisites. plan.md
  now places the WP1 bearer in the HTTP transport wrapper (never in the shared
  `mcp-handler.ts` that PR #5234 extracts), declares that PR #5234 slice 1 lands before WP1
  and WP3, and corrects the WP5 Daytona wording (refusal for client tools, cold elsewhere).
  research.md notes how PR #5234 narrows the Daytona refusal. Combined landing order:
  `../mcp-delivery-architecture/orchestration.md`.

## Decisions proposed

- Ship local Claude first. Keep Daytona exact continuation out of scope.
- Require the measured client timeout to exceed 60 seconds.
- Add loopback authentication before hold-open.
- Use a separate runner kill switch, default off.
- Support one pending client tool per session.
- Use exact ACP tool-call identity for live completion and retain name-and-arguments matching only
  for cold fallback.
- Treat PR #5197 as the improved cold and lifecycle layer, not as a pending-operation store.

## Dependencies

| Dependency | State | Effect |
| --- | --- | --- |
| Session keepalive pool and approval parking | Implemented on `big-agents` | Supplies live session parking and resume structure. |
| Pi approval parking, PR #5185 | Merged | No client-tool work required for Pi. |
| Session keepalive design, PR #5153 | Draft | Contains the original client-tool hold-open recommendation and experiments. |
| Session continuity, PR #5197 | Open, next to merge | WP3 waits for merge because it changes the same lifecycle files. |
| In-sandbox tool MCP, PR #5234 | Open, design review | Its slice 1 extracts `mcp-handler.ts` and `relay-client.ts` from the files WP1 and WP3 edit; land it before WP1 and WP3. |
| Real MCP gateway | Out of scope | The interface preserves a future adapter boundary. |

## Next step after approval

Run WP0 and post the measured timeout report before authorizing hold-open implementation. WP1 can
then harden the current MCP endpoint independently. WP3 starts only after PR #5197 merges and the
implementation branch is rebased on the resulting `big-agents` head.
