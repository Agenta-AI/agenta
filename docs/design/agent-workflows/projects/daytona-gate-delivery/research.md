# Research

This document separates confirmed facts, ruled-out hypotheses, and remaining live
validation. File references describe the current working tree unless a versioned upstream
link is provided.

## Root cause

Daytona and local runs use different `pi-acp` adapter versions.

### Local uses `pi-acp` 0.0.29

`services/runner/package.json` pins `pi-acp` 0.0.29. The local daemon prepends the
runner's `node_modules/.bin` directory to `PATH` in
`services/runner/src/engines/sandbox_agent/daemon.ts`, so the local sandbox-agent process
starts that adapter.

The installed 0.0.29 adapter handles Pi's `extension_ui_request`. For a confirm dialog it
calls ACP `requestPermission`, waits for the answer, and sends an
`extension_ui_response` back to Pi. See the installed adapter near
`node_modules/.pnpm/pi-acp@0.0.29/node_modules/pi-acp/dist/index.js:1050-1143`.

### Daytona inherits `pi-acp` 0.0.23

`services/runner/sandbox-images/daytona/build_snapshot.py` builds
`agenta-sandbox-pi` from `rivetdev/sandbox-agent:0.5.0-rc.2-full`. The recipe installs
`@earendil-works/pi-coding-agent` 0.80.6, but it does not update the base image's private
Pi ACP adapter.

The official sandbox-agent 0.5.0-rc.2 adapter manifest pins `pi-acp` 0.0.23:
[adapters.json](https://github.com/rivet-dev/sandbox-agent/blob/cb42971b565cbe20c28f0d14a4d72b614c79eac7/scripts/audit-acp-deps/adapters.json#L21-L25).

Version 0.0.23 has no `extension_ui_request` branch. It ignores the event in its default
case: [pi-acp 0.0.23 session.ts](https://github.com/svkozak/pi-acp/blob/9c9bc93dc02228add0cbc0c7297eca2d964aacd0/src/acp/session.ts#L618-L620).
The bridge landed later in commit
[`1412ea6110`](https://github.com/svkozak/pi-acp/commit/1412ea611006a86f71c76600f3f0a7d1f3daffcb)
and shipped in 0.0.28.

### Why this matches F-018

The Pi extension calls `ctx.ui.confirm` in `services/runner/src/extensions/agenta.ts`.
Pi emits an extension UI event. On local, adapter 0.0.29 converts it into
`session/request_permission`. On Daytona, adapter 0.0.23 ignores it, so the confirm never
gets an answer.

Normal Pi events still become `session/update`, which is why the runner sees the tool call.
The runner never logs `[HITL] pi-gate` because no permission request exists. The request is
lost before HTTP, SSE, or the Daytona proxy.

This is the root cause with high confidence. One live version query against the deployed
snapshot remains useful confirmation, not an open architecture question.

## What the Daytona preview proxy is

The preview proxy is authenticated public ingress to one TCP port inside a Daytona
sandbox. It is not an ACP-specific service and it is not the outbound proxy Daytona uses
for protected secrets.

The sandbox-agent Daytona provider does the following:

1. Starts `sandbox-agent server` on sandbox port 3000.
2. Requests a signed preview URL for port 3000 with a four-hour TTL.
3. Connects the outer SDK to that HTTPS URL.

The signed URL has the form `https://{port}-{signed-token}.{proxy-domain}`. Daytona
documents the authentication and expiry model in its
[preview documentation](https://www.daytona.io/docs/en/preview/).

The last public Daytona proxy source before the repository maintenance change shows the
request path. The proxy authenticates the signed hostname token, resolves the regional
runner that owns the sandbox, and forwards the request to the selected sandbox port. The
final forwarding layer is Go's `httputil.ReverseProxy` with a 100 millisecond flush
interval for streams. It handles HTTP methods and bodies without parsing ACP or JSON-RPC.

The repo's `createCookieFetch` wrapper in
`services/runner/src/engines/sandbox_agent/daytona.ts` persists the
`daytona-sandbox-auth-*` cookie because Node fetch has no cookie jar. The wrapper also uses
the long-timeout ACP dispatcher. It does not translate protocol messages.

### Account tier is not the cause

The documented Tier 3 preview difference is removal of the browser warning page. The
warning middleware bypasses non-browser clients, including the runner's Node and Undici
requests. A tier, token, expiry, or request-rate problem would fail or redirect an HTTP
request. It would not selectively remove one JSON-RPC method from an SSE byte stream while
letting another method through.

The source contains no filter for `session/request_permission`. More importantly, the
adapter version proof shows that the failing Daytona process never emits that method.

## The ACP HTTP path

The outer runner-to-sandbox-agent connection uses concurrent HTTP channels to one URL:

- Client-to-daemon JSON-RPC uses one POST per envelope.
- Daemon-to-client traffic uses one persistent GET with
  `Accept: text/event-stream`.
- Notifications and server-initiated requests share that SSE stream.
- The answer to a server-initiated request is another POST.

The installed `acp-http-client` implements POST near `dist/index.js:230-268`, starts the
SSE GET near `269-330`, and sends every parsed SSE message through the same inbound path
near `333-393`. The sandbox-agent client installs `requestPermission` beside
`sessionUpdate`, so both message types use the same transport.

This is HTTP plus SSE. It is not WebSocket, long polling, callback delivery, or filesystem
polling.

Upstream sandbox-agent already fixed an earlier client deadlock that prevented permission
answers while a long-running prompt POST remained open. The installed 0.4.2 client contains
that fix and upstream pins it with a test named
`answers session/request_permission while session/prompt is still in flight` in
[the 0.4.2 smoke suite](https://github.com/rivet-dev/sandbox-agent/blob/v0.4.2/sdks/acp-http-client/tests/smoke.test.ts).

## Permission delivery, end to end after parity

With adapter 0.0.29 in the snapshot, the live path is:

1. The Pi extension raises `ctx.ui.confirm` for the builtin call.
2. Pi emits `extension_ui_request` to `pi-acp`.
3. `pi-acp` emits ACP `session/request_permission`.
4. sandbox-agent broadcasts the request on the same SSE stream as updates.
5. The outer SDK maps the agent session id to the Agenta session and invokes its permission
   listener.
6. `acp-interactions.ts` evaluates the runner-owned permission plan.
7. The runner POSTs the selected ACP permission response.
8. `pi-acp` sends the extension UI answer to Pi and the original tool call continues or is
   blocked.

The existing runner path already supports allow, deny, and pending human approval. Option A
does not add a new interface.

## Live and cold approval are lifecycle states, not transports

### Live continuation

When the sandbox and prompt remain alive, the runner can retain the ACP permission id and
the original prompt promise. A human answer calls `respondPermission` on the same session.
The original call continues with its byte-exact arguments. The relevant state is in
`services/runner/src/engines/sandbox_agent.ts` around the parked-approval type and the
resume path near lines 1653-1689.

### Cold replay

If the sandbox stops, archives, is deleted, or loses its live connection while approval is
pending, the adapter process and its pending RPC die. No transport can answer that dead
request. A file channel does not change this.

The cold path stores the human decision durably. On the next run, the runner restarts or
recreates the session, the model reissues the pending call, and the responder consumes the
stored decision. The call is authorized through a new ACP request on the new live
connection.

Option B is therefore not required for cold approval. Durable decisions and replay are.

## Pi, Claude, MCP, and custom tools

The first draft grouped different delivery mechanisms under “MCP.” The current behavior is:

| Case | Daytona behavior |
| --- | --- |
| Pi builtins | Pi extension dialog through `pi-acp` to ACP permission. F-018 is the stale-adapter failure on this path. |
| Pi Agenta custom and gateway tools | Pi extension plus filesystem execution relay. This is not user MCP. |
| Pi user-declared MCP | Rejected before the run. Pi receives no ACP MCP server list. |
| Claude native tools | Native ACP permission requests. F-018 does not prove this path fails. |
| Claude Agenta gateway tools | Unsupported on Daytona because the internal runner-loopback MCP endpoint is not reachable from sandbox loopback. |
| Claude user HTTP MCP | Delivered when the harness advertises MCP; the sandbox connects to the remote URL. |
| User stdio MCP | Disabled for every harness. |

Evidence lives in `services/runner/src/engines/sandbox_agent/mcp.ts` and
`run-plan.ts`. In particular, `buildSessionMcpServers` returns no ACP MCP servers for Pi,
skips the internal loopback server on Daytona, retains user HTTP servers for capable
non-Pi harnesses, and rejects stdio.

Option A fixes the Pi reverse permission path. It does not add new forward-delivery
capabilities for MCP or custom tools.

## Focused validation

The implementation pass should run these checks in order:

1. Query the current Daytona snapshot's private Pi adapter version. Expect 0.0.23.
2. Rebuild a temporary snapshot with private adapter 0.0.29 and verify the version before
   creating a run.
3. Run allow-mode read and bash. Expect `[HITL] pi-gate`, immediate runner allow, and a
   completed tool call.
4. Run deny mode. Expect a denied result and no execution.
5. Run ask mode while the sandbox remains live. Approve and reject once; expect the
   original prompt to continue through `respondPermission`.
6. Exercise cold approval by letting the live continuation go away, then answer and resume.
   Expect a reissued gate to consume the stored decision.
7. Run a Claude ask-mode control on Daytona. Record its result separately from F-018.
8. List Daytona sandboxes before and after the run and delete every test sandbox.

Only if step 3 still fails after the adapter emits a permission request should the team
instrument raw adapter stdout and the proxy SSE stream. That experiment would establish
whether a real envelope disappears after generation. Until then, a file permission channel
has no evidence-based trigger.
