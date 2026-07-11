# claude-daytona-tools

Planning workspace for the **real fix** to a verified gap: on the **Daytona** remote sandbox, the
**Claude** (MCP-client) harness receives **zero** custom tools of any kind — gateway/callback, code,
and client (`request_connection`) — and today it fails **silently**.

This is the project the background thread
(`../../scratch/pr-4936-followup/02-client-tools-and-claude.md` D3) deferred as "option (a), a separate
future project." The interim honest **fail-loud** error (option c) ships separately in the
client-tool-cleanup PR; this is the durable delivery fix that makes that gate stop firing.

## The one-line problem

The runner's internal MCP server binds the **runner's** loopback (`127.0.0.1`,
`tools/tool-mcp-http.ts:49`), which a remote sandbox cannot reach, so it is skipped on Daytona
(`engines/sandbox_agent/mcp.ts:515`). Pi works because it has an **in-sandbox writer** (its bundled
extension) feeding the harness-agnostic file relay; Claude has **no** in-sandbox writer, so nothing in
the sandbox can ever produce a tool-call request.

## The headline (recommendation)

**Run the internal MCP server *inside* the sandbox** — on the sandbox's own loopback, reachable by
in-sandbox Claude — and have its `tools/call` handler feed the **existing** file relay
(`tools/relay.ts`). The relay loop, the server-side dispatch, the relay-file protocol, and the MCP
server itself are all already harness-agnostic and run on Daytona today; the in-sandbox shim is the
**MCP analogue of Pi's extension** and is the only missing piece. No credential ever enters the
sandbox, and no new network surface is opened (the endpoint stays loopback-only).

- **Option A (recommended):** in-sandbox MCP shim feeding the relay. Two transports —
  **A1 HTTP-on-sandbox-loopback** (primary, smallest diff: relocate `tool-mcp-http.ts` + fixed port +
  upload/start helpers cloned from the Pi-asset path) and **A2 stdio** (fallback, no port/readiness
  race). **Low risk, very high reuse, ~2-3 days incl. live QA.**
- **Option B (avoid):** expose the runner's MCP over the network (tunnel). Reverses trust onto an
  intentionally-unauthenticated, privileged endpoint and fights the SSRF guard — net-new auth + inbound
  surface.
- **Option C:** the Daytona-native channel *is* the file relay (collapses into A); in-sandbox resolver
  and inline-results are rejected on the no-credential-in-sandbox / dynamic-tool constraints.

## Files

- [`research.md`](./research.md) — verified current state with `file:line` refs: the single
  execution path, the three delivery front-ends, why Claude+Daytona is silently zero-tools, and the
  full inventory of what a fix can reuse.
- [`design.md`](./design.md) — the options (A1/A2/B/C) with honest trade-offs, the ranking and
  recommendation, the interface/seam design (design-interfaces lens), the test + live-QA plan,
  packaging/snapshot implications, and open questions.

## Status

DESIGN ONLY — awaiting owner review. No code changed, nothing committed. The draft PR comes later per
the standing workflow.

## Dependencies / sequencing

- **Gateway/callback** tool delivery has **no** dependency and can land first.
- **Client-tool** delivery on Daytona inherits the "park emits no MCP result, abort the in-flight
  call" redesign from the **agent-client-tool-cleanup** project — sequence it after/alongside that
  work so the shim's park composes instead of timing out.
