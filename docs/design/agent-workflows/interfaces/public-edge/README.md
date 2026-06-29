# Public Edge Interfaces

These are the contracts the agent service exposes to callers it does not control: the
browser playground, the embedded chat slice, and any client that drives a workflow over
HTTP. They sit at the edge of the service and decide what those callers can rely on.

A change here reaches code that ships on a different schedule than the service. Treat every
field as load-bearing. Add before you remove, and keep older shapes working unless you have
a reason not to.

## Interfaces

- [Agent messages](agent-messages.md): the streaming browser chat contract.
- [Workflow invoke](workflow-invoke.md): the generic batch invocation envelope.
- [Workflow inspect](workflow-inspect.md): the schema the playground reads to build the
  config form.
- [Agent config schema](agent-config-schema.md): the full editable config that ships out on
  inspect and comes back in on every run.
- [Build-kit overlay](build-kit-overlay.md): the read-only agent-template the backend attaches
  to a fetched application so the playground can hand a new agent its build kit.
