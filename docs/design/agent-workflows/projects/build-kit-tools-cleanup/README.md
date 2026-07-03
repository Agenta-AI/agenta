# Build-kit tools cleanup

Design workspace, 2026-07-03. Docs only; all code changes batch into one PR after review.

Clean up and redesign the playground build kit: the "inside" tool set a playground agent
uses to build itself. Executes the verdicts from the
[builder tooling review](../builder-agent-reliability/tools-review/README.md) and ports
the agent-creation-lab playbook
(`/home/mahmoud/code/agent-creation-lab/kit/BUILD-AGENT.md`) into the inside skills.

## TL;DR

- Rename the discovery ops (`discover_tools`, `discover_triggers`), hard migrate, no
  aliases. Full surface inventory with file:line in [research.md](research.md).
- Shrink the default overlay from 19 tools to ~13 via an explicit list in `overlay.py`;
  every cut op stays in the catalog for opt-in.
- **The headline call**: logic-bearing internal tools (`test_run`) should run as
  server-side handlers on the existing tool-call plane, registered through the platform
  catalog, with the relay gaining generic run-context injection. Not a composite resource
  endpoint, not runner-side logic. The four options and the argument:
  [tool-home-options.md](tool-home-options.md).
- `test_run` contract (verdicts ported from the lab's `check-tools.sh`) and the
  `query_spans` stopgap: [api-design.md](api-design.md).
- One ordered playbook skill replaces the three cross-referencing authoring skills, which
  research suggests were never actually delivered to the agent:
  [skills-port.md](skills-port.md).
- **Hard constraint**: zero approval-semantics changes; `op_catalog.py` edits sequence
  behind the in-flight [approval-boundary](../approval-boundary/) lane. See the
  coordination section of [plan.md](plan.md).

## Read in this order

1. [context.md](context.md) - why, goals, non-goals, what is already decided.
2. [tool-home-options.md](tool-home-options.md) - the decision Mahmoud most wants to
   review.
3. [api-design.md](api-design.md) - `test_run` + `query_spans`.
4. [skills-port.md](skills-port.md) - the playbook port.
5. [research.md](research.md) - the evidence behind all of the above.
6. [plan.md](plan.md) - execution slices.
7. [status.md](status.md) - decided / open / blocked, at a glance.

## Inputs (settled)

- [tools-review](../builder-agent-reliability/tools-review/README.md) (parts 1 and 2):
  the per-tool verdicts with Mahmoud's 2026-07-03 decisions folded in.
- [builder-agent-reliability/context.md](../builder-agent-reliability/context.md): the
  original reliability problem and the worked example.
- The lab kit's `BUILD-AGENT.md`: the proven outside playbook.
- `.agents/skills/design-interfaces/SKILL.md`: the lens applied to every contract here.
