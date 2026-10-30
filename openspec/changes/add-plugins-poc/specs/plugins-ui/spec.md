## ADDED Requirements

### Requirement: Plugins in the navigation
The web app (`web/mobile`) SHALL show a "Plugins" navigation item right after "Agents" that opens `/plugins`.

#### Scenario: Opening the list
- **WHEN** a member clicks "Plugins"
- **THEN** a screen titled "Plugins" lists every plugin in the project in the same list frame as the Agents screen, with name, creator and last change

#### Scenario: Empty project
- **WHEN** the project has no plugins
- **THEN** the screen shows an empty state that says no plugins exist yet

### Requirement: Plugins are not agents
Plugins SHALL NOT appear in agent lists or agent pickers.

#### Scenario: Agents screen
- **WHEN** a project has one agent and one plugin
- **THEN** the Agents screen lists only the agent

### Requirement: Plugin screen
Opening a plugin SHALL render its `parameters.plugin.ui.html` inside the existing drive frame wrapper and give the page `window.agenta.plugin.call(operation, args)`, which runs the operation as the signed-in viewer and resolves with its output.

#### Scenario: Button runs an operation
- **WHEN** the page calls `agenta.plugin.call("my_open_issues", {})`
- **THEN** the parent posts a batch invoke to the plugin's services URL with the displayed revision reference and the viewer's auth, and the promise resolves with `data.outputs`

#### Scenario: Operation fails
- **WHEN** the invoke returns an error
- **THEN** the promise rejects with the error message

#### Scenario: Page isolation
- **WHEN** the plugin page runs
- **THEN** it cannot read the parent page, its cookies or storage, cannot navigate its frame away, and holds no Agenta credential
