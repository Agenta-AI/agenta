# Agent Workflows

This workspace documents the agent-workflows feature: running a coding harness as an
Agenta workflow. It is organized into five layers so the living design docs stay separate
from in-flight project notes and historical archaeology.

## Layout

- **[documentation/](documentation/)** — the living design docs, kept current with the
  code. Start here.
- **[interfaces/](interfaces/)** - interface inventory for reviews: public edge
  contracts, cross-service contracts, and in-service ports/DTOs.
- **[projects/](projects/)** — active, self-contained workstreams. Each has its own
  `README.md`/`status.md`. These graduate into `documentation/` or fold into the code as
  they land.
- **[scratch/](scratch/)** — transient coordination: status, open issues, PR/branch
  cleanup reports. These drop off and move to `archive/` over time.
- **[archive/](archive/)** — superseded notes, old RFCs, and finished work-package
  spikes. Kept for archaeology only; not design truth.
- **trash/** — truly disposable items, safe to delete.

## documentation/ (read in this order)

1. [Ground Truth](documentation/ground-truth.md): what the code does, what is wired, and
   what is still missing.
2. [Architecture](documentation/architecture.md): the service, agent runner sidecar,
   harnesses, and sandboxes.
3. [Protocol](documentation/protocol.md): `/invoke`, `/messages`, `/load-session`, and the
   runner `/run` wire contract.
4. [Ports and Adapters](documentation/ports-and-adapters.md): the SDK runtime ports,
   backend adapters, harness adapters, and browser protocol adapter.
5. [Agent Template](documentation/agent-template.md): the split between generic agent
   identity, harness-specific config, and runtime infrastructure.
6. [Sessions](documentation/sessions.md): cold replay, streaming, session ids, and the
   missing session store.
7. [Triggers](documentation/triggers.md): planned trigger/event integration.
8. [Tools](documentation/tools.md): the tool taxonomy and executor model.
9. Adapters: [Pi](documentation/adapters/pi.md),
   [Claude Code](documentation/adapters/claude-code.md),
   [Agenta](documentation/adapters/agenta.md).
10. [Skills](documentation/skills.md): the development-workflow skills (plan, implement,
    debug, test, document, branch) and how they chain across a feature's life.

## projects/

- [code-tool-sandbox](projects/code-tool-sandbox/) — sandboxed code-tool execution.
- [harness-capabilities](projects/harness-capabilities/) — per-harness capability model.
- [model-config](projects/model-config/) — model selection config.
- [provider-model-auth](projects/provider-model-auth/) — provider/model/credential
  injection.
- [qa](projects/qa/) — manual QA matrix, findings, and regression-test skills.
- [runner-interface](projects/runner-interface/) — runner `/run` interface notes.
- [sdk-local-tools](projects/sdk-local-tools/) — standalone SDK tool resolution.
- [sidecar-deployment-proposal](projects/sidecar-deployment-proposal/) — sidecar to
  k8s/Helm + prod compose + Railway.
- [skills-config](projects/skills-config/) — skills configuration.
- [tool-resolution-layering](projects/tool-resolution-layering/) — SDK tool-resolution
  layering.
- [typescript-structure](projects/typescript-structure/) — TS runner structure and tests.
- [sandbox-agent-refactor](projects/sandbox-agent-refactor/) — sandbox-agent runner
  refactor plan.
- [research](projects/research/) — external-architecture research (e.g. OpenCode).

## scratch/

Status, open issues, PR-stack and branch-cleanup reports, meeting-alignment, the
implementation review, and the feature-matrix test report. Transient by design.
