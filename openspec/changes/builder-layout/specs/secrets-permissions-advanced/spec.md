## ADDED Requirements

### Requirement: Secrets section on the Agent tab

The Agent tab SHALL show Secrets as its own section after Skills, with the count "N attached". Each row SHALL show the environment variable and, under it, the name of the secret it reads. The section "+" SHALL open "Attach a secret". A click on a row SHALL open the same view to edit that attachment. Hover on a row SHALL show a remove action.

#### Scenario: Section with attachments
- **WHEN** the agent has three secret attachments
- **THEN** the Secrets section shows "3 attached" and the rows "BILLING_API_KEY" over "billing-prod", "GITHUB_TOKEN" over "my-github-token", and "CRM_TOKEN"

#### Scenario: Secrets left Advanced
- **WHEN** the user opens Advanced
- **THEN** Advanced has no secrets part

#### Scenario: Edit an attachment
- **WHEN** the user clicks the row "GITHUB_TOKEN"
- **THEN** the view "Attach a secret" opens with the secret and the variable filled in, and its main button reads "Save"

#### Scenario: Empty section
- **WHEN** the agent has no secret attachment
- **THEN** the section shows the production text "No custom secrets attached." and the "+"

#### Scenario: Loading
- **WHEN** the vault list is loading
- **THEN** the section shows the production loading state "Loading secrets"

#### Scenario: Long names
- **WHEN** a variable or a secret name is longer than the row
- **THEN** the text is cut at the end and the full text shows on hover

### Requirement: A row that needs setup

A row whose secret the server cannot find SHALL show the production tag "Needs setup" and, in place of the secret name, the production reason "Not found in this project". A click on the row SHALL open the edit view, where the user picks another secret.

#### Scenario: Missing secret
- **WHEN** the attachment "CRM_TOKEN" names a secret that is not in this project
- **THEN** the row shows "CRM_TOKEN", the line "Not found in this project" and the tag "Needs setup"

#### Scenario: Fix the row
- **WHEN** the user opens the row and picks an existing secret and clicks "Save"
- **THEN** the agent saves a new version with the new attachment, and the tag goes away

### Requirement: Attach a secret, the secret list

The view "Attach a secret" SHALL have a "Secret" select, an "Environment variable" field, "Cancel" and a main button. The select SHALL list the project secrets with the tag "Everyone" and the signed-in person's own secrets with the tag "Only me", and "Create new secret" as the last entry. The entry "Each person's own secret" SHALL NOT show. No owner switch SHALL follow the pick.

#### Scenario: Open the list
- **WHEN** the user opens the "Secret" select
- **THEN** it lists "billing-prod" with "Everyone", "github-bot" with "Everyone", "my-github-token" with "Only me", and "Create new secret" last

#### Scenario: Personal accounts off
- **WHEN** personal accounts are off for the deployment
- **THEN** the list holds only secrets with "Everyone" and "Create new secret"

#### Scenario: No secret yet
- **WHEN** the project has no text secret and the person has none
- **THEN** the view opens on "Create new secret", as production

#### Scenario: A request from the agent
- **WHEN** the view opens from an agent request for a named secret
- **THEN** the matching secret is picked and the variable is pre-filled, as production

#### Scenario: Vault refresh
- **WHEN** the view opens
- **THEN** it reloads the vault list first, so a secret made in another tab shows, as production

### Requirement: Attach a secret that everyone can use

When the user picks a secret tagged "Everyone", the view SHALL show only the secret and the environment variable. Every run SHALL use this value, whoever starts it.

#### Scenario: Pick a shared secret
- **WHEN** the user picks "billing-prod"
- **THEN** the select shows "billing-prod" with "Everyone", the variable becomes "BILLING_API_KEY", and no other field shows

#### Scenario: Attach
- **WHEN** the user clicks "Attach"
- **THEN** the agent saves a new version with the attachment `{secret: {slug: "billing-prod"}, binding: {type: "env", name: "BILLING_API_KEY"}}`, and the view goes back

### Requirement: Attach a secret that only you can use

When the user picks a secret tagged "Only me", the view SHALL show one line under the select: "Only you can use this secret. Other people pick their own secret when they run the agent." (not confirmed). "Attach" SHALL add an attachment that takes each person's own value, and SHALL store this person's account choice of the picked secret for this agent and this variable.

#### Scenario: Pick an own secret
- **WHEN** the user picks "my-github-token"
- **THEN** the line shows under the select and no owner switch shows

#### Scenario: Attach an own secret
- **WHEN** the user clicks "Attach"
- **THEN** the agent saves a new version with `{secret: {account_source: "user"}, binding: {type: "env", name: "GITHUB_TOKEN"}}`, and the person's account choice for this agent and "GITHUB_TOKEN" points at "my-github-token"

#### Scenario: Another person runs the agent
- **WHEN** another person runs the saved version
- **THEN** the run asks that person for their own secret for "GITHUB_TOKEN", as production does for "Each person's own secret"

#### Scenario: Account choice fails
- **WHEN** the account choice cannot be stored
- **THEN** the view shows the production error "Could not save your choice. Try again." and no version is saved

### Requirement: Create a new secret while attaching

When the user picks "Create new secret", the view SHALL show "Name", "Value" and "Who can use it". "Who can use it" SHALL be the same two-choice control as the account choice of an integration, with the production choices "Only me" ("You pick it when an agent asks for your own value.") and "Everyone in {project}" ("Builders can attach it to agents in this project."). The main button SHALL read "Save & attach".

#### Scenario: New secret for everyone
- **WHEN** the user fills Name and Value, picks "Everyone in {project}" and clicks "Save & attach"
- **THEN** the vault saves the project secret at once, and the agent saves a new version with an attachment to it

#### Scenario: New secret for me
- **WHEN** the user picks "Only me" and clicks "Save & attach"
- **THEN** the vault saves a person-owned secret at once, the person's account choice points at it, and the agent saves a new version with an attachment that takes each person's own value

#### Scenario: Personal accounts off
- **WHEN** personal accounts are off
- **THEN** "Who can use it" does not show and the new secret is a project secret, as production

#### Scenario: No right to create project secrets
- **WHEN** the person cannot edit project secrets and personal accounts are on
- **THEN** "Who can use it" does not show and the new secret is "Only me", as production

#### Scenario: Saved, not attached
- **WHEN** the vault save works and the attachment step fails
- **THEN** the view shows the production text "Saved in vault; not attached. {reason}" and keeps the saved secret picked so "Attach" can retry

#### Scenario: Attachment removed later
- **WHEN** the user later removes the attachment from the agent
- **THEN** the new secret stays in the vault

### Requirement: Environment variable rules

The "Environment variable" field SHALL show the production line "The agent receives this secret through the named variable." It SHALL refuse a name that is not letters, digits and underscores or that starts with a digit, and a name that another attachment of this agent already uses. The main button SHALL be disabled while the field is not valid.

#### Scenario: Invalid name
- **WHEN** the user types "1TOKEN"
- **THEN** the line becomes "Use letters, digits, and underscores; do not start with a digit." and the main button is disabled

#### Scenario: Name already used
- **WHEN** the user types a variable that another attachment already uses
- **THEN** the line becomes "This secret or environment variable is already attached." and the main button is disabled

#### Scenario: Suggested name
- **WHEN** the user picks a secret and has not typed a variable
- **THEN** the variable is filled from the secret's default variable or its name, as production

### Requirement: Attach saves a version as production

Attaching, editing or removing a secret attachment from the Agent tab SHALL save a new agent version at once through the production attach path, as production does today. While another change of the agent is not saved yet, the attach SHALL follow the production rule. Writes to the vault (a new secret) and to account choices SHALL apply at once, because they are not part of the agent version.

#### Scenario: Attach on a saved agent
- **WHEN** the agent has no change waiting to be saved and the user attaches a secret
- **THEN** a new version with the attachment is saved at once

#### Scenario: Attach while a change is not saved yet
- **WHEN** the user changed the instructions and attaches a secret before that change is saved
- **THEN** the attach follows the production rule (`agentCredentials.ts:96`), and no change is lost

#### Scenario: Agent never saved
- **WHEN** the agent has no saved version yet
- **THEN** the attach follows the production behavior for an agent with no version

### Requirement: Remove a secret attachment asks first

The remove action on a row SHALL open the production dialog "Remove this secret attachment?" with "The agent will lose access to this variable. The secret stays in the project vault.", "Cancel" and "Remove". After "Remove", the attachment SHALL leave the agent configuration, and a new version SHALL be saved. The secret SHALL stay in the vault.

#### Scenario: Remove
- **WHEN** the user clicks remove on "BILLING_API_KEY" and then "Remove"
- **THEN** the row leaves the section, and the agent saves a new version without the attachment

#### Scenario: Cancel
- **WHEN** the user clicks "Cancel"
- **THEN** nothing changes

### Requirement: Secret request in a running chat as production

When the agent asks for a secret during a run, the secret request dock in the chat SHALL keep its production behavior: it saves a new agent version on the variant head at once, because the run waits for it, and it keeps the production rule and text "Save or discard your agent changes first." while the agent has a change that is not saved.

#### Scenario: Agent asks for a secret
- **WHEN** a run asks for "GITHUB_TOKEN" and the user attaches a secret from the dock
- **THEN** a new version with the attachment is saved at once and the run can continue

#### Scenario: Request while a change is not saved
- **WHEN** a change of the agent is not saved yet and a run asks for a secret
- **THEN** the dock behaves as production, with the production text

#### Scenario: Head attachments changed
- **WHEN** the head's attachments differ from the ones the dock showed
- **THEN** the dock refuses and asks the person to review, as production

#### Scenario: Agent never saved
- **WHEN** the agent has no saved version
- **THEN** the dock refuses with the production reason, as production

### Requirement: No right to edit secrets

A person without the right to edit project secrets SHALL see the Secrets section read only, with the production text "You need permission to edit project secrets before you can change attachments." A viewer of the agent SHALL see the rows read only.

#### Scenario: No secret rights
- **WHEN** the person cannot edit project secrets
- **THEN** the "+", the row click and the remove action are disabled and the production text shows

### Requirement: Permission policy

The Permissions section SHALL show the policy inline as "Policy · {name}" with a select of the four production presets: "Allow reads" ("Reads run, writes ask"), "Allow all" ("Every tool runs without asking"), "Ask" ("A human approves every tool call") and "Deny all" ("Every tool call is refused"). A pick SHALL change the agent configuration at once, and the automatic save saves it.

#### Scenario: Pick a preset
- **WHEN** the user picks "Ask"
- **THEN** the section reads "Policy · Ask", and a new version is saved about 1500 ms later

#### Scenario: Schema without a policy
- **WHEN** the agent schema has no permission policy
- **THEN** the Permissions section does not show, as production

### Requirement: Advanced list

Advanced SHALL open a view that lists its parts, one row each: "Execution" with its summary (for example "Sandbox: Daytona") and "Agenta tools" with its summary (for example "Allow reads · 12 tools"). A row SHALL open its part as a child view. A part that does not apply to the agent SHALL NOT show.

#### Scenario: Open Advanced
- **WHEN** the user clicks the Advanced section
- **THEN** the view "Agent › Advanced" lists "Execution" and "Agenta tools"

#### Scenario: One sandbox
- **WHEN** the deployment offers only one sandbox
- **THEN** the "Execution" row does not show, as production

#### Scenario: Build kit
- **WHEN** the host shows the playground build kit
- **THEN** "Build kit" shows as one more row with today's body (not drawn)

### Requirement: Execution part

"Execution" SHALL open a child view with one "Sandbox" select and "Revert". A pick SHALL change the agent configuration at once, and the automatic save saves it. "Revert" SHALL put back the sandbox value as production does.

#### Scenario: Change the sandbox
- **WHEN** the user picks another sandbox
- **THEN** the configuration changes, a new version is saved about 1500 ms later, and "Revert" is active

#### Scenario: Revert
- **WHEN** the user clicks "Revert"
- **THEN** the sandbox goes back to the earlier value, as production, and the automatic save saves it

### Requirement: Agenta tools part

"Agenta tools" SHALL open a child view with today's body: the production line about where the tools run and that they are saved with the agent, "Default permission", search over the tools, the groups "Read-only" and "Write" with their counts, a permission per tool, "Cancel" and "Save". "Save" SHALL apply the form to the agent configuration, and the automatic save saves the version.

#### Scenario: Change one tool
- **WHEN** the user sets "Create a schedule" to "Allow" and clicks "Save"
- **THEN** the view goes back, and a new version with the change is saved about 1500 ms later

#### Scenario: Search
- **WHEN** the user types in "Search 12 tools"
- **THEN** the groups narrow to matching tools

#### Scenario: Leave with unsaved edits
- **WHEN** the user goes back with unsaved edits
- **THEN** the unsaved-changes dialog of the `agent-panel` capability opens
