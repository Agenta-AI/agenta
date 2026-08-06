# Research

Verified against the working tree. Paths are repo-relative under `services/runner/`.

## 1. The bug (F1, audit finding)

A non-Pi harness (Claude today; any future MCP-only harness) running on a **remote** sandbox
(Daytona) has no working delivery path for gateway/custom tools at all:

- `engines/sandbox_agent/mcp.ts` `buildSessionMcpServers` builds the internal gateway-tool
  channel as a runner-loopback (`127.0.0.1`) HTTP MCP server
  (`tools/tool-mcp-http.ts` `startInternalToolMcpServer`). On Daytona the harness runs **inside**
  the sandbox, where `127.0.0.1` resolves to the sandbox's own loopback, not the runner's — an
  unreachable URL. `buildSessionMcpServers` correctly skips advertising it there
  (`isDaytona ? { servers: [], close... } : await buildToolMcpServers(...)`).
- The code's own comment claimed the gap was covered: "gateway tools are delivered through the
  file relay instead (the relay loop already polls the sandbox filesystem on Daytona)." This is
  false for a non-Pi harness. The file-relay protocol (`tools/relay.ts`) has two halves: a
  **runner-side poller** (works for any sandbox, harness-agnostic) and a **sandbox-side writer**
  that must ask the runner to run a tool by dropping a `<id>.req.json` file into the relay dir.
  That writer exists in exactly one place: `extensions/agenta.ts` `registerTools`, which is Pi's
  bundled extension (`pi.registerTool` + `runResolvedTool` in the `execute` callback). It is
  installed only into Pi's agent directory and loaded only when Pi runs. Claude (or any other
  non-Pi harness) has no code path that writes a relay request file.
- The capability gate that should have caught this doesn't, because it is checking the wrong
  thing: `engines/sandbox_agent/capabilities.ts` `assertRequiredCapabilities` only asserts that
  the harness *can accept an MCP server and call a tool* (`capabilities.mcpTools` +
  `capabilities.toolCalls`, from the daemon probe). Claude reports both `true` — correctly, in
  general, since Claude can and does consume the internal channel over loopback HTTP locally.
  The gate has no notion of "reachable from here"; it never looks at `isDaytona`.
- Net effect before this fix: the run proceeds, the harness receives an empty tool list, the
  turn completes, `mcp.ts` logs a specific but FALSE message
  (`"daytona: N gateway tool(s) delivered via the file relay, not a loopback MCP URL"`), and the
  `/run` result comes back `ok:true`. A caller has no signal that every tool call the model might
  have made was structurally impossible.

## 2. Why Pi is unaffected

Pi never uses either MCP path for tools. `buildSessionMcpServers` short-circuits to
`{ servers: [], close: async () => {} }` for `isPi` before either layer runs
(`if (isPi || !capabilities.mcpTools) { ... return ... }`). Pi's tools ride entirely through
`extensions/agenta.ts`: the daemon loads the extension into the Pi process (local or inside the
Daytona sandbox — `prepareDaytonaPiAssets` uploads it there), the extension reads
`AGENTA_AGENT_TOOLS_PUBLIC_SPECS` / `AGENTA_AGENT_TOOLS_RELAY_DIR` from its environment, and its
`execute` callback calls `runResolvedTool`, which is the SAME sandbox-side relay-writer used by
the file-relay protocol (`tools/dispatch.ts`). So "the file relay works on Daytona" is true only
because Pi ships its own relay-writing client bundled as a harness extension. No other harness
has an equivalent.

## 3. What already exists to build on

- **Loopback HTTP MCP server** (`tools/tool-mcp-http.ts`): a from-scratch, dependency-free
  Streamable-HTTP JSON-RPC server (`initialize` / `tools/list` / `tools/call`), started per
  session on an OS-assigned port, bound to `127.0.0.1` only. This is the piece that needs a
  reachable address on Daytona, or an in-sandbox counterpart — see the two candidates below.
- **File-relay protocol** (`tools/relay.ts`): request/response JSON files in a shared dir,
  polled by the runner (`startToolRelay`), written by whichever process wants a tool run. Already
  harness-agnostic on the runner side. Already reaches into the Daytona sandbox filesystem via
  the daemon API (see `engines/sandbox_agent.ts`, the "Daytona tool relay" section) — the runner
  polls files that live inside the sandbox, not on the runner host.
- **Pi's bundled extension pattern** (`extensions/agenta.ts`): a fully-worked example of a
  sandbox-side relay-writing client — esbuild-bundled, env-driven, self-contained. It is a
  concrete template for a hypothetical non-Pi equivalent, though it depends on the harness having
  an extension/plugin mechanism to load into (Pi does; Claude's ACP agent and Codex's may not).
- **Daytona's own remote-reachability precedent — the preview proxy**: the runner already talks
  to a Daytona-hosted ACP HTTP endpoint through Daytona's preview-proxy mechanism
  (`engines/sandbox_agent/daytona.ts` `createCookieFetch`: "Daytona's preview proxy
  authenticates with a … cookie jar"). This means Daytona already exposes an authenticated
  reverse proxy from outside the sandbox to a port inside it — the reverse of what the internal
  tool-MCP channel would need (inside the sandbox reaching a URL that resolves to the runner),
  but it establishes that Daytona has a general request-routing/proxy primitive worth
  investigating for the other direction, or for exposing a runner-side port that a
  Daytona-issued URL can forward into the sandbox's network namespace.
- **The ngrok tunnel used for durable-cwd mounting** (`engines/sandbox_agent/mount.ts`
  `discoverTunnelEndpoint`): a working precedent for making a runner-side service reachable from
  inside a Daytona sandbox over the public internet (geesefs inside the sandbox mounts the
  runner's storage over this tunnel). This is the closest existing analogue to "advertise the
  internal tool-MCP on a sandbox-reachable URL" (candidate (a) below) — the same tunnel
  infrastructure could plausibly carry the tool-MCP's HTTP traffic too, provided auth is added
  (the mount path currently authenticates via signed mount credentials, not a bearer suitable for
  MCP).
- **No E2B path on this branch.** `mount.ts` mentions "e2b" only in a comment; there is no E2B
  sandbox provider implemented (`engines/sandbox_agent/provider.ts` only builds `local` and
  `daytona`). The interim gate below is written against the two providers this codebase actually
  has: `local` (loopback reachable) and `daytona` (loopback unreachable).

## 4. The interim fix implemented alongside these docs

`engines/sandbox_agent/run-plan.ts` `buildRunPlan` now refuses, before any cwd or sandbox is
created, any run where `!isPi && isRemoteSandbox && toolSpecs.length > 0` —
`REMOTE_TOOLS_UNSUPPORTED_MESSAGE`. This mirrors the existing not-implemented gates in the same
file (`CODE_TOOL_UNSUPPORTED_MESSAGE`, `USER_MCP_UNSUPPORTED_MESSAGE`,
`PI_USER_MCP_UNSUPPORTED_MESSAGE`, `FILESYSTEM_UNSUPPORTED_MESSAGE`,
`LOCAL_NETWORK_UNSUPPORTED_MESSAGE`): fail loud with a single named message instead of silently
dropping a declared capability. The gate counts ALL custom tools, `client` kind included: since
the #4985 recut, client tools ride the same internal MCP channel on local Claude (advertised in
`tools/list`, paused in `tools/call`), so on a remote sandbox they are exactly as undeliverable
as gateway tools — the model would never see them. (The original #5047 gate exempted client
tools because, pre-#4985, they were never routed through the channel at all.)
The `mcp.ts` "delivered via the file relay" log is now conditioned on `isPi` so it can never again
claim a delivery that isn't happening, as defense-in-depth against a future gate bypass (the
run-plan gate should make the branch it guards dead code, but the log no longer trusts that).

This is explicitly the interim/shipping fix, not the real feature — it trades "some valid
combinations now error where they used to (silently) proceed" for "no combination silently drops
tools." The real feature (making the combination actually work) is scoped below.
