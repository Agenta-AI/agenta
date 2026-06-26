# Sandbox Permission

`SandboxPermission` is the declared security boundary an agent runs inside: outbound network
egress and filesystem access. It is Layer 2 of the model, modeled in Python and serialized to
the runner. What a reviewer most needs to get right is the enforcement matrix, because it is
uneven: network egress is a real hard boundary on Daytona, it is unenforceable on the local
sandbox, and the filesystem boundary is declared but enforced nowhere. A change here can flip
a run from passing to failing, so the matrix is the contract.

## The contract

```jsonc
{
  "network": {
    "mode": "on",                  // "on" (allow all egress) | "off" (block all) | "allowlist"
    "allowlist": []                // CIDR ranges; honored when mode is "allowlist"
  },
  "filesystem": null,              // "on" | "readonly" | "off"; declared, enforced nowhere
  "enforcement": "strict"          // "strict" (fail if it cannot be applied) | "best_effort"; omitted defaults to "strict"
}
```

It is optional on `AgentConfig`. An unset value never reaches the wire, so existing configs
are unaffected. The default config the form pre-fills sets `network.mode: "on"` and
`enforcement: "strict"`. The wire form is the nested camelCase `sandboxPermission` object on
the `/run` payload. The Python schema (`WireSandboxPermission.enforcement`) defaults
`enforcement` to `"strict"`, and the runner now matches: `buildRunPlan` treats an omitted
`enforcement` as strict (`enforcement !== "best_effort"`), so only an explicit `"best_effort"`
opts out of the hard-guarantee check (Codex LOW-6). The live service always fills `"strict"`;
this only aligns a direct runner caller.

The field-by-field narrative of these shapes lives in
[Agent config schema](../public-edge/agent-config-schema.md#sandbox_permission). This page
owns the review lens: what actually enforces, where it cannot, and what to check before you
flip the matrix.

## The enforcement matrix

Network egress is the only part with teeth, and only on Daytona.

| Boundary | Local sandbox | Daytona | Enforced by |
|---|---|---|---|
| `network.mode: "off"` | not enforceable | `networkBlockAll: true` | `daytonaNetworkFields` |
| `network.mode: "allowlist"` (non-empty) | not enforceable | `networkAllowList` (comma-joined CIDRs) | `daytonaNetworkFields` |
| `network.mode: "allowlist"` (empty list) | not enforceable | `networkBlockAll: true` (block-all, not open) | `daytonaNetworkFields` |
| `network.mode: "on"` / no policy | default-open | default-open (both fields unset) | n/a |
| `filesystem` | declared only | declared only | nothing |

**Network on Daytona is a hard boundary.** `daytonaNetworkFields` in
`services/agent/src/engines/sandbox_agent/provider.ts` translates the network policy into
Daytona create fields and `buildSandboxProvider` applies them when the sandbox provider is
built. `mode: "off"` and an empty allowlist both map to `networkBlockAll: true`: "allow these
zero ranges" is read faithfully as "allow nothing", so an empty allowlist locks down rather
than opening up.

**Network on local is not enforceable.** The local sidecar runs on the runner host with no
egress control. `buildRunPlan` in `run-plan.ts` rejects a restricted network policy
(`mode !== "on"`) on local with `enforcement: "strict"` before any work starts, and tells the
caller to set `enforcement: "best_effort"` or move to Daytona. `best_effort` lets the run
proceed without the guarantee.

**Even on Daytona, some work runs outside the boundary.** Code tools, gateway (callback)
tools, and stdio MCP servers do not run inside the sandbox. The tool relay
(`services/agent/src/tools/relay.ts`) executes code and callback tools in the runner process,
and the stdio MCP bridge (`services/agent/src/tools/mcp-bridge.ts`) launches an arbitrary
host process. All of these sit on the runner host, so a network-blocked sandbox does not
confine them. `buildRunPlan` knows this: under `strict` it rejects a restricted-network run on
Daytona too when the request carries executable tool specs or a stdio MCP server, again
pointing at `best_effort`.

**Filesystem is declared, enforced nowhere.** `filesystem` (`on` / `readonly` / `off`)
travels on the wire and is versioned with the config, but no provider applies it. See
`protocol.ts:158`.

## Owned by

- `sdks/python/agenta/sdk/agents/dtos.py`: `SandboxPermission` and `NetworkEgress`.
- `services/agent/src/protocol.ts`: the wire type.
- `services/agent/src/engines/sandbox_agent/provider.ts`: `daytonaNetworkFields` and
  `buildSandboxProvider`, where the network boundary is applied on Daytona.
- `services/agent/src/engines/sandbox_agent/run-plan.ts`: `buildRunPlan`, where a restricted
  policy is rejected when it cannot be a hard guarantee.

## Watch for when changing

- **The enforcement matrix.** Network egress enforces on Daytona, not on local, and the
  filesystem boundary enforces nowhere. Do not describe or treat the whole object as "declared
  only"; only the filesystem part is.
- **The strict-versus-best_effort gate.** `strict` rejects an unenforceable boundary;
  `best_effort` accepts the boundary may not hold. Changing what counts as unenforceable
  changes which runs get rejected.
- **Runner-host bypass.** Code and gateway tools and stdio MCP servers run on the runner host
  and escape the sandbox boundary even on Daytona. Adding a new host-side executor needs the
  same `buildRunPlan` guard, or strict mode silently stops being strict.
- **Local versus Daytona.** Test both. A policy that is a hard boundary on Daytona is a no-op
  on local; the only thing protecting local is the strict-mode reject.
- **The empty-allowlist semantics.** An empty allowlist means block-all, not open. Keep
  `daytonaNetworkFields` and `buildRunPlan` agreeing on that, or the two disagree on whether a
  run is restricted.

## Required test updates

- Runner unit tests for `daytonaNetworkFields` and `buildRunPlan` under
  `services/agent/tests/unit/`.
- Python wire tests for `SandboxPermission` serialization under
  `sdks/python/oss/tests/pytest/unit/agents/`; the golden fixtures pin the camelCase
  `sandboxPermission` shape.
