# Specs

## Goal

Make gateway/custom tool delivery work for a non-Pi harness (Claude today; any future MCP-only
harness) on a remote sandbox (Daytona today; any future non-local provider), closing the gap the
interim gate in `run-plan.ts` currently refuses outright. Non-goals: user-declared stdio MCP
(stays disabled, unrelated security decision) and user-declared HTTP MCP (already works
unchanged on every sandbox, since it is a remote URL the harness dials directly).

## The gap, precisely

The internal gateway-tool channel has two jobs: **advertise** a way for the harness to discover
and call the tools, and **execute** a call by relaying it back to the runner, where the private
spec / scoped env / callback auth are applied server-side. Execution already works
sandbox-agnostically (`tools/relay.ts`, `tools/dispatch.ts`). Only advertisement is missing for
a non-Pi harness in a remote sandbox: there is no artifact inside the sandbox that speaks
whatever protocol the harness expects for "here are your tools."

Two shapes close that gap:

## Candidate (a): advertise the internal tool-MCP on a sandbox-reachable URL

Keep today's design (`tools/tool-mcp-http.ts`'s HTTP MCP server, `mcp.ts`'s advertisement of a
`type: "http"` ACP MCP server) but bind or expose it so a URL reachable **from inside the
sandbox** resolves back to the runner process, instead of binding to loopback only. Three
sub-options for the "reachable URL" part:

1. **Runner binds non-loopback.** Bind `tool-mcp-http.ts` to `0.0.0.0` (or a specific
   routable interface) instead of `127.0.0.1`, and advertise the runner's own network address.
   Only viable if the runner and the Daytona sandbox share a network path that doesn't already
   exist today (they don't — the sandbox is a separate remote VM/container with its own network
   namespace; nothing routes a Daytona sandbox's outbound traffic to the runner host's private
   IP without additional infrastructure). Effectively requires one of the other two sub-options
   underneath it anyway.
2. **A tunnel** (reusing `discoverTunnelEndpoint`'s ngrok infrastructure, already used to expose
   the runner's storage mount to a Daytona sandbox). The internal MCP server binds loopback as
   today; the runner also registers/reuses an ngrok tunnel forwarding a public HTTPS URL to that
   local port; that URL is what gets advertised as the ACP MCP server's `url`.
3. **A sandbox-side port-forward issued by the provider** (Daytona's own preview-proxy
   mechanism, the same one that already fronts the ACP HTTP endpoint with cookie-jar auth in
   `daytona.ts` `createCookieFetch`). If Daytona (or a future provider) can forward a port
   **into** the sandbox's own loopback from a runner-controlled listener, the sandbox's existing
   `127.0.0.1` advertisement becomes correct again with zero harness-side change — the forwarded
   port simply makes the runner's server locally reachable inside the sandbox.

**Auth story required in all three:** today's channel deliberately carries no secret because it
never leaves the runner's own loopback (no attacker can reach `127.0.0.1` on the runner host from
outside it). The moment the URL is reachable from the sandbox — let alone from the tunnel's
public internet hop in sub-option 2 — the channel needs its own bearer/token so a compromised or
malicious in-sandbox process (or, worse, anyone who guesses the tunnel URL) cannot call
`tools/call` and trigger a credentialed gateway action. This is new work: a per-run random token,
checked on every request, threaded through the ACP `headers` field (the `McpServerHttp` shape
already supports headers — `toAcpMcpServers` does exactly this for user HTTP MCP servers).

## Candidate (b): an in-sandbox relay CLIENT for non-Pi harnesses

Ship (or have the daemon spawn) a small MCP-server shim that runs **inside** the sandbox,
alongside the harness, and translates between "the harness's native tool-delivery mechanism" and
"the file-relay protocol" (write a `<id>.req.json`, poll for `<id>.res.json` — exactly what
`extensions/agenta.ts` `registerTools` already does for Pi, minus the Pi-extension plumbing
around it). Two delivery mechanisms for getting the shim into the sandbox:

1. **Daemon-spawned**, analogous to how the daemon already knows how to run each harness: the
   daemon starts the shim as a sibling process/MCP server alongside the ACP agent process and
   wires it into the session's MCP server list the way it wires in any other stdio MCP server —
   except this stdio server runs **inside the sandbox**, not on the runner host, so it does not
   reintroduce the runner-host-process security hole that `USER_MCP_UNSUPPORTED_MESSAGE` guards
   against. This needs the daemon (`sandbox-agent` package, not this repo) to grow a concept of
   "an extra in-sandbox MCP server the runner wants attached," which does not exist today for a
   non-Pi harness.
2. **Shipped like Pi's extension**, if the target harness has an equivalent
   plugin/extension-loading mechanism. Claude Code's ACP agent
   (`@zed-industries/claude-agent-acp`) would need to expose something analogous to Pi's
   `ExtensionAPI`/`registerTool` for this to apply; unconfirmed whether it does. If it doesn't,
   this sub-option collapses into (1).

**Auth/exposure story**: strictly better than (a) — the shim's traffic never leaves the sandbox
(it talks to the relay dir on the sandbox filesystem, the same file-based IPC Pi already uses,
which the runner already reaches via the Daytona daemon filesystem API). No new network exposure,
no new secret to mint or rotate, no tunnel.

## Comparison

| Axis | (a) Reachable URL | (b) In-sandbox relay client |
| --- | --- | --- |
| **Auth / exposure** | New secret required; sub-option 2 exposes a URL over the public internet (mitigated by a bearer, but still a new attack surface); sub-option 3 depends on provider-level port-forward trust boundaries being sound | No new exposure — traffic stays inside the sandbox filesystem, same trust boundary the runner already crosses for Daytona mounts |
| **Latency** | Extra network hop (sandbox → tunnel/proxy → runner) per tool call, on top of the existing relay-execution hop back to the runner; for sub-option 2 specifically, adds public-internet round-trip latency | One hop shorter: the shim talks file-relay directly, same mechanism Pi already uses at today's measured latency (the relay-poll interval, `RELAY_POLL_MS`, dominates either way) |
| **Per-provider work** | Daytona: reuse `discoverTunnelEndpoint`/preview-proxy (some infra exists); a future E2B-style provider not on this branch would need its own equivalent (host-side port exposure, different proxy model) — the design is NOT provider-agnostic, each provider needs its own "how do I get a URL routed here" answer | Provider-agnostic once the daemon can spawn/attach a sandbox-side process at all (which every provider already supports, since it's how the harness itself runs) — the only per-provider work is none beyond what already exists to launch a process/write files inside that sandbox |
| **Per-harness work** | None once built — the ACP `McpServerHttp` advertisement is harness-agnostic (any harness that accepts `type: "http"` MCP, which Claude already does) | Needs the daemon to grow "attach an extra in-sandbox MCP server" (sub-option 1) OR needs each harness to expose an extension mechanism (sub-option 2, uncertain for non-Pi harnesses) — the harder, more novel piece of engineering |
| **Which cells does it unblock** | All remote-sandbox non-Pi combinations at once, retroactively, for any current or future provider that can offer the reachable-URL primitive — but gated on that primitive existing per-provider | All remote-sandbox non-Pi combinations at once IF the daemon-spawned sub-option lands (provider-agnostic); narrower if stuck relying on per-harness extension support |
| **Security review surface** | New: a bearer-secured internet-reachable (or provider-proxied) endpoint serving a JSON-RPC tool-call API — needs its own threat model, closer in shape to the SSRF-guarded user-HTTP-MCP path (`mcp.ts` `validateUserMcpUrl`) than to today's "carries no secret because unreachable" internal channel | Reuses the EXACT trust boundary already accepted for Pi + Daytona (file relay inside a daemon-managed sandbox filesystem) — no new category of risk, just a second writer of an existing protocol |

## Recommendation

**Candidate (b), daemon-spawned sub-option**, is the better target: it reuses an
already-accepted trust boundary (the same one Pi's extension operates in today), needs no new
secret/token lifecycle, is provider-agnostic (works identically on Daytona and any future
provider, since it only depends on "can the daemon run an extra process/write files inside the
sandbox," which every provider must already support to run the harness at all), and does not add
a network hop or a new externally-reachable service to threat-model. Its cost is concentrated in
one place — teaching the daemon (the `sandbox-agent` package) to attach a non-Pi in-sandbox
relay-client MCP server to a session — rather than spread across every sandbox provider's
networking model the way (a) would require.

Candidate (a) is worth keeping as a fallback if the daemon cannot be taught to spawn an
in-sandbox process for a non-Pi harness (e.g., if the ACP agent's process model doesn't allow the
daemon to run a sibling process next to it) — in that case, reusing the existing Daytona tunnel
infrastructure (sub-option 2) is the least-new-code path, accepting the added secret-management
and public-exposure review it requires.

## Non-goals for this design (explicitly out of scope)

- Removing or relaxing the interim `run-plan.ts` gate before a working delivery path ships —
  the gate stays until one of the above lands and is tested end-to-end.
- Any change to user-declared MCP (stdio stays disabled; HTTP stays as-is).
- Supporting a sandbox provider not already in this codebase (no E2B provider exists here today).
