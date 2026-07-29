# Client tools on Claude in remote (Daytona) sandboxes

An agent that runs on the Claude harness inside a remote Daytona sandbox cannot call a
browser-fulfilled tool such as `request_connection`. The same tool already works on Pi (any
sandbox) and on Claude in the local sandbox. This workspace plans the change that closes the
gap. It reuses the delivery path Pi already uses on Daytona, so it adds no new network route
between the runner and the sandbox.

This is a design and planning workspace. It changes no code. It links the feature request
(#5256) and the silent-drop bug whose remaining case it closes (#4984).

## Read in this order

1. [PLAN.md](PLAN.md): the whole plan. What happens today, why, the five implementation
   steps with their file-level changes and altered contracts, the test plan, rollout and
   rollback, non-goals, how it composes with two other in-flight efforts, and open questions.

The plan is a single file on purpose: the change is small and the steps are tightly coupled,
so one linear read serves the implementer better than a split workspace.

## Glossary

These terms recur throughout the plan. Each is defined once here so later text can lean on
the shared meaning.

- **Runner**: the Node service (`services/runner/`) that drives one agent turn. It receives a
  JSON `/run` request and returns a structured result. It decides how to run the agent; the
  Python agent service decides what to run.
- **Harness**: the coding-agent program the runner drives. Two exist: **Pi** (bundled, MIT)
  and **Claude** (Claude Code over a protocol link). They differ in how they discover and
  call tools.
- **Sandbox**: the isolated compute where the harness runs. **Local** means the same host as
  the runner. **Daytona** means a separate remote virtual machine.
- **MCP** (Model Context Protocol): the standard way a harness lists and calls tools.
- **ACP** (Agent Client Protocol): the control link between the runner and the harness
  process running inside the sandbox. It carries the prompt, streamed events, and permission
  requests.
- **Executable tool**: a gateway or callback tool the runner runs itself, server-side, behind
  its own permission check. Its credentials never enter the sandbox.
- **Client tool**: a tool fulfilled by the user's browser, not by the runner. `request_connection`
  is the canonical example. The model calls it, the browser does the work, the browser's result
  becomes the tool result.
- **In-sandbox stdio MCP shim** ("the shim"): a small Node program the runner uploads into a
  Daytona sandbox. The Claude harness launches it and speaks MCP to it over standard input and
  output. The shim forwards each tool call to the runner and returns the runner's answer.
- **File relay** ("the relay"): how the shim and the runner exchange a tool call across the
  sandbox boundary. The shim writes a request file `<id>.req.json` into a shared directory; the
  runner writes the answer file `<id>.res.json`; the shim reads it back. The runner also runs a
  loop that watches that directory and executes each request.
- **Park and resume**: pause the model's current turn to wait for a human or the browser, then
  continue the same agent session later with the awaited result.
- **Cold replay**: the resume mechanism that re-sends the whole stored conversation to reach
  the paused point again, rather than holding the live session in memory. Client-tool resume
  uses cold replay today.

## Related work

- [../daytona-gate-delivery/](../daytona-gate-delivery/): the Claude permission-gate parity
  fix on Daytona; the ACP permission plane this plan does not touch.
- [../mcp-client-tool-continuation/](../mcp-client-tool-continuation/): earlier experiments on
  client-tool continuation.
- [../remote-tools-delivery/](../remote-tools-delivery/) and
  [../gateway-tool-mcp/](../gateway-tool-mcp/): executable-tool delivery to Claude on Daytona
  (#5244), the path this plan extends to client tools.
- [../hitl-fix/](../hitl-fix/): the concurrent human-in-the-loop work this plan must not
  regress (see PLAN.md, "How this composes").
- The research this plan builds on:
  [../../scratch/research-client-tools-and-concurrent-hitl.md](../../scratch/research-client-tools-and-concurrent-hitl.md),
  Question 1.
