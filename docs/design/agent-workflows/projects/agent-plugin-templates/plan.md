# Implementation plan

The work should land in small vertical slices. Each slice leaves the existing card and builder flow working until one package completes the new path.

## Package loader and compiler

Build the format without changing the product entry point.

### Scope

- Add a locally bundled Agent Plugins 1.0 manifest schema and MCP schema.
- Add closed Pydantic models for the `ai.agenta` extension.
- Load `extensions.ai.agenta.manifest`, enforce path containment, discover standard skills and MCP servers, and return isolated diagnostics.
- Validate graph references, skill names, MCP server names, workspace paths, and supported connection options.
- Compile one agent definition into the existing `AgentTemplateSchema` shape.
- Compile selected gateway, MCP, skill, and subagent declarations to their current native configuration types.
- Add the example package in this workspace as a parser and compiler fixture.

### Likely code areas

- New `api/oss/src/core/agent_plugins/` domain for package DTOs, validation, compilation, and service interfaces.
- New unit fixtures under `api/oss/tests/pytest/unit/agent_plugins/`.
- Existing SDK types remain the output contract. Do not add installation fields to `AgentTemplateSchema`.

### Acceptance

- The official `plugin.json` and `mcp.json` examples pass the bundled Agent Plugins 1.0 schemas.
- The example package validates.
- Missing references, path escapes, raw credential values, unsupported required MCP transports, and unknown extension fields fail with precise diagnostics.
- The compiler emits valid current agent configuration without project connection slugs when no binding exists.

## Idempotent installation

Create the package resources through current domain services.

### Scope

- Add package snapshot and installation persistence, including content digest, stable step keys, resource mappings, dispositions, and errors.
- Add a create endpoint with an idempotency key and a status endpoint.
- Import skills through `SkillsService`.
- Create all workflows through `SimpleWorkflowsService` before linking them.
- Copy declared workspace entries through `MountsService`.
- Resolve subagent links in a second pass and commit final initial revisions.
- Compile any preselected verified connection bindings.
- Persist automation recipes without activation.
- Reconcile partial creates by recorded identifiers.

### Likely code areas

- `api/oss/src/core/agent_plugins/` service and interfaces.
- `api/oss/src/apis/fastapi/agent_plugins/` router.
- PostgreSQL DAO and migrations in the existing OSS and EE database layouts.
- A TaskIQ worker entry for resumable installation steps, following the current worker composition rather than an in-process FastAPI background task.

### Acceptance

- One request creates the expected agents, skills, files, and links.
- Mutual agent links compile without recursive creation.
- Repeated requests, request timeout, API restart, and worker restart do not duplicate resources.
- A partial file or workflow failure resumes from the recorded step.
- No active schedule or subscription exists after installation alone.

## Setup session and scoped operations

Let the entry agent finish user-specific setup without a hidden-message subsystem.

### Scope

- Associate one setup session with an installation.
- Extend `SessionContext` with optional package setup context.
- Extend the existing server-side session-context read to include active installation guidance.
- Render the setup section into current `turnContext`.
- Persist the visible greeting through the normal session input path.
- Add the installation-scoped setup operations listed in [installation-flow.md](installation-flow.md).
- Gate ordinary runs until installation readiness while allowing the setup session and explicit verification calls.
- Remove setup tools and context after readiness or cancellation.

### Likely code areas

- `api/oss/src/core/sessions/context.py` and the HTTP reads used by the agent service.
- `sdks/python/agenta/sdk/agents/dtos.py`, `platform/session_context.py`, and `platform_instructions.py`.
- `api/oss/src/core/workflows/build_kit.py` or a sibling setup overlay builder.
- Agent Plugin service handlers for scoped setup operations.

### Acceptance

- `SETUP.md` and `setup_notes` reach every active setup turn.
- They never appear as user bubbles, transcript records, notifications, or search snippets.
- A browser cannot forge setup scope through request metadata.
- The greeting appears once after refresh or retry.
- The root agent can configure only resources mapped to its installation.
- Backend validation, not model prose, decides readiness.

## Runtime recursion protection

Support mutual links safely.

### Scope

- Add a workflow call-chain field to internal callback dispatch context.
- Append the target workflow before callback execution.
- Reject repeated workflow identifiers and excessive depth.
- Preserve the field across runner callback relay and server-side workflow dispatch.
- Keep it internal. Do not expose it as author configuration.

### Likely code areas

- SDK workflow-reference tool resolution and callback metadata.
- Runner callback executor and relay.
- API workflow tool-call dispatch.

### Acceptance

- `A -> B` succeeds.
- A separate future `B -> A` succeeds.
- Synchronous `A -> B -> A` returns `recursive_agent_call` without starting the second A run.
- A long acyclic chain stops at the configured depth with `agent_call_depth_exceeded`.

## Frontend adoption

Replace template-specific builder seeds one package at a time.

### Scope

- Add package catalog summary and installation API clients to shared entities.
- Generate the card detail data from package summaries while preserving current analytics keys.
- Show connection slots with gateway and MCP choices.
- Call the installation endpoint from web and mobile template creation.
- Open the returned setup session and render installation progress.
- Keep free-text Create agent on the current builder path.
- Keep the old `AgentStarterTemplate` registry as a compatibility source until all cards have packages.

### Likely code areas

- `web/packages/agenta-entities/src/workflow/` for catalog and installation state.
- `web/packages/agenta-home-ui/` for shared create behavior.
- Web and mobile onboarding surfaces that currently call `agentTemplateSeed` or append the setup preamble.
- The current `firstRunSeed` path remains for free-text creation, not package installation.

### Acceptance

- A package card previews every created agent and declared requirement.
- Optional connection slots never block Create.
- One selected gateway account and one selected MCP option produce distinct correct bindings.
- Refreshing the page resumes the same installation and session.
- Free-text agent creation behaves as it does today.

## Repository and archive sources

Add distribution after the bundled path is stable.

### Scope

- Import a repository URL with an immutable resolved revision and package path.
- Import an uploaded archive with extraction limits and path containment.
- Store the same validated snapshot shape used by bundled packages.
- Expose import diagnostics before installation.
- Add export only after the package ownership and redaction rules have tests.

### Acceptance

- Bundled, repository, and archive sources with identical content produce the same digest and compiled definitions.
- A repository branch update does not mutate an existing snapshot or installation.
- Archives reject path traversal, symlink escapes, excessive file counts, and excessive expanded size.
- Exports omit credentials, project connection identifiers, sessions, and unselected user files.

## Test strategy

### Schema and loader tests

- Published Agent Plugins examples.
- Missing and unknown core fields.
- Unknown extension namespace versus invalid implemented namespace.
- Skill and MCP component failure isolation.
- Filesystem path and symlink containment.
- Unsupported transport handling.

### Compiler tests

- AGENTS.md to current instruction shape.
- Gateway and MCP alternatives.
- Optional skipped connection.
- Pinned skill embeds.
- Two-pass mutual subagent links.
- Automation recipes remain inactive.

### Service tests

- Idempotent repeated Create.
- Failure and restart after each step type.
- Concurrent Create with the same idempotency key.
- Revision conflict during setup.
- File changed after initial copy.
- Connection callback, decline, and resume.

### End-to-end tests

- Create the example package without a model and inspect all resources.
- Resume setup with a missing gateway account.
- Choose the MCP alternative and bind a header secret through secure UI.
- Decline the optional schedule and complete setup.
- Refresh during setup and confirm one greeting and one session.
- Exercise mutual links and recursion rejection.

## Rollout

Start with one internal Outbound Prospecting package behind a server-side feature flag. Compare install completion, time to first useful run, setup retries, and support errors against the current builder path. Convert other cards only after the first package passes the retry and setup tests.

Do not delete the builder playbooks in this project. They remain useful for free-text agent creation and as migration source material.
