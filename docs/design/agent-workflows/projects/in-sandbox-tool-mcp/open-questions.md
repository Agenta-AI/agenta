# Open questions

Decisions the owner needs to make or confirm. Each states the recommendation so a yes is
enough. Items 1 and 5 changed on 2026-07-11 when the Codex review was folded in; see
[status.md](status.md) for that provenance.

1. **Transport: approve A2 (harness-spawned stdio) conditionally, gated on the slice 0
   restart spike?** The Codex review rejected the earlier "correct by construction" claim:
   whether the pinned Claude ACP adapter respawns the shim on the `session/load` path after
   a VM stop is external adapter behavior that must be proven. The plan now makes that
   proof slice 0 and locks A2 only after it passes. Documented fallbacks: force cold
   `createSession` for sessions containing the shim if restoration fails; A1 (HTTP
   loopback) as last resort. Recommendation: approve the conditional flip.

2. **Client tools on Claude+Daytona: keep failing loud until the bridge work lands?**
   This project delivers executable tools only; a run carrying a client tool
   (`request_connection`) on that path still refuses with a narrowed message. The
   alternatives (drop the spec silently, or advertise it and return a synthetic error)
   both mislead. Recommendation: fail loud, leave client tools to the future
   Daytona client-tool bridge workspace.

3. **Specs delivery: confirm the file, not the env variable.** Decided in the plan per the
   Codex review: `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` is unbounded and would be copied through
   four exec-environment layers under A2, so the shim reads the specs from a file uploaded
   next to the bundle, with the path in its per-server env. Pi keeps its env variable; the
   spec content shape stays shared. The earlier "note a fallback, build it later" position
   is out. Recommendation: confirm the file.

4. **Gate posture for future remote providers: confirm fail-closed stays.** After slice 1
   the refusal still fires for any non-Daytona remote provider (the in-flight E2B work
   would need its own proven delivery before the gate opens for it). Recommendation:
   confirm.

5. **User HTTP MCP, API-key-now: is the existing mechanism the answer?** Named secrets
   already become request headers on the user's HTTP entry
   (`services/runner/src/engines/sandbox_agent/mcp.ts:119`), SSRF-guarded, behind
   `AGENTA_AGENT_MCPS_ENABLED` (default off). The decision "API key in a header for now"
   appears to be already built; the only open item is when to flip the flag default, which
   is the separate S2 work (#4912), not this project. OAuth for user MCP stays named future
   work. Recommendation: confirm this reading so the policy in context.md is complete.

## Settled by the 2026-07-11 review fold (no longer questions)

- **Codex-on-Daytona** is a follow-up verification task, cut from v1.
- **Pi consuming the shim directly** (the old U2) is a follow-up decision, cut from v1.
- **Snapshot bake** is a follow-up with its own decision; per-run upload ships first.
- **Relay module ownership**: PR #5232 owns `relay-client.ts` / `relay-protocol.ts`
  extraction as its slice 0; this project consumes them.
