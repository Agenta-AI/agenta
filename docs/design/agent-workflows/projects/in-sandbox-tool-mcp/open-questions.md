# Open questions

Decisions the owner needs to make or confirm. Each states the recommendation so a yes is
enough.

1. **Transport flip: approve A2 (harness-spawned stdio) over A1 (HTTP loopback)?**
   `claude-daytona-tools/design.md` recommended A1 with A2 as fallback, before warm sandbox
   reuse existed. The plan flips that: A2's lifecycle is tied to the harness session, which
   makes every reuse case (park-to-running, park-to-stopped, tool-set change) correct by
   construction, and #4873 already implemented it. A1 stays the documented fallback if an
   ACP adapter refuses stdio entries. Recommendation: approve the flip.

2. **Client tools on Claude+Daytona: keep failing loud until the continuation work lands?**
   Slice 1 delivers executable tools only; a run carrying a client tool
   (`request_connection`) on that path still refuses with a narrowed message. The
   alternatives (drop the spec silently, or advertise it and return a synthetic error)
   both mislead. Recommendation: fail loud, sequence client tools with
   `agent-client-tool-cleanup` / `mcp-client-tool-continuation`.

3. **Is Codex-on-Daytona part of this feature's acceptance, or a follow-up?** The shim is
   harness-agnostic by design, but the Codex ACP adapter's handling of stdio MCP entries is
   unverified. Recommendation: Claude is the acceptance gate; Codex is a verification task
   in slice 4, done when the Codex harness itself is in scope.

4. **U2 timing: when do we explore Pi consuming the in-sandbox MCP server directly?** It
   requires building an MCP client into the Pi extension (pi-acp drops `mcpServers`; that
   is by design), adds a hop to the one path that works everywhere, and its real payoff is
   user MCP on Pi. Recommendation: decide after Codex lands; U1's shared modules already
   deliver the "one gateway-tool logic" goal at the module level.

5. **Env contract: confirm reusing `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` /
   `AGENTA_AGENT_TOOLS_RELAY_DIR` for the shim's per-server env.** One public-spec contract
   for every in-sandbox consumer, correcting #4873's parallel names. If the spec JSON ever
   outgrows env limits (very large tool sets), the fallback is writing the specs to a file
   next to the bundle and passing the path. Recommendation: reuse the names; note the file
   fallback, do not build it yet.

6. **Gate posture for future remote providers: confirm fail-closed stays.** After slice 2
   the refusal still fires for any non-Daytona remote provider (the in-flight E2B work
   would need its own proven delivery before the gate opens for it). Recommendation:
   confirm.

7. **Snapshot bake timing.** Per-run upload ships first (about 5 kB, negligible). Bake into
   `build_snapshot.py` once the path is hot, behind a skip flag mirroring the Pi install
   flag. Recommendation: follow-up, not in the first PR.

8. **User HTTP MCP, API-key-now: is the existing mechanism the answer?** Named secrets
   already become request headers on the user's HTTP entry
   (`services/runner/src/engines/sandbox_agent/mcp.ts:119`), SSRF-guarded, behind
   `AGENTA_AGENT_MCPS_ENABLED` (default off). The decision "API key in a header for now"
   appears to be already built; the only open item is when to flip the flag default, which
   is the separate S2 work (#4912), not this project. OAuth for user MCP stays named future
   work. Recommendation: confirm this reading so the policy in context.md is complete.
