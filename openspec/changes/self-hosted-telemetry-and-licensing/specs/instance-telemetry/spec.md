# Instance telemetry

## Purpose

Say exactly what a self-hosted instance sends to Agenta, give operators one switch for every PostHog event but the install ping, and make the data useful in PostHog. A self-hosted instance is one without Stripe; cloud keeps today's analytics.

## ADDED Requirements

### Requirement: One switch for PostHog events
Agenta SHALL read `AGENTA_TELEMETRY_ENABLED` through the shared `env` object, with a default of `true`. When it is `false` on an instance without a paid license key, the API SHALL make no PostHog call except the install ping, and the browser SHALL load no analytics script and send no events. The update check is not a PostHog event and has its own setting, `AGENTA_UPDATE_CHECK_ENABLED`.

#### Scenario: Switch off, no license
- **WHEN** an instance with no paid license key sets `AGENTA_TELEMETRY_ENABLED=false`
- **THEN** no request from the API or the browser SHALL reach Agenta's PostHog project, except the one install ping

#### Scenario: Startup log
- **WHEN** the API starts
- **THEN** it SHALL log one line that says whether telemetry is on, why (default, switch, or license), and the link to the telemetry docs page

### Requirement: Built-in PostHog key stays
The API SHALL keep the built-in fallback PostHog project key in `PostHogConfig` (`api/oss/src/utils/env.py:2021-2024`). No change in this work SHALL remove it. It is how an instance with no PostHog setup still sends the install ping.

#### Scenario: `POSTHOG_API_KEY` unset
- **WHEN** an operator leaves `POSTHOG_API_KEY` unset
- **THEN** the API SHALL use the built-in key, SHALL send the install ping, and SHALL send other events only when telemetry is on

### Requirement: Install ping
The API SHALL send one `instance_installed` event per instance id, whatever the switch says, once the instance has an organization. It SHALL check at every start and after each organization is created, and SHALL set `instances.installed_event_sent_at` only after PostHog accepts the event. The distinct id SHALL be the instance id. It SHALL carry no other data: no email, name, URL, version, kind or other field, GeoIP off and an empty `$ip`. It replaces `oss_deployment_created`.

#### Scenario: Telemetry off at install
- **WHEN** the first organization is created with `AGENTA_TELEMETRY_ENABLED=false`
- **THEN** the API SHALL still send `instance_installed` once

#### Scenario: Existing instance upgrades
- **WHEN** an instance that already has organizations starts on this release
- **THEN** the API SHALL send `instance_installed` once

#### Scenario: Nothing but the id is stored
- **WHEN** we open the `instance_installed` event in PostHog
- **THEN** it SHALL show the instance id and the time, and SHALL NOT show an IP address, a location, a URL or any property that the PostHog library does not add itself

#### Scenario: No outbound network
- **WHEN** the send fails
- **THEN** the API SHALL keep working, SHALL log one warning, SHALL leave `installed_event_sent_at` empty, and SHALL try again at the next start

### Requirement: Heartbeat every 12 hours
When telemetry is on, a self-hosted instance SHALL send one `instance_heartbeat` event at most every 12 hours. An hourly cron SHALL call `POST /admin/telemetry/heartbeat`. The route SHALL lock the `instances` row, send, and set `heartbeat_sent_at` in one transaction, so only one container sends and a failed send changes nothing. One event SHALL cover the whole time since the last heartbeat.

#### Scenario: Several API replicas
- **WHEN** three API containers run against one database
- **THEN** Agenta SHALL receive one heartbeat per 12 hours from that instance, not three

#### Scenario: Instance was down
- **WHEN** an instance was off for three days and starts again
- **THEN** the next heartbeat SHALL cover the whole gap in one event, not one event per missed window

### Requirement: Heartbeat payload
The heartbeat SHALL carry exactly: `instance_id`, `instance_kind`, `agenta_version`, `edition`, `deployment_method`, `plan`, `license_key_id` (never the key), `total_organizations`, `total_projects`, `total_users`, `total_workflows`, `window_start`, `window_end`, `window_spans`, `window_evaluation_runs`, `window_agent_turns`, and `user_domains`: the top 100 email domains, each with its user count.

#### Scenario: No content leaves the instance
- **WHEN** we open a heartbeat in PostHog
- **THEN** it SHALL show none of: emails, names, organization or project names, URLs, prompts, traces, test sets or any user content

### Requirement: Instance as a PostHog group
Every heartbeat and per-user event from a self-hosted instance, from the API and the browser, SHALL name the instance as a PostHog group of type `instance`, keyed by the instance id. The install ping carries no group. The heartbeat SHALL also set the group's properties: `instance_kind`, `agenta_version`, `edition`, `deployment_method`, `plan` and the `total_*` values.

#### Scenario: Activation per instance
- **WHEN** we chart "users who reached observability activation" in PostHog
- **THEN** we SHALL be able to break the chart down by instance, edition and version

### Requirement: Anonymous per-user events
On self-hosted instances, every per-user event from the API and the browser SHALL use `<instance_id>:<user_id>` as its distinct id. No event or person property SHALL carry an email, a username, an organization name or the instance URL. This covers `user_signed_up_v1` (no `cloud_url`) and the browser `survey sent` event (no email answer). The activation flags (`activated_*`) SHALL keep working on that id.

#### Scenario: Self-hosted sign-up
- **WHEN** a user signs up on a self-hosted instance with telemetry on
- **THEN** PostHog SHALL receive `user_signed_up_v1` with distinct id `<instance_id>:<user_id>`, no email and no instance URL

#### Scenario: Cloud keeps its identity
- **WHEN** a user signs up on cloud
- **THEN** the events SHALL use the email as today

### Requirement: Same id in the API and the browser
The `<user_id>` part SHALL be the user's id in the instance database, both ids in lowercase UUID form. The API SHALL compute the distinct id in one function and SHALL give it to the browser through `GET /instance/telemetry`, together with whether telemetry is on and the group to send. The browser SHALL NOT compute its own id. An email change, a new device or a new sign-in SHALL keep the same id.

#### Scenario: Email change
- **WHEN** a user changes their email
- **THEN** their next events SHALL use the same distinct id as before

#### Scenario: Second device
- **WHEN** a user signs in from a second browser
- **THEN** the browser events and the API events SHALL use the same distinct id as on the first browser

### Requirement: Licensed instances cannot turn telemetry off
When the instance has a valid paid license key (any plan but `self_hosted_registered`), Agenta SHALL ignore `AGENTA_TELEMETRY_ENABLED=false` and SHALL keep sending the heartbeat and per-user events, unless the key carries `telemetry: "exempt"`. The startup log SHALL say that the license requires telemetry. The registration key SHALL NOT override the switch.

#### Scenario: Paid key and switch off
- **WHEN** a paid key is active and the switch is `false`
- **THEN** the heartbeat SHALL still be sent, and the log SHALL name the license as the reason

#### Scenario: Air-gapped contract
- **WHEN** a paid key carries `telemetry: "exempt"`
- **THEN** the switch SHALL work as on an unlicensed instance

### Requirement: Telemetry docs page
The self-hosting docs SHALL have one page that lists every event and field the instance sends to Agenta, what is always sent (install ping, update check, heartbeat under a paid key), what the switch stops, and the settings. A unit test SHALL fail when the heartbeat or install ping payload model and the page's table differ. The privacy page SHALL stop calling self-hosted analytics "anonymized" unless it is true.

#### Scenario: A field is added to the heartbeat
- **WHEN** a developer adds a field to the heartbeat model without adding it to the docs table
- **THEN** the unit test SHALL fail and name the field

### Requirement: Hosting templates
The compose, Helm and Railway templates SHALL set `AGENTA_DEPLOYMENT_METHOD` (`compose`, `helm` or `railway`), and SHALL document `AGENTA_TELEMETRY_ENABLED` and `AGENTA_UPDATE_CHECK_ENABLED` next to it. When it is unset, the heartbeat SHALL send `deployment_method: null`.

#### Scenario: Fresh install from the quick start
- **WHEN** an operator copies the example env file and starts the stack
- **THEN** the heartbeat SHALL carry `deployment_method: "compose"` and no event SHALL carry an email
