# Teams connection

## Purpose

Let a project connect its own Microsoft Teams bot to Channels from the agent page in /m, check the bot's values with Microsoft, show the messaging endpoint, offer the Teams app package, and disconnect.

## ADDED Requirements

### Requirement: Setup fields
The Teams capability declaration SHALL declare three required setup fields: `app_id` with the label "Application (client) ID", `client_secret` with the label "Client secret value" and `secret: true`, and `tenant_id` with the label "Directory (tenant) ID".

#### Scenario: Fields shown on the setup screen
- **WHEN** an editor chooses Teams on the agent's Channels card
- **THEN** the setup screen SHALL show the three fields with these labels, and the secret field SHALL be masked

#### Scenario: Secret field help
- **WHEN** the setup screen shows the `client_secret` field
- **THEN** its help text SHALL be "Copy the secret's Value, not its Secret ID."

#### Scenario: Id fields that are not GUIDs
- **WHEN** an editor enters an `app_id` or a `tenant_id` that is not a GUID
- **THEN** Agenta SHALL refuse the connection before any call to Microsoft, with the pattern error "Enter the ID as a GUID, for example 00000000-0000-0000-0000-000000000000."

### Requirement: Credential storage and identity
Agenta SHALL store `client_secret` in the project vault under the secret kind `ChannelSecretKind.TEAMS`, SHALL store `tenant_id` and `webhook_url` in connection data, and SHALL key the connection on the bare `app_id`.

#### Scenario: Secret survives the vault round trip
- **WHEN** a Teams connection is created with a `client_secret`
- **THEN** `ChannelSecretSettingsDTO` SHALL keep the `client_secret` field, and the hydrated connection SHALL carry it in `connection.data`

#### Scenario: Bot already connected elsewhere
- **WHEN** a bot with the same `app_id` is already connected to another project on the same deployment
- **THEN** Agenta SHALL refuse the connection with an identity conflict

### Requirement: Token check at setup
`verify_connection` SHALL request an access token from `https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token` with `grant_type=client_credentials`, the `app_id`, the `client_secret` and the scope `https://api.botframework.com/.default`, and SHALL store nothing when Microsoft refuses.

#### Scenario: Microsoft returns a token
- **WHEN** Microsoft answers the token request with an access token
- **THEN** `verify_connection` SHALL return `app_id`, `tenant_id` and `webhook_url`, and the connection SHALL be stored active and verified

#### Scenario: Wrong secret
- **WHEN** Microsoft refuses the request with `invalid_client` or the error code `AADSTS7000215`
- **THEN** Agenta SHALL refuse the connection with "Microsoft rejected this client secret. Copy the secret's Value, not its Secret ID."

#### Scenario: Unknown app id
- **WHEN** Microsoft refuses the request with the error code `AADSTS700016`
- **THEN** Agenta SHALL refuse the connection with "Microsoft found no application with this ID in this tenant."

#### Scenario: Unknown tenant
- **WHEN** Microsoft refuses the request with the error code `AADSTS90002`
- **THEN** Agenta SHALL refuse the connection with "Microsoft found no directory with this tenant ID."

#### Scenario: Any other failure
- **WHEN** the token request times out, cannot connect, or fails with any other error
- **THEN** Agenta SHALL refuse the connection with "Could not check these values with Microsoft. Try again."

### Requirement: Messaging endpoint
`verify_connection` SHALL return `webhook_url` as `{AGENTA_API_URL}/channels/teams/events/`, and the setup screen SHALL show it with the label "Messaging endpoint" and a copy button after the connection is stored.

#### Scenario: Endpoint shown after connect
- **WHEN** a Teams connection is stored
- **THEN** the setup screen SHALL show the deployment's API URL followed by `/channels/teams/events/` under "Messaging endpoint", with a copy button

#### Scenario: Endpoint shown again later
- **WHEN** the editor opens the Teams connection again later
- **THEN** the manage view SHALL show the same messaging endpoint from `data.webhook_url`

### Requirement: Teams app package
For a connection whose locator has an `app_id`, `build_setup_document` SHALL return a setup document with `format: "zip"`, the base64 of a zip in `content`, and a `filename`, and the zip SHALL hold `manifest.json`, `color.png` and `outline.png`.

#### Scenario: Manifest content
- **WHEN** the package is built for an `app_id`
- **THEN** `manifest.json` SHALL have `bots[0].botId` equal to the `app_id`, the scopes `personal`, `groupChat` and `team`, and no resource-specific consent permissions

#### Scenario: Same app on a new upload
- **WHEN** the package is built twice for the same `app_id`
- **THEN** both manifests SHALL have the same `id`, a UUIDv5 of the `app_id` under the adapter's fixed namespace, and the same `version`

#### Scenario: No connection yet
- **WHEN** the catalog setup call runs before any connection exists, so the locator has no `app_id`
- **THEN** `build_setup_document` SHALL return no document

### Requirement: Manifest text
The manifest SHALL take `name.short` and `description.short` from the `identity` argument of `build_setup_document`, fitted to one line of at most 30 and 80 characters, with the defaults "Agenta" and "An Agenta agent.", and SHALL set `developer.name` to "Agenta" and `developer.websiteUrl`, `developer.privacyUrl` and `developer.termsOfUseUrl` to `env.agenta.web_url`.

#### Scenario: Long name
- **WHEN** `identity.name` has 45 characters
- **THEN** `name.short` SHALL hold its first 30 characters, without leading or trailing spaces

#### Scenario: No identity
- **WHEN** `build_setup_document` receives no `identity`
- **THEN** `name.short` SHALL be "Agenta" and `description.short` SHALL be "An Agenta agent."

#### Scenario: Developer fields
- **WHEN** the package is built on a deployment whose `AGENTA_WEB_URL` is set
- **THEN** the three developer URLs SHALL equal that value, and `developer.name` SHALL be "Agenta"

### Requirement: Package download and install steps
After a Teams connection is stored, the setup screen SHALL offer a "Download Teams app" button that saves the decoded zip under the document's `filename`, and SHALL show the install steps.

#### Scenario: Download
- **WHEN** the editor clicks "Download Teams app"
- **THEN** the browser SHALL save a zip file whose bytes equal the base64-decoded `content`

#### Scenario: Install steps
- **WHEN** the setup screen shows the download button
- **THEN** it SHALL show "In Teams, open Apps, then Manage your apps, then Upload an app, and choose the downloaded file." and "No Upload an app option? Ask your Teams admin to allow custom apps."

### Requirement: Setup instructions
The Teams capability declaration SHALL list setup instructions that tell the editor how to register the bot, where to find the three values, where to paste the messaging endpoint and how to install the app, with final wording set after task 0.1.

#### Scenario: Developer Portal path
- **WHEN** task 0.1 shows that a bot registered in the Teams Developer Portal can send replies
- **THEN** the instructions SHALL guide the editor through the Developer Portal (Tools, then Bot management), and the docs SHALL link the Azure portal steps

#### Scenario: Azure portal path
- **WHEN** task 0.1 shows that such a bot cannot send replies
- **THEN** the instructions SHALL guide the editor through the Azure portal instead, and the adapter code SHALL stay the same

### Requirement: Disconnect
Archiving a Teams connection SHALL stop routing its events, and Agenta SHALL NOT call Microsoft to remove the app or the bot registration.

#### Scenario: Event after archive
- **WHEN** Teams sends an activity for an archived connection
- **THEN** Agenta SHALL NOT start a turn for it
