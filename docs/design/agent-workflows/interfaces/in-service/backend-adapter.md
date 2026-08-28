# Backend Adapter

`SandboxAgentBackend` is the one backend wired in production. It implements the
[`Backend`](runtime-ports.md) port for the `sandbox-agent` engine: it creates sessions, holds
the sandbox selection, serializes the `/run` payload, and delivers it over HTTP or CLI. When
you change how the service talks to the runner, you change this adapter.

Its place in the hexagonal layering, alongside the planned `LocalBackend`, is narrated in
[Ports and adapters](../../documentation/ports-and-adapters.md#backend). This page owns the
review lens: what this adapter does and what to check when it moves.

## The contract

It supports `pi_core`, `pi_agenta`, `claude`, and `codex`, and holds a `local` or `daytona` sandbox.
Its engine id is the hard-coded `"sandbox-agent"`, the one engine. The constructor resolves
the runner: a `url` selects HTTP delivery, otherwise a resolved `command` selects a CLI
subprocess.

```python
SandboxAgentBackend(
    sandbox="local",                  # "local" | "daytona"
    url=None,                         # HTTP runner URL; when set, HTTP transport
    command=None,                     # CLI command; used when url is None
    cwd=None,
    timeout=float(os.getenv("AGENTA_RUNNER_TIMEOUT_SECONDS", "180")),
)
```

The session receives neutral run data, including optional compiled `gateway_policy`, and builds
the wire payload with `request_to_wire(harness=..., gateway_policy=..., ...)` (see
[Service to agent runner](../cross-service/service-to-agent-runner.md)). The policy is not part
of the harness-specific config. The backend then delivers the payload:

```python
# batch
data = await self._backend._deliver(self._wire_payload(messages))   # HTTP or subprocess
result = result_from_wire(data); self._absorb_result(result)        # parse + carry session id

# stream
records = self._backend._deliver_stream(self._wire_payload(messages))
return AgentRun(records).on_result(self._absorb_result)
```

`_absorb_result` carries the returned `sessionId` forward to the next turn. The Python side
holds that id; the runner stays stateless.

## Owned by

- `sdks/python/agenta/sdk/agents/adapters/sandbox_agent.py`

## Watch for when changing

- **The supported harness set.** Adding a harness here is a real capability change.
- **Runner resolution.** URL versus command selection and the timeout env var decide the
  transport.
- **Streaming transport.** Batch returns one JSON; streaming returns an `AgentRun` over NDJSON
  records.
- **Result parsing and session carry-forward.** `result_from_wire` plus `_absorb_result` are
  how a multi-turn conversation keeps its id.
- **Neutral gateway policy carry.** `Backend.create_session`, `SandboxAgentSession`, and
  `request_to_wire` must keep the optional compiled policy in step. Do not route it through a
  harness template.
