# Installation and setup

## User flow

1. The user opens a package detail view and sees its agents, connection choices, skills, MCP servers, files, and automation recipes.
2. Desktop asks for required connections before Create. Mobile starts installation on Create and asks in the returned session before Continue. Both save verified account choices and disclosed optional skips through the backend.
3. Agenta installs the declared local resources and opens the entry agent's setup session.
4. After the connection gate, the entry agent asks only for unresolved choices and user-specific facts.
5. Agenta verifies the declared requirements and marks the installation ready.

See [onboarding integration](onboarding-integration.md) for card reuse, account identity, and the distinction between connection gates and installation readiness. [Validation and acceptance](validation.md) defines the product and code-level checks.

Create means “install this package snapshot.” It does not grant every external permission requested by the package. Credential collection, external writes, and automation activation keep their current approval boundaries.

## Import and validation

The API loads `plugin.json` and validates it against the locally bundled Agent Plugins 1.0 schema. It discovers standard skills and `mcp.json` from their fixed locations. It then reads `extensions.ai.agenta.manifest` and validates the Agenta extension.

Validation covers:

- filesystem-resolved containment for every package path;
- Agent Plugins version support;
- extension version support;
- unique agent, connection, subagent, automation, and workspace keys;
- an existing entry agent;
- valid agent references, including cycles;
- valid skill and MCP server references;
- supported runtime configuration fields;
- at least one supported option for each required connection;
- no credentials or project resource identifiers in package content;
- no declared automatic startup files in copied workspaces.

A valid import produces an immutable snapshot and content digest. Installation never reads a changing repository branch directly.

## Resource creation

The installation service records the full step plan before it writes resources. Each step has a deterministic key within the installation. A retry reads the step record before it writes.

The service then performs these passes:

### Create skills and workflows

- Import every referenced skill through `SkillsService` and record its revision.
- Create one workflow for every agent key through `SimpleWorkflowsService`.
- Set the agent name, `AGENTS.md`, supported execution configuration, and pinned skill references.
- Do not add unresolved gateway or credential references to runtime configuration.

`SimpleWorkflowsService.create` performs several writes. The installation record must not treat a returned workflow as proof that every variant and revision step completed. It records each confirmed identifier and reconciles failures by identifier, never by display name.

### Copy workspace entries

For each agent, call `MountsService.get_or_create_agent_mount`. Copy declared files and create declared folders through the mounts service. Record the source hash and the result.

A retry writes a missing file. It does not overwrite a file whose current content differs from the previously copied package hash. That difference means a person or setup turn changed the file.

### Link agents

After every workflow slug exists, compile each subagent declaration to a workflow reference tool and commit the parent revision. This second pass supports shared children and mutual links.

The compiler uses the created workflow slug as the real tool identity. Package keys remain installation addresses and do not pretend to be runtime tool names.

### Compile selected connections

For a gateway option with a verified selected account, emit `GatewayConnectionToolConfig` with the saved connection slug and declared policy.

For a supported MCP option, map the standard Streamable HTTP declaration to the native HTTP MCP configuration. Bind public headers directly. Bind declared credential requirements to target-project secret references. Do not copy secrets into the package, installation, revision, transcript, or trace.

Unresolved optional and required choices remain installation requirements. They do not become invalid runtime entries.

### Record automation recipes

Persist each declared recipe under its stable agent and automation keys. Do not activate a schedule or subscription during resource creation. The setup agent configures and activates it after user approval.

## Setup conversation

The setup session uses the normal agent conversation path.

The transcript stores this visible first user message once:

> Hi Outbound Prospecting. Please setup yourself

The existing session-context resolver also reads an active installation by session ID. When it finds one, it adds a setup section to `SessionContext` containing:

- the current agent key and package name;
- that agent's `SETUP.md`;
- grouped `setup_notes` for connections, subagents, workspace entries, and automations;
- selected bindings;
- unresolved required and optional items;
- the model-visible names of created child tools.

The SDK renders that section into `turnContext`. The runner already receives `turnContext` separately from chat messages. The frontend does not need a hidden-message convention, and the package text does not enter platform system instructions.

The backend derives setup context from the session and installation. It ignores a client-supplied setup section. When the installation becomes ready or cancelled, the resolver stops adding it.

## Installation-scoped setup operations

The entry agent needs a small set of operations bound to the active installation:

- `read_template_installation`: read current requirements, dispositions, and created resource references.
- `bind_template_connection`: bind a verified account or secret reference to one declared agent connection option.
- `commit_template_agent`: apply permitted configuration changes to one installation-owned agent with an expected base revision.
- `write_template_file`: write a declared installation-owned file with an expected content hash.
- `configure_template_automation`: fill declared schedule or event fields and request activation through the existing approval path.
- `complete_template_setup`: ask the backend to validate readiness and mark the installation ready.

Each operation receives package-local keys. The server resolves real project identifiers from the installation. The model cannot target another workflow, mount, connection requirement, or trigger by supplying its identifier.

Normal self-configuration remains self-scoped. These extra operations appear only in the active setup session and disappear when setup ends.

## Setup behavior

The entry agent follows this order:

1. Read installation state.
2. Resolve required items before optional items.
3. Use existing account and secret UI for credentials.
4. Re-read connection state after any callback.
5. Apply user-specific changes to itself or declared children.
6. Run safe checks under each target agent's normal tool policy.
7. Show automation timing, filters, target agent, account, and expected external effect before activation.
8. Call `complete_template_setup` and report the backend result.

A model statement cannot mark setup complete. The backend checks required connection dispositions, agent revisions, initial file copies, skill references, and required automation dispositions.

## Readiness and direct runs

While installation status is `installing`, ordinary direct runs and subagent calls return `installation_incomplete`.

While status is `setup`, only the bound setup session and setup-scoped verification calls may run. A verification call uses the target agent's normal permission policy and records its installation scope.

When status is `ready`, the agents run as ordinary editable workflows. The setup operations and setup context disappear. The installation mapping remains for support and future update review.

## Runtime call-cycle guard

A package may link agents in both directions. A run may not recurse through the same agent within one synchronous call chain.

The workflow callback path propagates an ordered list of workflow identifiers. Before dispatch, it rejects a target already present in that list. It also rejects a chain longer than the configured maximum. The error names the cycle or depth condition and returns control to the calling agent.

Independent future runs remain valid. Researcher can call Outbound when Researcher starts from a user task, even if Outbound called Researcher in an earlier completed run.

## Recovery

- **Repeated Create:** reuse the installation idempotency key and return the existing installation.
- **Workflow failure:** reuse confirmed workflow identifiers and continue missing steps.
- **File failure:** retry only missing or unchanged destinations.
- **Connection decline:** record `skipped` for an optional requirement or `blocked` for a required requirement. Do not ask again until the user resumes it.
- **Revision conflict:** return the current revision and require the setup agent to re-read before another commit.
- **Trigger timeout:** query by stable recipe key and provider identity before retrying creation.
- **Cancellation:** stop setup and keep triggers inactive. Removing created resources is a separate confirmed action. Never revoke a reused project connection.

## Ownership

| Owner                                                                              | Responsibility                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend                                                                           | Browse package summaries, preview requirements, select existing accounts, submit one installation request, and open the returned setup session. |
| Agent Plugins service in API                                                       | Load, validate, snapshot, install, reconcile, and expose installation-scoped setup operations.                                                  |
| Existing workflow, skill, mount, connection, secret, trigger, and session services | Own their current resources and validation.                                                                                                     |
| Agent service and SDK                                                              | Resolve trusted setup context and render it into per-turn context.                                                                              |
| Runner and workflow callback path                                                  | Execute the agent and enforce call-chain recursion limits.                                                                                      |
| Entry agent                                                                        | Resolve conversational choices and propose approved activation.                                                                                 |

The new domain coordinates existing services. It does not reimplement their storage or provider logic.
