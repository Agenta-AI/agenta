## ADDED Requirements

### Requirement: Views of the model flow

The model flow SHALL use the view contract of the `agent-panel` spec. The Model view SHALL have `apply: "immediate"` and the target `agent_draft`. The Model providers list, the add view, the provider forms and the subscription steps SHALL have the target `project`; a provider form SHALL have `apply: "on_save"`. Each view SHALL report its own title with `useViewTitle`. A host that keeps a drawer SHALL wrap the view in `DrawerViewChrome`.

#### Scenario: The Model view has Done
- **WHEN** the user opens Agent › Model in the right panel
- **THEN** the view shows "Done" and no "Cancel" or "Save", and a pick needs no second click

#### Scenario: Model providers from the Model view
- **WHEN** the user clicks "Manage model providers" in the Model view of the panel
- **THEN** the Model providers view replaces the Model view at depth 1 with the target `project`, and the breadcrumb reads "Agent › Model providers"
- **AND** no question is asked, because the Model view has no unsaved form

#### Scenario: A provider form at depth 2
- **WHEN** the user clicks "Edit" on "OpenAI" in the Model providers view of the panel
- **THEN** the OpenAI form opens at depth 2, and the breadcrumb reads "Agent › Model providers › OpenAI" with "OpenAI" from `useViewTitle`

#### Scenario: A form chosen in the add view
- **WHEN** the user picks "OpenAI" or "ChatGPT" in "Add a provider or subscription" at depth 2
- **THEN** the form or the sign-in steps show as the next step of the same view, because the stack holds two levels, and the crumb title becomes "OpenAI" or "ChatGPT"

#### Scenario: Settings
- **WHEN** the user opens Settings › AI providers
- **THEN** the provider list is the root of the Settings container, and the add view and the forms open at depth 1 with the target `project`

#### Scenario: Run error drawer
- **WHEN** the run error drawer opens the provider form
- **THEN** the drawer host wraps the same form view in `DrawerViewChrome`

### Requirement: Model picker as one grouped list

The Model view SHALL show one list of models grouped by connection, in this order: "Agenta" with the tag "Built-in", then API key connections, then subscriptions. Each row SHALL show the readable model name with the raw id under it. A pick SHALL change the agent configuration at once, and auto-save SHALL save it as a new version, as production does. "Manage model providers" SHALL be a full-width button fixed at the bottom of the view.

#### Scenario: Pick a model
- **WHEN** the user opens Agent › Model and clicks "Claude Sonnet 5.5" under "Anthropic"
- **THEN** the agent model becomes `claude-sonnet-5-5` on that connection
- **AND** auto-save saves it as a new version shortly after, and the header shows the new "Saved as vN"

#### Scenario: Groups and their tags
- **WHEN** the project has the built-in models, an Anthropic organization connection, an OpenAI connection, a ChatGPT subscription and a Claude subscription that needs a new sign-in
- **THEN** the list shows the groups "Agenta" with "Built-in", "Anthropic" with "Organization", "OpenAI", "ChatGPT subscription" with "Subscription" and "Claude subscription" with "Subscription"
- **AND** each group shows the harness line "via Claude Code", "via Pi" or "via Codex" above its models
- **AND** the Claude group shows "Sign in needed" and a "Sign in" button instead of models

#### Scenario: Search with no result
- **WHEN** the user types a search that matches no model
- **THEN** the list shows the production empty text "No data"

#### Scenario: Loading
- **WHEN** the connections are still loading
- **THEN** the view shows the production line "Loading models…"

#### Scenario: Nothing connected
- **WHEN** no connection, no built-in model and no subscription has a model
- **THEN** the view shows the production button "Set up model providers", which opens Model providers

### Requirement: Model providers list screen

The Model providers view SHALL list only what the project has: the "Agenta" row first with the tag "Built-in" and no heading above it, then the group "Subscriptions", then the group "API keys". Each row SHALL have an outlined "Edit" button. A row SHALL show a state only when something needs attention. The one primary action SHALL be "Add a provider or subscription", full width and fixed at the bottom.

#### Scenario: The configured list
- **WHEN** the project has the built-in models, a ChatGPT subscription, a Claude subscription that needs a new sign-in, and Anthropic and OpenAI keys
- **THEN** the view shows "Agenta" with "Built-in" and "Edit", "Subscriptions" with "ChatGPT" and "Claude", and "API keys" with "Anthropic" and "OpenAI"
- **AND** the Claude row shows "Sign in needed" and "Sign in again" in place of "Edit"
- **AND** a healthy row shows no "Connected" tag

#### Scenario: Only the built-in row
- **WHEN** the project has no connection and no subscription
- **THEN** the view shows the "Agenta" row and the button "Add a provider or subscription"

#### Scenario: No built-in models on this deployment
- **WHEN** the deployment has no built-in models (a self-hosted deployment without Agenta's own provider account)
- **THEN** the "Agenta" row does not show

#### Scenario: A row opens its form
- **WHEN** the user clicks "Edit" on "OpenAI"
- **THEN** the OpenAI connection form opens as a child view of the list, with its title "OpenAI" in the breadcrumb

#### Scenario: Loading and error
- **WHEN** the list is loading
- **THEN** the view shows skeleton rows in the same layout
- **WHEN** the list fails to load
- **THEN** the view says in plain words that the list could not load and shows "Try again"

### Requirement: Add a provider or subscription screen

"Add a provider or subscription" SHALL open a view that lists, in this order: the group "Use a subscription" with "ChatGPT" and "Claude", then the group "Use an API key" with a "Search providers" field, the 16 production providers in production order, and "OpenAI-compatible endpoint" last with its production hint. A click on a row SHALL open its form or its sign-in steps.

#### Scenario: The full list
- **WHEN** the user clicks "Add a provider or subscription"
- **THEN** the view lists ChatGPT, Claude, then OpenAI, Mistral AI, Cohere, Anthropic, Anyscale, Perplexity AI, DeepInfra, Together AI, OpenRouter, Groq, Google Gemini, MiniMax, xAI, AWS Bedrock, Azure OpenAI, Google Vertex AI and "OpenAI-compatible endpoint" with "Self-hosted or proxied models that speak the OpenAI API"

#### Scenario: Search with no match
- **WHEN** the user types a search that matches no provider
- **THEN** the view shows the production text "No provider matches this search."

#### Scenario: Return after a save
- **WHEN** the user saves a new connection from a form opened here
- **THEN** the view goes back to the Model providers list and the new row shows in its group

### Requirement: Provider form layout and the Name field

Every provider form SHALL show its fields in this order: "Name", the credential fields, "Active models", "Harnesses", then "Cancel" and "Save connection". "Name" SHALL be first, required and pre-filled with the provider name, with a number added when that name is taken ("OpenAI 2"). Before the key check passes, "Active models" and "Harnesses" SHALL not show; one line says what comes next.

#### Scenario: A new OpenAI form
- **WHEN** the user opens OpenAI from the add list and the project already has a connection named "OpenAI"
- **THEN** "Name" reads "OpenAI 2", the "API key" field has the tag "Encrypted at rest" and the placeholder "Paste your OpenAI API key"
- **AND** the form shows "Agenta checks the key as soon as you paste it." and "Next: choose the models. This part shows when the key works."
- **AND** "Save connection" is disabled

#### Scenario: Name cleared
- **WHEN** the user clears "Name"
- **THEN** "Save connection" is disabled until "Name" has text

#### Scenario: A form with several credential fields
- **WHEN** the form is Azure OpenAI, AWS Bedrock, Google Vertex AI or OpenAI-compatible endpoint
- **THEN** a dashed box under "Active models" shows the production text "Enter the credential above to choose which {provider} models this connection offers."

### Requirement: Automatic key check

The form SHALL start the key check by itself when the user pastes a key, when the key field loses focus after typing, and when the last required credential field of a multi-field form is filled. While it runs, one progress line SHALL sit right under the field with "Stop". A new edit of a credential field SHALL drop the previous result. The check SHALL never send a generation request.

#### Scenario: Paste starts the check
- **WHEN** the user pastes a key into "API key"
- **THEN** the line "Checking the key with OpenAI…" and the link "Stop" show right under the field
- **AND** "Save connection" stays disabled

#### Scenario: Leaving the field starts the check
- **WHEN** the user types a key and moves the focus out of the field
- **THEN** the check starts as on paste

#### Scenario: Stop
- **WHEN** the user clicks "Stop" while the check runs
- **THEN** the form drops the answer of that check, the progress line goes away, and the field keeps the typed key
- **AND** a paste, a blur after an edit, or "Check again" starts a new check

#### Scenario: An edit during a check
- **WHEN** the user edits the key while a check runs
- **THEN** the running check is dropped and a new one starts on the next paste or blur

#### Scenario: No duplicate check
- **WHEN** the key field loses focus and the key did not change since the last finished check
- **THEN** no new check starts

### Requirement: Key works

When the key check answers `valid` and the discovery status is `fetched`, the form SHALL show "The key works. Agenta found N models.", show "Active models" with the recommended models already checked, show "Harnesses", and enable "Save connection".

#### Scenario: The models are here
- **WHEN** the OpenAI check answers `valid` with 42 models
- **THEN** the form shows "The key works. Agenta found 42 models." and "Active models · 3 of 42" with "Select all" and "Clear"
- **AND** "GPT-5.5", "GPT-5.5 mini" and "GPT-5.6 Sol" are checked and carry "Recommended"
- **AND** under the list the line reads "List updated just now ·" with "Update"
- **AND** "Save connection" is enabled

#### Scenario: Update the list
- **WHEN** the user clicks "Update" next to the list
- **THEN** the form runs the probe again without touching the key field and keeps the user's checked models that are still in the list

#### Scenario: The key works but the list did not come back
- **WHEN** the check answers `valid` and the discovery status is `failed`
- **THEN** the form shows Agenta's shipped model list for that provider with its recommended models checked, and "Save connection" is enabled

### Requirement: Key rejected

When the check answers `invalid`, the form SHALL show the message next to the key field with "Check again", SHALL keep "Active models" and "Harnesses" hidden, and SHALL keep "Save connection" disabled. Nothing is saved.

#### Scenario: OpenAI rejects the key
- **WHEN** the OpenAI check answers `invalid`
- **THEN** the form shows "OpenAI did not accept this key. Check that you copied all of it, then paste it again." and "Check again" under the field
- **AND** the line "Next: choose the models. This part shows when the key works." stays

#### Scenario: Check again
- **WHEN** the user clicks "Check again"
- **THEN** the check runs again with the same key and shows the progress line

### Requirement: Key that cannot be proved

When the check answers `unknown`, the form SHALL show the reason in plain words, SHALL show "Active models" with Agenta's shipped list and the typed-id field, and SHALL enable "Save connection". This covers providers with no free credential check, Google Vertex AI, AWS Bedrock access keys, an endpoint that answers without a key, and a check that ran out of time.

#### Scenario: A provider with no free check
- **WHEN** the user pastes a MiniMax key
- **THEN** the form says the key is saved untested, with the production text "This provider offers no free credential check, so the key is saved untested."
- **AND** "Save connection" is enabled

#### Scenario: The check ran out of time
- **WHEN** the provider does not answer within the probe's time limit
- **THEN** the form says that Agenta could not reach the provider in time, shows "Check again", and enables "Save connection"

### Requirement: Edit an existing connection

Opening a saved connection SHALL show its saved name, its saved active models and its harnesses at once, and SHALL refresh the model list in the background with the stored key, without the browser sending the key. The key field SHALL be blank; blank keeps the key. A new key SHALL be checked as in the add form. Delete SHALL stay in Settings › AI providers.

#### Scenario: Open an existing connection
- **WHEN** the user clicks "Edit" on "OpenAI"
- **THEN** the form shows "Name" "OpenAI", the field "Replace key" with "Paste a new key to replace sk-••••f2K" and "Leave blank to keep the key."
- **AND** "Active models · 3 of 42" shows the saved choice at once
- **AND** the line under the list reads "Updating the list…" and then "List updated just now ·" with "Update"

#### Scenario: The provider cannot be reached when the connection opens
- **WHEN** the background refresh answers with discovery `failed` or the request fails
- **THEN** the saved list and the saved choice stay as they are
- **AND** one line under the list says that the provider could not be reached, with "Update" to try again
- **AND** "Save connection" stays enabled, because the stored key did not change

#### Scenario: The stored key is no longer accepted
- **WHEN** the background refresh answers `invalid` for the stored key
- **THEN** the message shows next to the key field as in "Key rejected", and the saved list stays

#### Scenario: Replace the key
- **WHEN** the user pastes a new key into "Replace key"
- **THEN** the check runs on the new key, and "Save connection" follows the new result

#### Scenario: Change only the models
- **WHEN** the user leaves the key blank and unchecks a model
- **THEN** "Save connection" is enabled and the save keeps the stored key

#### Scenario: No delete here
- **WHEN** the user opens an existing connection
- **THEN** the form has no "Delete" button; delete stays in Settings › AI providers as in production

### Requirement: Active models list

"Active models" SHALL have a search field that also accepts a model id, "Select all" and "Clear", and rows with the readable name, the raw id and the tag "Recommended" where it applies. A typed id that is not in the list SHALL be offered as an "Add" row. Above 60 models the list SHALL show the first 60 and a "Show all" link.

#### Scenario: Add a model id that is not in the list
- **WHEN** the user types `gpt-6-preview` in "Search 42 models or add an ID" and it matches no row
- **THEN** a row offers the production text "Add `gpt-6-preview`", and Enter or a click adds it as a checked model

#### Scenario: More than 60 models
- **WHEN** the provider returns 140 models
- **THEN** the list shows 60 rows and the production link "Show all 140"

#### Scenario: A readable name is missing
- **WHEN** the provider gives no readable name for a model id
- **THEN** the row shows the raw id only (not verified that Agenta can build a name; see notes.md)

#### Scenario: No model checked
- **WHEN** the user clicks "Clear"
- **THEN** "Active models · 0 of 42" shows and "Save connection" is disabled (not drawn; see notes.md)

### Requirement: Harnesses section

"Harnesses" SHALL be closed by default, with the marks of the enabled harnesses next to the word. Open, it SHALL list each harness with "Enable this connection in", show a harness that cannot use the provider in gray with "Incompatible with this provider", and end with "Each enabled harness adds this connection's models to the model picker." Pi SHALL be on by default when it supports the provider.

#### Scenario: Open the harnesses
- **WHEN** the user opens "Harnesses" on an OpenAI form
- **THEN** it lists "Pi" (on), "Claude Code" (gray, "Incompatible with this provider") and "Codex"

#### Scenario: Turn a harness off
- **WHEN** the user turns Pi off and saves
- **THEN** the picker no longer lists this connection's models under "via Pi"

### Requirement: Azure OpenAI form

The Azure OpenAI form SHALL ask for "API key", "API base URL" (with the production hint "Your resource endpoint, e.g. https://YOUR-RESOURCE.openai.azure.com") and "API version", all required. The key check SHALL start by itself when all three are filled.

#### Scenario: All three fields filled
- **WHEN** the user fills the last of the three fields and leaves it
- **THEN** the key check runs and the result follows the requirements above

#### Scenario: A field missing
- **WHEN** one of the three fields is empty
- **THEN** no check runs and the dashed box under "Active models" stays

### Requirement: AWS Bedrock form with two ways to sign in

The AWS Bedrock form SHALL show "AWS region", then a two-choice switch "Sign in with": "API key" ("One Bedrock API key.") or "Access keys" ("An access key ID and a secret access key."), then only the fields of the chosen way. Values typed for one way SHALL be kept when the user switches and back. Only the chosen way SHALL be saved.

#### Scenario: API key way
- **WHEN** the user picks "API key"
- **THEN** the form shows "Bedrock API key" with "Encrypted at rest"
- **AND** with a region and a key, the check runs by itself

#### Scenario: Access keys way
- **WHEN** the user picks "Access keys"
- **THEN** the form shows "Access key ID" and "Secret access key"
- **AND** the check answers `unknown`, and the form says the access keys are saved untested (see notes.md: the probe cannot test access keys today)

#### Scenario: Values kept on switch
- **WHEN** the user types a Bedrock API key, switches to "Access keys", types an access key ID, and switches back
- **THEN** the Bedrock API key is still in its field

#### Scenario: Only the chosen way is saved
- **WHEN** the user saves with "Access keys" chosen while a Bedrock API key is also typed
- **THEN** the saved connection holds the region and the access keys only

### Requirement: Google Vertex AI form

The Google Vertex AI form SHALL ask for "API base URL", "Vertex project", "Vertex location" and "Vertex credentials" (a 10-row text box for the service account JSON, "Encrypted at rest"). The check SHALL run when the fields are filled. Because the probe cannot test Vertex today, the form SHALL show the `unknown` state, Agenta's shipped list and the typed-id field.

#### Scenario: Vertex fields filled
- **WHEN** the user fills the required Vertex fields
- **THEN** the check answers `unknown`, the form says the credentials are saved untested, and "Save connection" is enabled

### Requirement: OpenAI-compatible endpoint form

The form SHALL ask for "API base URL" (hint "Include the version path, e.g. /v1."), "API key (optional)" and "Protocol" ("OpenAI-compatible" or "Anthropic Messages"). An endpoint with no model list SHALL not be treated as a bad key: the form SHALL show the `unknown` state with the typed-id field and enable "Save connection".

#### Scenario: The endpoint has no model list
- **WHEN** `GET {base_url}/models` answers 404 or 405
- **THEN** the form does not say the key is wrong
- **AND** it says the endpoint lists no models, shows the typed-id field, and enables "Save connection"

#### Scenario: The endpoint answers without a key
- **WHEN** no key is typed and the endpoint lists its models
- **THEN** the models show, and the form says the key was not tested

#### Scenario: The endpoint rejects the key
- **WHEN** the endpoint answers 401 or 403
- **THEN** the form shows the "Key rejected" state

#### Scenario: A protocol change removes harnesses
- **WHEN** the user changes "Protocol" and a chosen harness cannot use the new protocol
- **THEN** that harness is turned off, as in production

#### Scenario: Address not allowed
- **WHEN** the base URL points to an address that Agenta refuses to call
- **THEN** the form says in plain words that Agenta cannot call this address, and the detail goes to the logs

### Requirement: ChatGPT subscription sign-in

"ChatGPT" in the add list SHALL start the device code sign-in in the panel: the code, "Copy", "Open ChatGPT" (new tab) and a countdown "Expires in". After "Copy", the button SHALL read "Copied" and a waiting block SHALL show. When the sign-in arrives, the panel SHALL return to the list by itself. On timeout it SHALL show "The sign-in code expired. Start again."

#### Scenario: The code is shown
- **WHEN** the user clicks "ChatGPT" in "Add a provider or subscription"
- **THEN** the view shows "ChatGPT", "Waiting for you to sign in", "Open ChatGPT and enter this code. Keep this page open.", the code, "Copy", "Open ChatGPT" and "Expires in 14:32", and "Cancel"

#### Scenario: After Copy
- **WHEN** the user clicks "Copy"
- **THEN** the button reads "Copied"
- **AND** a block shows "Waiting for ChatGPT to confirm" and "After you enter the code in ChatGPT, it can take up to a minute until the sign-in arrives here. You do not need to do anything on this page. This page returns to the list by itself when the sign-in arrives."

#### Scenario: Signed in
- **WHEN** the sign-in arrives
- **THEN** the panel returns to Model providers and the row "ChatGPT" shows under "Subscriptions"

#### Scenario: Code expired
- **WHEN** the countdown ends before the sign-in arrives
- **THEN** a red line shows "The sign-in code expired. Start again."

#### Scenario: Sign-in failed or lost
- **WHEN** the sign-in does not finish in time or Agenta loses track of it
- **THEN** the view shows the production text "The sign-in did not finish in time. Start it again." or "Agenta lost track of that sign-in. Check ChatGPT, then sign in again."

#### Scenario: Not connected and expired states
- **WHEN** the user opens ChatGPT with no sign-in
- **THEN** it shows "Sign in with your ChatGPT subscription to run agents." and "Connect ChatGPT"
- **WHEN** the stored sign-in is no longer valid
- **THEN** the list row shows "Sign in needed" and "Sign in again"

#### Scenario: Leave while waiting
- **WHEN** the user clicks "Cancel" while the view waits
- **THEN** the sign-in attempt is cancelled and the panel returns to the add list

### Requirement: Claude subscription token

"Claude" in the add list SHALL show "Paste a token to run agents on your Pro or Max plan." and three numbered steps: "Run this command on your computer" with `claude setup-token` and "Copy", "Sign in to Claude", and "Paste the token the command prints". "Connect" SHALL be enabled only when the token starts with `sk-ant-oat`.

#### Scenario: Token pasted
- **WHEN** the user pastes a token that starts with `sk-ant-oat` and clicks "Connect"
- **THEN** the button shows "Checking…", and when the token is stored the panel returns to the list with the row "Claude"

#### Scenario: Wrong token shape
- **WHEN** the pasted text does not start with `sk-ant-oat`
- **THEN** "Connect" stays disabled

#### Scenario: Store failed
- **WHEN** the server refuses the token
- **THEN** the view shows the server's message in plain words, or "Agenta could not store this token. Try again."

### Requirement: Built-in models card

"Edit" on the "Agenta" row SHALL open the standard provider card with these differences: the key field is locked and reads "Provided by Agenta", there is no "Name" field, and "Active models" SHALL list the three built-in models with no checkboxes, no "Select all", no "Clear" and no "Save". "Harnesses" SHALL show the harnesses that can use them. The card SHALL be a view with "Done" only. Turning built-in models on and off per project is not part of this work (decided).

#### Scenario: Open the card
- **WHEN** the user clicks "Edit" on "Agenta"
- **THEN** the card shows "API key" with "Provided by Agenta", "Active models" with "Gemini 3.8 Flash" (`google/gemini-3.8-flash`, "Recommended"), "Gemini 4 Argon" (`google/gemini-4-argon`) and "Gemini 3.7 Flash" (`google/gemini-3.7-flash`), then "Harnesses" and "Done", with no checkbox

#### Scenario: Every built-in model in the picker
- **WHEN** the deployment has the built-in models
- **THEN** the Model view lists all three under "Agenta", as production

#### Scenario: Done
- **WHEN** the user clicks "Done"
- **THEN** the view goes back to Model providers and nothing is stored

### Requirement: Save, cancel and leave

"Save connection" SHALL be the Save of the form view: it SHALL save the connection to the project on the server, block a second click and navigation while it runs, and go back to the Model providers list when it succeeds. "Cancel" SHALL drop the typed values with no question. Leaving a form with typed values in another way SHALL open the unsaved-changes dialog of the `agent-panel` spec, with a description from the form that says Save writes the project's connection.

#### Scenario: Save
- **WHEN** the user clicks "Save connection"
- **THEN** the connection is stored, the view goes back to Model providers, and the picker lists the new models

#### Scenario: Save in flight
- **WHEN** the user clicks "Save connection" again, or clicks the breadcrumb, while the save runs
- **THEN** nothing happens until the save ends

#### Scenario: Save failed
- **WHEN** the save request fails
- **THEN** the form stays open and filled and shows "Agenta could not save this {provider} connection. Try again."

#### Scenario: Cancel
- **WHEN** the user typed a key and clicks "Cancel"
- **THEN** the typed values are dropped with no question and the view goes back

#### Scenario: Leave with typed values
- **WHEN** the user typed a key and clicks the breadcrumb "Model providers"
- **THEN** the dialog "You have unsaved changes" asks first, with "Keep editing", "Discard" and "Save changes"
- **AND** its description says that Save stores the connection in the project, not in the agent (text not written; listed for Mahmoud)

### Requirement: Access rules

The forms SHALL follow production access: a person who may not edit the project's secrets SHALL see connections read only, with no key check and no "Save connection". An organization connection SHALL be checked as saved, without sending typed fields, for a member who is not an organization owner or admin.

#### Scenario: No right to edit secrets
- **WHEN** a person without the edit right on secrets opens a provider form
- **THEN** the fields are read only and no key check starts (production behavior not verified; see notes.md)

#### Scenario: Organization connection as a member
- **WHEN** a project member opens an organization connection
- **THEN** the background refresh checks the stored credential as saved, and the fields cannot change

### Requirement: One implementation in every place

The Model view, the Model providers list, the add view and the provider forms SHALL be one implementation each. Every place that shows a provider form today SHALL use the new form, and the Settings page "AI providers" SHALL use the same two screens.

#### Scenario: Run error
- **WHEN** a run fails for a missing or rejected key and the user opens the fix from the run error
- **THEN** the same provider form view opens inside `DrawerViewChrome`, with the automatic key check

#### Scenario: Settings
- **WHEN** the user opens Settings › AI providers
- **THEN** it shows the same list and the same forms, with "Who can use it" for organization connections as in production
