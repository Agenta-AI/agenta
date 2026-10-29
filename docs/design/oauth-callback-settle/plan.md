# The OAuth callback only talks back to Agenta when it succeeds

Status: **diagnosed, not started.** Root cause below is verified against the code and the running
EE dev stack. No fix has been written.

## The symptom

Connect or reconnect a gateway tool (Settings → Tools, Settings → Triggers, or the in-chat connect
flow). If the provider authorization **fails or is denied**:

- The popup shows an error card with no buttons and never closes on its own.
- The opener never learns the flow ended: the row keeps its spinner, nothing is invalidated.
- When the user finally closes the popup by hand, the in-chat flow reports the result to the agent
  as **`reason: "cancelled"`** — the user is told they cancelled something they actually attempted,
  and the real provider error (which the callback page rendered) is thrown away.

On success the same flow works correctly. That asymmetry is the whole bug.

## Root cause

`_oauth_card()` in `api/oss/src/apis/fastapi/tools/router.py:1508` renders the callback page. Its
`agenta_url` parameter drives three separate things:

```python
agenta_origin = None
if agenta_url:                                     # ← everything below hangs off this
    ...
    agenta_origin = f"{scheme}://{netloc}"
agenta_post_message_origin_js = _json_for_inline_script(agenta_origin)
```

- **the postMessage target origin** — the page only posts when it is set:
  `if (window.opener && AGENTA_POST_MESSAGE_ORIGIN) { window.opener.postMessage(...) }` (`:1748`)
- **the "Return to Agenta" button** — `agenta_btn` is `""` unless `safe_agenta_url` (`:1581`)
- **the 5-second auto-close** — `auto_return_html` requires `success and safe_agenta_url` (`:1592`)

There are **six** `_oauth_card()` call sites. Exactly one passes `agenta_url`:

| line | outcome | passes `agenta_url`? |
|---|---|---|
| 919 | `success=False` — provider returned an error | **no** |
| 930 | `success=False` — missing connection identifier | **no** |
| 950 | `success=False` — connection could not be activated | **no** |
| 971 | `success=False` — connection could not be activated | **no** |
| 982 | `success=False` — internal error | **no** |
| 1037 | `success=True` | yes (`agenta_url=env.agenta.web_url`, `:1042`) |

So on every failure path `agenta_origin` is `None`, and the card degrades to: no message, no button,
no auto-close. A dead end.

Note the auto-close is gated on `success and safe_agenta_url`, so passing `agenta_url` alone still
leaves failure cards without the countdown. Both conditions need revisiting — see WP1.

## Why the opener then reports "cancelled"

Every listener falls back to a popup-closed poll, and each treats "closed without a message" as
abandonment. `web/oss/src/components/AgentChatSlice/components/clientTools/useConnectFlow.ts:221`
(the `reason: "cancelled"` is `:227`; a second one at `:279` handles an explicit abort):

```ts
const poll = window.setInterval(() => {
    if (!popupRef.current?.closed || succeeded) return
    // Abandon: closed without a success message.
    teardown()
    if (settleParkedCall) finish({connected: false, integration, slug, reason: "cancelled"})
    ...
```

The poll is a reasonable fallback for a user who really does close the window. It is the *only*
path on failure, so "the provider rejected the grant" and "the user changed their mind" become
indistinguishable — and the agent is told the wrong one.

The payload itself is also outcome-free: `{"type": "tools:oauth:complete", "slug", "integration"}`
(`:1537`). Even once failure cards start posting, an opener cannot tell success from failure from
the message; it can only re-read server state. WP2 addresses that.

## Affected surface

Six listeners, all with the same fallback shape:

| file | flow |
|---|---|
| `agenta-entity-ui/src/gatewayTool/drawers/ConnectDrawer.tsx:156` | connect a tool |
| `agenta-entity-ui/src/gatewayTool/drawers/ConnectionManagerDrawer.tsx:115` | manage connections |
| `agenta-entity-ui/src/gatewayTool/hooks/useReconnectToolConnection.ts:70` | reconnect a tool |
| `agenta-entity-ui/src/gatewayTrigger/drawers/TriggerConnectDrawer.tsx:191` | connect from Triggers |
| `agenta-settings-ui/src/tools/GatewayToolsSection.tsx:116` | Settings → Tools |
| `oss/…/AgentChatSlice/components/clientTools/useConnectFlow.ts:202` | in-chat connect |

Only the last one reports a `reason` to an agent, so it is where the wrong answer does real damage.
The other five just fail to settle.

## Work plan

### WP1 — every callback outcome talks back

Pass `agenta_url` at all six call sites, or default it inside `_oauth_card()` from
`env.agenta.web_url` so a new call site cannot forget it. Prefer the default: the parameter exists
only to be threaded through, and five of six authors already omitted it.

Then relax `auto_return_html`'s `success and safe_agenta_url` to `safe_agenta_url` so failure cards
also close themselves. Consider a longer countdown on failure, so the error stays readable.

### WP2 — the message carries the outcome

Add `success` (and `error` when present) to `oauth_complete_payload`. Openers can then distinguish a
denied grant from a cancelled window, and `useConnectFlow` can report a truthful `reason` and
surface the provider's message instead of discarding it.

Keep absent keys working: existing openers ignore unknown fields, and a payload with no `success`
key must keep meaning "completed, go re-read the server" so an older frontend against a newer API
does not regress.

### WP3 — the openers use it

`useConnectFlow` distinguishes three cases: message with `success: true` → connected; message with
`success: false` → failed, with the provider error; popup closed with no message → genuinely
cancelled. The other five listeners only need to keep invalidating, which they already do.

## Verification

Reproduce the failure path directly — click **Deny** on the provider consent screen, which routes to
the `:919` call site. Expected today: an error card with no buttons that never closes, and an opener
that never settles. Expected after WP1: the card closes itself and the row settles without a reload.

Success paths must keep working; they are the only ones exercised today, so they are the regression
risk.

## Corrections to earlier claims — do not repeat these

- **"Nothing sends `tools:oauth:complete`."** Wrong, and it nearly became the premise of this
  document. It came from grepping only `web/`, where all six hits are listeners. The sender is the
  **backend**, in an inline `<script>` built from `_json_for_inline_script`, so the literal string
  and the `postMessage` call are on different lines and neither grep alone finds it. Search
  `api/` and `services/` too, and grep the constant name, not just the message type.
- **"COOP blocks `popup.closed`, so the poll never fires."** Wrong. Google sends
  `cross-origin-opener-policy-report-only`, and report-only reports without enforcing. The console
  line "Cross-Origin-Opener-Policy policy **would** block the window.closed call" is the
  report-only wording; the poll works. Check for the `-report-only` suffix before blaming COOP.

## Related, and deliberately separate

On `/m` the whole question is moot until the QueryClient host fix lands (**PR #5915**): package-layer
`invalidateQueries` there addresses an orphan client, so even a correct callback message settles
nothing. Test this work on a branch that contains that fix, or the results are meaningless.
Background: `docs/design/query-client-host-divergence/plan.md`.

Also noted while reading this code and **not** part of this work:
`gatewayTool/drawers/ConnectDrawer.tsx`'s local `invalidateConnections` misses
`["triggers", "connections"]` — tracked as WP5 in the query-client plan.
