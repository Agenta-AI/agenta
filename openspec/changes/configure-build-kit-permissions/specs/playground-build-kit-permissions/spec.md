# Playground build kit permissions

## Purpose

Let the person building an agent in the playground decide, per tool, whether the assistant may use a build kit tool without asking, must ask, or cannot use it. Default to allowing everything.

## ADDED Requirements

### Requirement: Allow every build kit tool by default

The build kit overlay SHALL give every platform tool it ships the permission `allow`. This SHALL include `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription` and `apply_skill_update`. A person who has made no choice SHALL get the Allow all setting.

#### Scenario: Assistant creates a schedule with default settings

- **WHEN** a person who has not changed the build kit permissions asks the assistant in the playground to set up a daily schedule
- **THEN** the assistant calls `create_schedule` and the call runs without an approval card.

#### Scenario: Assistant removes a subscription with default settings

- **WHEN** the assistant calls `remove_subscription` in a playground run with default build kit settings
- **THEN** the call runs without an approval card.

#### Scenario: Existing stored state without permission choices

- **WHEN** a browser has build kit state saved before this change, with only the kit on/off switch and switched-off tools
- **THEN** switched-off tools stay deactivated, the kit on/off value is kept, and every other tool uses `allow`.

### Requirement: Offer a kit-level permission choice

The Build kit panel SHALL offer a kit-level choice with exactly these options: Allow all, Allow reads, Ask all and Deactivate. Picking Allow all, Allow reads or Ask all SHALL turn the kit on, clear every per-tool permission choice and reactivate every deactivated tool. Allow reads SHALL mean read-only tools use `allow` and write tools use `ask`. Deactivate SHALL turn the whole kit off, the same as the current master switch off. When any per-tool choice differs from what the kit-level choice implies, the selector SHALL read back as Custom, with the number of differing tools. Custom SHALL be shown but SHALL NOT be pickable.

#### Scenario: Pick Allow reads

- **WHEN** the person picks Allow reads
- **THEN** every read-only tool shows Allow, every write tool shows Ask, and the next playground run sends those permissions.

#### Scenario: Pick Ask all after customizing

- **WHEN** the kit reads back as Custom with two deactivated tools and the person picks Ask all
- **THEN** every tool shows Ask, no tool is deactivated, and the selector shows Ask all.

#### Scenario: Pick Deactivate

- **WHEN** the person picks Deactivate
- **THEN** the next playground run receives no build kit tools, skills or sandbox permissions, and the panel shows that the assistant can no longer create files, run code or edit the agent here.

#### Scenario: One tool differs

- **WHEN** the kit is on Allow all and the person sets `create_schedule` to Ask
- **THEN** the selector reads Custom with one override.

### Requirement: Offer a per-tool permission choice

Each switchable build kit tool SHALL have a per-tool control with exactly these options: Allow, Ask and Deactivate. Allow SHALL send permission `allow` for that tool. Ask SHALL send permission `ask`. Deactivate SHALL remove the tool from the run. The per-tool controls SHALL be disabled while the kit is deactivated. The Agenta-owned tools and skills that are always part of the kit SHALL be listed as locked rows without a control.

#### Scenario: Set one tool to Ask

- **WHEN** the person sets `create_subscription` to Ask and then asks the assistant to react to new GitHub issues
- **THEN** the `create_subscription` call shows an approval card, and other tools still run without asking.

#### Scenario: Deactivate one tool

- **WHEN** the person sets `remove_schedule` to Deactivate
- **THEN** the next playground run does not include `remove_schedule` in the tool list.

#### Scenario: Locked rows

- **WHEN** the person opens the Build kit panel
- **THEN** `request_connection`, `request_input`, `request_secret` and the kit's skills appear as locked rows with no permission control.

### Requirement: Group tools into write and read-only sections

The Build kit panel SHALL list switchable tools in two sections, Write and Read-only, each with a tool count. A tool SHALL be in Read-only exactly when its platform op catalog entry has `read_only=True`. The backend SHALL send this classification with the build kit overlay. The frontend MUST NOT keep its own copy of the classification.

#### Scenario: Automation tools are writes

- **WHEN** the person opens the Build kit panel
- **THEN** `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription` and `test_subscription` appear under Write, and `list_schedules`, `list_subscriptions`, `list_deliveries` and `discover_triggers` appear under Read-only.

#### Scenario: A new op is added to the kit

- **WHEN** a developer adds a read-only platform op to the build kit
- **THEN** it appears under Read-only without a frontend change.

### Requirement: Reuse the integration permission drawer layout

The Build kit panel SHALL render through the same body component as the integration permission drawer. The panel SHALL have the same default permission selector, grouped sections, per-tool rows and search. The Advanced drawer SHALL open at the integration drawer width.

#### Scenario: Width matches

- **WHEN** the person opens the Advanced drawer and then an integration permission drawer
- **THEN** both drawers have the same width.

### Requirement: Persist choices and apply them to every build kit run

The build kit permission choices SHALL be stored with the existing build kit UI state for the agent in the browser. The playground run request and the agent-template loader SHALL apply the same choices, producing the same tool list and the same permission on every tool. A choice for an op that the overlay no longer ships SHALL be ignored.

#### Scenario: Reload keeps choices

- **WHEN** the person sets `create_schedule` to Ask and reloads the page
- **THEN** `create_schedule` still shows Ask.

#### Scenario: Template load applies choices

- **WHEN** the person sets `create_schedule` to Ask and loads an agent template whose first message sets up a schedule
- **THEN** the first run from the template loader shows an approval card for `create_schedule`.

#### Scenario: Stale op

- **WHEN** stored state names an op that the current overlay does not ship
- **THEN** the run request does not add that op and does not fail.

### Requirement: Keep model-facing text true under any setting

Tool descriptions and build kit skill text MUST NOT state that a build kit tool always requires approval. They SHALL say that a call may need the person's approval depending on the agent's permissions.

#### Scenario: Schedule description

- **WHEN** the model reads the `create_schedule` tool description
- **THEN** the description does not contain "Requires approval".

### Requirement: Leave published agents unchanged

The change MUST NOT change the permissions of published agents, scheduled runs or channel runs. The build kit and its choices SHALL remain playground-only and SHALL NOT be written into a committed revision.

#### Scenario: Commit after customizing

- **WHEN** the person sets several build kit tools to Ask and commits the agent
- **THEN** the committed revision contains no build kit tools and no build kit permission choices.

### Requirement: Agent-scoped policy survives commits

The browser SHALL store one build-kit policy per project and agent artifact, not per revision. Manual and assistant commits, revision switches and reloads SHALL preserve that policy. Different agents SHALL remain independent. Staged choices SHALL transfer once when creating an agent. Legacy revision settings SHALL import when opened only if no agent policy exists. Unknown agent identity SHALL NOT cause a shared empty-key write.

#### Scenario: Commit after choosing Ask

- **WHEN** a person sets `create_schedule` to Ask and either the person or assistant commits a new revision
- **THEN** the new revision and older revisions of the same agent still use Ask.

#### Scenario: Legacy record cannot replace agent policy

- **WHEN** an older revision has legacy Allow settings but the agent already has Ask settings
- **THEN** opening the older revision preserves Ask.

#### Scenario: New agent from staging

- **WHEN** a staged agent has customized permissions and is created normally or from a template
- **THEN** its first run and subsequent revisions keep those permissions.

#### Scenario: Independent agents

- **WHEN** a person changes one agent's policy
- **THEN** another agent's policy is unchanged.

### Requirement: Permission gates do not add a conversational confirmation

For an already specified build-kit action, platform instructions SHALL rely on the configured permission gate rather than require another conversational confirmation. Human-input and credential forms SHALL remain independent.

#### Scenario: Allowed schedule creation

- **WHEN** the person supplies a complete schedule request and `create_schedule` is allowed
- **THEN** the assistant creates it without a second confirmation question or approval card.

#### Scenario: Missing schedule information

- **WHEN** the person requests a schedule but omits information only they can provide
- **THEN** the assistant can still use `request_input` to collect it.
