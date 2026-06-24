# Sandbox Permission

`SandboxPermission` is the declared security boundary an agent runs inside: outbound network
egress and filesystem access. It is Layer 2 of the model, modeled in Python and serialized to
the runner. The important caveat for a reviewer is that it is declared, not yet enforced. The
config travels and is versioned; the runner does not apply it on the sandbox provider yet.

## The contract

```jsonc
{
  "network": {
    "mode": "on",                  // "on" (allow all egress) | "off" (block) | "allowlist"
    "allowlist": []                // CIDR ranges; used when mode is "allowlist"
  },
  "filesystem": null,              // "on" | "readonly" | "off"; declared, not enforced
  "enforcement": "strict"          // "strict" (fail if it cannot be applied) | "best_effort"
}
```

It is optional on `AgentConfig`. An unset value never reaches the wire, so existing configs
are unaffected. The default config the form pre-fills sets `network.mode: "on"` and
`enforcement: "strict"`. The wire form is the nested camelCase `sandboxPermission` object on
the `/run` payload.

## Owned by

- `sdks/python/agenta/sdk/agents/dtos.py`: `SandboxPermission` and `NetworkEgress`.
- `services/agent/src/protocol.ts`: the wire type.
- `services/agent/src/engines/sandbox_agent/run-plan.ts`: where the runner reads it.

## Watch for when changing

- **Declared versus enforced.** This is the headline. The moment the runner starts enforcing,
  the `enforcement: "strict"` path can start failing runs that used to pass.
- **Strict failure conditions.** Decide what counts as unenforceable before flipping
  enforcement on.
- **Local versus Daytona.** The two sandbox providers will enforce differently; test both.
- **Interaction with tools and MCP servers.** Network egress and filesystem policy can block a
  tool or an MCP server that reaches out.
