# Cross-Service Interfaces

These contracts cross a process, container, or external service boundary. The Python
service talks to the Node runner; the runner talks to the harness, the tool endpoint, and
MCP servers; the service talks to the vault; and traces flow back to Agenta. Each side
deploys on its own schedule and fails on its own, so a field added on one side can reach an
older version on the other.

That independence is what makes these the contracts to change carefully. The `/run`
contract in particular is pinned by golden fixtures and hand-mirrored between Python and
TypeScript, so any field change has to move both sides and their tests at once.

## Interfaces

- [Service to agent runner](service-to-agent-runner.md): the `/run` contract, the spine of
  the stack.
- [Runner to harness](runner-to-harness.md): how the runner drives Pi or Claude over ACP.
- [Runner to tool callback](runner-to-tool-callback.md): how runner tools call back into
  Agenta so secrets stay server-side.
- [Runner to MCP server](runner-to-mcp-server.md): the stdio bridge and file relay for
  non-Pi tool delivery.
- [Service to vault and tool providers](service-to-vault-and-tool-providers.md): credential
  and tool resolution before the run.
- [Service and runner trace export](service-and-runner-trace-export.md): trace context in,
  spans back out.
