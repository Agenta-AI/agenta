# WP15 — MCP servers on the wire

**Owns:** the runner's MCP server configuration path. **Depends on:** WP12, and WP13's wire
commit. **Blocks:** Checkpoint B.

The smaller of the two runner packages, because the binding it needs already exists.

---

## What changes

`McpServerConfig` (`services/runner/src/protocol.ts:314`) already has the right shape:

```ts
connection: { type: "http", url: string, headers?, credentials?: McpCredential[] }
policy:     { tools: McpToolPolicy, permission? }
```

`McpCredential.binding` is `{ kind: "header", name }` — the header binding the model side
lacked, which is why this package is small.

After this package, per server:

- `connection.url` is the gateway's MCP route: `{gateway_base}/gateways/mcps/{namespace}/...`
  following D30's grammar — `builtin/{provider}/{integration}/{connection}`,
  `builtin/agenta/{slug}`, or `custom/{slug}`.
- `connection.credentials` carries **our** credentials in the gateway header, not the
  upstream server's token.
- `policy.tools` is unchanged. The gateway enforces its own filter at the boundary; the
  runner keeping its own is defence in depth, not duplication to remove.

## The one thing worth stating twice

**The gateway's tool filter and the runner's tool policy are different enforcement points
and both stay.** The gateway refuses a tool the endpoint's filter disallows, before the
upstream is dialled. The runner refuses a tool the run's policy disallows, before the call
leaves the sandbox. Removing either because "the other one covers it" removes a boundary.

Their documents are no longer the same shape — the gateway's filter is
`{allowlist, denylist}` and the wire's is `{mode, names}` — and that is fine. They are
enforced in different places by different owners; the wire is not a copy of the endpoint.

## Contracts

- **No upstream server token reaches the sandbox.** Same assertion as WP13, on the tool side:
  inspect the sandbox, not the resolver.
- **Tool names are untouched.** D16's transparency: same names, same schemas, same errors.
  A gateway-routed server is an HTTP MCP server whose URL happens to be ours.
- **The wire's shape is WP13's.** If this package needs a wire change, it reports it — the
  file is shared and editing it in parallel is how a stack scrambles.

## Tests

- Unit: a gateway-routed MCP server config carries the gateway URL and our credentials, and
  no upstream token.
- Unit: `policy.tools` survives unchanged through the resolution path.
- Acceptance: a run's tool calls reach a server through the gateway, with no server token in
  the sandbox, and appear as audit events.

## Out of scope

- OAuth-protected servers, which are wave 3 (WP16–WP20). Wave 1's reachable set is
  unauthenticated servers and the mocks (D23), and that is what this package is tested
  against.
