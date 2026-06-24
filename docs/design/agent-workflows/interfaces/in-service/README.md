# In-Service Interfaces

These contracts stay inside one process or package. No HTTP field changes when they move,
which is exactly why they are easy to break by accident. They are the ports, DTOs, and
adapters that the service composes to turn a request into a run. Break one and you break
adapters, tests, or a future extension point, with no wire diff to warn you.

Read them when you touch the Python runtime: the handler that orchestrates a run, the
neutral DTOs that everything speaks, the ports that let backends and harnesses swap, and the
resolvers that turn config into concrete inputs.

## Interfaces

- [Agent service handler](agent-service-handler.md): the orchestration entrypoint.
- [Neutral runtime DTOs](neutral-runtime-dtos.md): the semantic vocabulary of the runtime.
- [Runtime ports](runtime-ports.md): the abstract seams backends and harnesses plug into.
- [Backend adapter](backend-adapter.md): the one backend wired today.
- [Harness adapters](harness-adapters.md): how Pi, Claude, and Agenta differ.
- [Browser protocol adapter](browser-protocol-adapter.md): the Vercel translation layer.
- [Tool models and resolution](tool-models-and-resolution.md): tool config to runnable spec.
- [MCP models and resolution](mcp-models-and-resolution.md): MCP config to resolved server.
- [Model connection resolution](model-connection-resolution.md): config to one connection.
- [Runner engine internals](runner-engine-internals.md): the runner's shared engine seam.
- [Permission responder](permission-responder.md): headless policy and human approval.
- [Sandbox permission](sandbox-permission.md): the network and filesystem boundary, and where
  each part is actually enforced.
