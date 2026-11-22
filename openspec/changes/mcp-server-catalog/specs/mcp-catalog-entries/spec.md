## ADDED Requirements

### Requirement: One catalog file, and one domain entry
The system SHALL read every catalog entry from one catalog file, `catalog.json` in the catalog folder, with the shape `{"entries": [...]}`. Each entry SHALL hold a required `key`, `origin`, a `listing` part (`categories`, `tested_at`) and a `connection` part. An entry with the origin `internal` SHALL hold `title` and `description` and SHALL have no `server` part. The entries SHALL be sorted by `key`, and the file SHALL be written with a 2-space indent and one trailing newline. The system SHALL parse the file once and SHALL parse each entry into a domain entry with these fields only: `key`, `title`, `description`, `logo_url`, `categories`, `connection`. The API SHALL return the domain entry and SHALL NOT return a `server` part, `$schema`, or `origin`. The read API, the UI and the connect flow SHALL NOT behave differently for an `internal` and a `registry` origin.

#### Scenario: Two origins in one catalog
- **WHEN** the catalog in Direction B holds one entry with the origin `internal` and one with the origin `registry`
- **THEN** the list route SHALL return both with the same fields, and a person SHALL connect each with the same steps

#### Scenario: Registry names stay in the catalog file
- **WHEN** a caller lists the catalog
- **THEN** no entry in the answer SHALL hold a field named `$schema`, `server` or `origin`

#### Scenario: Key from the entry
- **WHEN** a valid entry in the catalog file has `"key": "linear"`
- **THEN** the entry's key SHALL be `linear`

#### Scenario: Key that does not match the pattern
- **WHEN** an entry in the catalog file has `"key": "Linear_MCP"`
- **THEN** the reader SHALL refuse it, because the key SHALL match `^[a-z0-9][a-z0-9-]*$`

#### Scenario: Duplicate key
- **WHEN** two entries in the catalog file have `"key": "linear"`
- **THEN** the reader SHALL refuse both entries, SHALL report each one, and SHALL load the other entries

### Requirement: The connection is one of two shapes
An entry's `connection` SHALL be either `fixed_url` (a `url` and one or more `auth_options`) or `templated_url` (a `url_template` with exactly one `{secret}` in its path). A `templated_url` connection SHALL mean an API key in the URL, and SHALL have no auth options. The format SHALL give no way to write a key in the URL together with an OAuth option.

#### Scenario: Key in the URL path
- **WHEN** an entry has a `templated_url` connection with the template `https://host.example/{secret}/mcp`
- **THEN** the reader SHALL accept it, and a server from it SHALL use the API key mode, with a row that stores the template with `{secret}` and never the key

#### Scenario: Template with no placeholder
- **WHEN** a `templated_url` connection has a `url_template` with no `{secret}`
- **THEN** the reader SHALL refuse the entry

#### Scenario: Fixed URL with a placeholder
- **WHEN** a `fixed_url` connection has a `url` that holds `{secret}`
- **THEN** the reader SHALL refuse the entry

### Requirement: Auth options are one shape for each mode
Each auth option of a `fixed_url` connection SHALL be one of: `none` with no other field; `api_key` with a `credential_binding` and an optional `help_url`; or `oauth` with `needs_own_app`, `default_scopes` and an optional `help_url`. The binding of an `api_key` option SHALL be the existing MCP credential binding, of kind `header` or `query`, and SHALL NOT be of kind `url`. Each mode SHALL appear at most once in an entry, and the first option SHALL be the default. `needs_own_app` SHALL say that the vendor registers no clients. An entry SHALL NOT say how a deployment registers its OAuth client, and SHALL NOT hold a credential value.

#### Scenario: API key in the query
- **WHEN** an `api_key` option binds the query parameter `key`, and the entry's `url` already holds a `key` parameter
- **THEN** the reader SHALL refuse the entry

#### Scenario: API key with no binding
- **WHEN** an `api_key` option has no `credential_binding`
- **THEN** the reader SHALL refuse the entry

#### Scenario: API key with a URL binding
- **WHEN** an `api_key` option has a `credential_binding` of kind `url`
- **THEN** the reader SHALL refuse the entry, because a key in the URL is the `templated_url` shape

#### Scenario: Pre-registered OAuth client
- **WHEN** an entry has an `oauth` option with `needs_own_app` true
- **THEN** the entry SHALL hold no client ID and no client secret, and the connect flow SHALL ask the person for them

#### Scenario: Two options with the same mode
- **WHEN** an entry has two auth options with the mode `oauth`
- **THEN** the reader SHALL refuse the entry

### Requirement: Entries are validated once, when they are read
The reader SHALL validate each entry of the catalog file on its own. The reader SHALL refuse an entry when: its `key` does not match the key pattern; its `key` appears twice in the file; its connection URL is not `https`, has user info, or has an IP literal as host; a `help_url` is not `https`; its `title` has more than 100 characters or its `description` more than 500, for both origins; a category is not a known category; or its `logo_url` is not `https`, has user info, has an IP literal as host, or has more than 2048 characters. The reader SHALL NOT fetch a `logo_url`. For each auth option, the reader SHALL build the MCP endpoint that a create from that option would store, and SHALL refuse the entry when an existing MCP endpoint validator refuses that endpoint. The reader SHALL skip a refused entry, record the problem, and load the other entries. The API SHALL start when an entry is refused. When the catalog file is not valid JSON or has no `entries` list, the system SHALL log an error, SHALL serve an empty catalog, and SHALL keep the custom server URL path working. After an entry is read, the service and the routers SHALL trust it and SHALL NOT check its shape again. The system SHALL define no catalog error code for a model validation failure at create: such a failure SHALL be treated as a bug.

#### Scenario: Placeholder outside the path
- **WHEN** a `templated_url` template holds `{secret}` in its query
- **THEN** the reader SHALL refuse the entry at load, with the endpoint validator's rule

#### Scenario: Description too long
- **WHEN** an entry's `description` has 501 characters
- **THEN** the reader SHALL refuse the entry, with either origin

#### Scenario: One bad entry
- **WHEN** one of 19 entries is invalid
- **THEN** the API SHALL start, the list route SHALL return 18 entries, and the log SHALL hold one error that names the entry

#### Scenario: Catalog file that is not valid JSON
- **WHEN** `catalog.json` is not valid JSON
- **THEN** the API SHALL start, the list route SHALL return no entries, the log SHALL hold an error, and a person SHALL still connect a server through "Custom server URL"

### Requirement: The catalog file is the only list of entries
In both directions, every catalog entry SHALL be an entry in the one catalog file in the repository. There SHALL be no separate allowlist file. The system SHALL NOT store catalog entries in the database, and SHALL offer no API and no UI to change an entry at run time. One API unit test SHALL load the real catalog file, and SHALL fail on any problem: a file that is not valid JSON, an invalid entry, a duplicate key, or a list that is not sorted by `key`. The test SHALL make no network request. The change SHALL add no CI workflow for this.

#### Scenario: No run-time edit
- **WHEN** a person wants to change an entry on a running deployment
- **THEN** the system SHALL offer no API and no UI to do it

#### Scenario: Entry removed
- **WHEN** a release removes an entry from the catalog file
- **THEN** the list SHALL no longer hold the entry, and a create with its key SHALL be refused

#### Scenario: Invalid entry in a pull request
- **WHEN** a pull request adds an entry to the catalog file whose connection URL uses `http`
- **THEN** the unit test SHALL fail and SHALL name the entry key and the rule

#### Scenario: Unsorted list in a pull request
- **WHEN** a pull request adds an entry to the catalog file out of the sort order by `key`
- **THEN** the unit test SHALL fail

### Requirement: Catalog read API
The system SHALL serve `GET /gateways/mcps/catalog/entries/` (operation id `list_mcp_catalog_entries`) and `GET /gateways/mcps/catalog/entries/{entry_key}` (`fetch_mcp_catalog_entry`). Each route SHALL require `VIEW_MCP_ENDPOINTS` and SHALL be refused when the MCP gateway is off. The list SHALL return `count` and `entries` and SHALL be the same for every project. A fetch SHALL return `count` and `entry`. The discover route for agents is in the capability `mcp-catalog-agent`. A fetch SHALL find an entry by a lookup among the loaded entries, and SHALL NOT build a file path from the key. No answer SHALL hold a credential. A refusal SHALL use the gateway error envelope (`code`, `message`, `retryable`, optional `next_step` and `details`).

#### Scenario: List
- **WHEN** a project member with `VIEW_MCP_ENDPOINTS` calls the list route
- **THEN** the system SHALL return every valid entry with its `key`, `title`, `description`, `categories` and `connection`

#### Scenario: Unknown key
- **WHEN** a caller fetches `GET /gateways/mcps/catalog/entries/nope`
- **THEN** the system SHALL answer `404` with the code `mcp_catalog_entry_not_found`

#### Scenario: Key that looks like a path
- **WHEN** a caller fetches the key `..`
- **THEN** the system SHALL answer `404` with the code `mcp_catalog_entry_not_found`, and SHALL read no file

#### Scenario: No permission
- **WHEN** a caller without `VIEW_MCP_ENDPOINTS` calls the list route
- **THEN** the system SHALL refuse the call, as it refuses `GET /gateways/mcps/endpoints/`

#### Scenario: Gateway off
- **WHEN** `AGENTA_MCP_GATEWAY_ENABLED` is false
- **THEN** the system SHALL refuse the catalog routes, as it refuses the other MCP gateway routes

### Requirement: The logo is a link to the vendor's image
An entry MAY hold `logo_url`, an `https` URL of the vendor's own image. The list and fetch answers SHALL return it unchanged, under the name `logo_url`, and SHALL leave the field out when the entry has none. The system SHALL NOT fetch a logo and SHALL NOT hold image data for a logo. The system SHALL NOT add a route that serves a logo, and SHALL NOT add a route that needs no authentication. The web SHALL show a logo only as an `<img>` element, with no referrer, and SHALL show the default mark when the entry has no `logo_url` or the image does not load. A `logo_url` SHALL enter or change the catalog only through a reviewed pull request, in both directions.

#### Scenario: Entry with a logo
- **WHEN** a caller lists the catalog and the `linear` entry has a `logo_url`
- **THEN** the entry's `logo_url` SHALL be that `https` URL, and the API SHALL have made no request to it

#### Scenario: Entry without a logo
- **WHEN** an entry has no `logo_url`
- **THEN** `logo_url` SHALL be absent, and the UI SHALL show the default mark

#### Scenario: The image does not load
- **WHEN** the vendor's host does not answer for an entry's `logo_url`
- **THEN** the row SHALL show the default mark, and the rest of the row SHALL work

#### Scenario: A logo address of a wrong form
- **WHEN** an entry's `logo_url` starts with `http://`, or has an IP literal as host, or has more than 2048 characters
- **THEN** the reader SHALL refuse the entry

#### Scenario: No referrer
- **WHEN** a person's browser loads a logo
- **THEN** the request SHALL carry no referrer

### Requirement: Direction A: every entry is internal
In Direction A, every entry SHALL have the origin `internal`, and a person SHALL write the whole entry in the catalog file. An entry SHALL enter or change the catalog only through a merged pull request and a release. The running API SHALL read the entries from the catalog file in its image and SHALL NOT call an external service to list or fetch an entry.

#### Scenario: Deployment with no outbound access
- **WHEN** a self-hosted deployment cannot reach the internet, and a person opens the catalog
- **THEN** the system SHALL list every entry with its `logo_url`, and each row SHALL show the default mark, because the browser cannot load the images

### Requirement: Direction B: a registry name is read only when an entry in the catalog file names it
In Direction B, the catalog file SHALL be the allowlist. The system SHALL read from the official MCP Registry (`registry.modelcontextprotocol.io`, the API frozen at `/v0.1/`) only a name that an entry in the catalog file gives exactly in `origin.name`. It SHALL read one version of a server at `GET /v0.1/servers/{serverName}/versions/{version}`, with the version `latest` for the latest version, and SHALL URL-encode `serverName` in the path. An entry with the origin `registry` SHALL have no `title` or `description` of its own; they SHALL come from the `server` part. The reader SHALL refuse a name in `io.github.*` unless `origin.vendor_github_org` is set and the name starts with `io.github.<vendor_github_org>/`. The `server` part of the entry SHALL declare a published, non-draft `server.json` schema from the accepted list, a constant in the catalog file models that a pull request extends (on 2026-11-22: `2025-09-29`, `2025-10-11`, `2025-10-17`, `2025-12-11`). It SHALL have a `name` equal to `origin.name`, SHALL have a `title` of at most 100 characters and a `description` of at most 500, and SHALL hold a `streamable-http` remote whose `url` is equal to `connection.url`. The system SHALL refuse an entry whose `server` part breaks one of these rules. The system SHALL take only plain text, remotes and icon addresses from the registry. A registry icon address SHALL be used in one form only: as the entry's `logo_url` in the catalog file, which a person reviews in the pull request. The reader SHALL keep an icon of the `server` part only when its `src` passes the `logo_url` rules. The system SHALL NOT fetch an icon and SHALL NOT take image data from the registry. A person SHALL write `listing` and `connection`. A `templated_url` entry SHALL have the origin `internal`.

#### Scenario: Name that no entry names
- **WHEN** the registry lists `io.github.someone/linear-mcp`, and no entry in the catalog file names it
- **THEN** the catalog SHALL NOT hold an entry from it

#### Scenario: Vendor server in `io.github.*`
- **WHEN** an entry names `io.github.github/github-mcp-server` with `vendor_github_org` `github`
- **THEN** the reader SHALL accept it

#### Scenario: Copy of a vendor server in `io.github.*`
- **WHEN** an entry names `io.github.someone/github-mcp` with `vendor_github_org` `github`
- **THEN** the reader SHALL refuse it, because the name does not start with `io.github.github/`

#### Scenario: URL is not one of the remotes
- **WHEN** an entry's `connection.url` is `https://mcp.example.com/mcp` and its remotes hold only `https://mcp.example.com/v2/mcp`
- **THEN** the system SHALL refuse the entry with a problem that names the entry

#### Scenario: Only an SSE remote
- **WHEN** an entry's remotes hold only a remote of type `sse`
- **THEN** the system SHALL refuse the entry

#### Scenario: Unknown or draft schema
- **WHEN** a `server` part declares a draft `server.json` schema, or a schema that is not in the accepted list
- **THEN** the system SHALL refuse the entry

#### Scenario: Registry server with no title
- **WHEN** a `server` part has no `title`
- **THEN** the reader SHALL refuse the entry, and a person SHALL write the entry with the origin `internal`

#### Scenario: Upstream removed the remote we use
- **WHEN** the registry's remotes for an entry no longer hold the entry's `connection.url`
- **THEN** the entry SHALL fail validation, and no new server SHALL get an address that we did not test

#### Scenario: templated-URL entry from the registry
- **WHEN** an entry has a `templated_url` connection and the origin `registry`
- **THEN** the reader SHALL refuse the entry

#### Scenario: Mixed catalog
- **WHEN** some entries in the catalog file have the origin `registry` and some have `internal`
- **THEN** the catalog SHALL list both

### Requirement: Direction B: registry data is synced at build time and reviewed
In Direction B, a sync script SHALL copy the `server` part of each `registry` entry into that entry in the catalog file. A person SHALL run the script as a step of the monthly re-test, outside the running API, and SHALL open the pull request with its changes. A scheduled job SHALL run the script once a week in check mode. In check mode the script SHALL write nothing, and SHALL fail with the entry keys when an entry has a newer registry version or a named entry is missing, or has the registry status `deprecated` or `deleted`. The script and the check SHALL read the status at `_meta["io.modelcontextprotocol.registry/official"].status`, and SHALL NOT read a deprecation from `isLatest`, which stays true on a deprecated version. An entry with the origin `registry` MAY hold `origin.skip_version`, one version string: when the registry's latest version is equal to it, the script and the check SHALL count the entry as unchanged. A person SHALL set it through a pull request when a new upstream version fails the test checklist, and SHALL remove it when a later version passes. The job SHALL have read-only access to the repository, SHALL use no secret, and SHALL NOT open a pull request or push a commit. The script SHALL pick one icon from the registry's `server.icons`: the first with an `https` `src`, with an `image/svg+xml` icon before any other type. It SHALL compare that pick with the pick of the committed `server.icons`, whether or not the registry version changed. When the two differ, it SHALL write the new `src` to the entry's `logo_url` and SHALL rewrite the committed `server.icons` from the validated model in the same run, so that the next check passes. When the entry has no `logo_url`, it SHALL write the pick to `logo_url`. In every other case it SHALL leave `logo_url` as it is. The check SHALL compare the same pair. The check SHALL report a changed icon address as a change. The script SHALL write only `server` and `origin.pinned_version` of an entry whose registry version changed, and `logo_url` and `server.icons` by the rule above, and SHALL write them from the validated model only, with unknown fields dropped. It SHALL treat an entry as changed when the registry's latest version string differs from `origin.pinned_version`. It SHALL NOT change any other entry. It SHALL write the catalog file in the same stable format: entries sorted by `key`, a 2-space indent and one trailing newline. The script SHALL report an upstream deprecation or removal and SHALL NOT remove or change the entry for it. The running API SHALL read the catalog file, as in Direction A, and SHALL NOT call the registry.

#### Scenario: Weekly drift check finds a change
- **WHEN** the registry publishes `1.1.0` for an entry pinned at `1.0.2`, and the weekly job runs
- **THEN** the job SHALL fail and name the entry, SHALL change no file, and SHALL open no pull request

#### Scenario: Weekly drift check finds nothing
- **WHEN** every entry's pin equals the registry's latest version, and the weekly job runs
- **THEN** the job SHALL pass and change no file

#### Scenario: Pinned version
- **WHEN** a committed entry has `origin.pinned_version` `1.0.2` and the registry publishes `1.1.0`
- **THEN** every deployment SHALL keep serving the data of `1.0.2` until a person runs the script and the pull request is merged and released

#### Scenario: Skipped version
- **WHEN** an entry pinned at `1.0.2` has `origin.skip_version` `1.1.0`, the registry's latest version is `1.1.0`, and the weekly job runs
- **THEN** the job SHALL pass, and the script SHALL change no file

#### Scenario: Unknown field in the registry answer
- **WHEN** the registry answer for an entry holds a field that the model does not know
- **THEN** the script SHALL NOT write that field into the catalog file

#### Scenario: Registry is down
- **WHEN** the registry does not answer while a person runs the script
- **THEN** the script SHALL fail and SHALL NOT change the catalog file, and no deployment SHALL change

#### Scenario: Registry data was reset
- **WHEN** a named entry is missing from the registry
- **THEN** the script SHALL report the name and SHALL NOT remove or change its entry

#### Scenario: Upstream marks an entry deprecated
- **WHEN** the registry answer for a named entry has `_meta["io.modelcontextprotocol.registry/official"].status` `deprecated` or `deleted`, also with `isLatest` true
- **THEN** the script SHALL say so, and a person SHALL decide whether to remove the entry from the catalog file

#### Scenario: Deployment with no outbound access
- **WHEN** a self-hosted deployment cannot reach the internet
- **THEN** the system SHALL list every entry, because the data is in its image

#### Scenario: The registry has an icon and the entry has no logo
- **WHEN** a `registry` entry has no `logo_url`, and the registry's server has an icon with an `https` `src`
- **THEN** the script SHALL write that `src` to the entry's `logo_url`, and the pull request SHALL show it

#### Scenario: A hand-written logo and an unchanged icon
- **WHEN** a person wrote the entry's `logo_url`, and the registry's icon address is the same as in the committed `server` part
- **THEN** the script SHALL NOT change `logo_url`

#### Scenario: The registry's icon address changes
- **WHEN** the registry's icon address for an entry differs from the committed one
- **THEN** the script SHALL write the new address to `logo_url` and SHALL rewrite `server.icons`, and the check SHALL fail and name the entry

#### Scenario: The icon changes and the version does not
- **WHEN** the registry's icon address for an entry changes, and its version string is equal to `origin.pinned_version`
- **THEN** the script SHALL write `logo_url` and `server.icons` for that entry, and SHALL NOT change `origin.pinned_version` or any other field of `server`

#### Scenario: The check after the merge
- **WHEN** the pull request of that run is merged, and the weekly check runs with no further change in the registry
- **THEN** the check SHALL pass for that entry

#### Scenario: SVG first
- **WHEN** the registry's server has a PNG icon and then an SVG icon, both with an `https` `src`
- **THEN** the script SHALL pick the SVG icon

#### Scenario: No usable icon
- **WHEN** the registry's server has no icon, or only icons whose `src` is not `https`
- **THEN** the script SHALL leave the entry's `logo_url` as it is
