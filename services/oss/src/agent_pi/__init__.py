"""Agent runtime: ports and adapters for the WP-2 agent service.

The Python service is "our agent implementation". It owns two ports the design doc
calls out:

- ``Harness``: the seam between our service and the agent engine. ``PiHarness`` is the
  Pi implementation; it drives the TypeScript Pi wrapper in ``services/agent``.
- ``Runtime``: the seam for the run environment (start, shutdown, pause, connect
  volume). ``LocalRuntime`` runs the harness as a local subprocess. A Daytona adapter
  lands later behind the same port.
"""
