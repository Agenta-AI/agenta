## ADDED Requirements

### Requirement: One image runs the enterprise code path

Every published API image SHALL contain the `ee` package and run the enterprise code path, whatever `AGENTA_LICENSE` says, and the license key SHALL decide the plan.

#### Scenario: Open source env file

- **WHEN** the new `agenta-api` image starts with an env file that sets `AGENTA_LICENSE=oss` and no license key
- **THEN** the enterprise routes are registered, the instance plan is `self_hosted_community`, and `PUT /instance/license` accepts a key from the instance admin

#### Scenario: Free key on an upgraded open source install

- **WHEN** the instance admin of an upgraded open source install opens the activation link from the free key email
- **THEN** the License tab adds the key and the plan becomes `self_hosted_registered`

#### Scenario: Cloud

- **WHEN** `AGENTA_LICENSE_KEY` holds a valid cloud key and Stripe is set
- **THEN** the install is cloud, as today

### Requirement: Existing databases keep their names

The database name prefix SHALL default to `agenta_{AGENTA_LICENSE}`, with `oss` when `AGENTA_LICENSE` is unset, and `POSTGRES_DB_PREFIX` and `POSTGRES_URI_*` SHALL keep overriding it.

#### Scenario: Open source install upgrades

- **WHEN** an install with `AGENTA_LICENSE=oss` and databases `agenta_oss_*` pulls the new image and restarts
- **THEN** the API uses `agenta_oss_core`, `agenta_oss_tracing` and `agenta_oss_supertokens`

#### Scenario: Enterprise install upgrades

- **WHEN** an install with `AGENTA_LICENSE=ee` pulls the new image
- **THEN** the API uses `agenta_ee_*`

### Requirement: One migration runner adopts open source databases

Both runner modules SHALL run the same chains, pick the legacy chain from the database state, and on an open source database SHALL add the enterprise tables and write project membership rows so that every member keeps the projects they had.

#### Scenario: Open source database at v0.129

- **WHEN** the runner starts on an open source database at v0.129 through the module `oss.databases.postgres.migrations.runner`
- **THEN** it runs `core_oss`, `core_ee` and the tracing chains, every organization gets a subscription row, and every member can open every project they could open before

#### Scenario: Enterprise database

- **WHEN** the runner starts on an enterprise database
- **THEN** it runs the pending revisions and writes no new membership rows

#### Scenario: Fresh database

- **WHEN** the runner starts on an empty database
- **THEN** it creates the full schema

#### Scenario: Unknown legacy revision

- **WHEN** the `alembic_version` table of the core database holds a revision the runner does not know
- **THEN** the runner stops before any change and logs which revision it found

### Requirement: Self-hosted installs are not treated as cloud

Outside cloud, the API SHALL apply no throttles for a plan that has none, the SDK SHALL keep today's rule for provider keys from the environment (on unless `AGENTA_LICENSE` is `ee`, and `AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED` overrides it; decided 2026-11-25), and `/m` SHALL use cloud settings only on cloud.

#### Scenario: Slow routes on an instance with no key

- **WHEN** an instance with no key sends 200 requests to a slow route within a minute
- **THEN** none is refused with HTTP 429

#### Scenario: Provider key in the env file

- **WHEN** an upgraded open source install has `OPENAI_API_KEY` in its env file and runs a prompt in the playground
- **THEN** the call uses that key

#### Scenario: Analytics on self-hosted

- **WHEN** a self-hosted operator sets `POSTHOG_API_KEY`
- **THEN** `/m` uses the self-hosted analytics settings, not the cloud ones

### Requirement: Old compose, Helm and Railway files keep working

An install at v0.104.0 or later SHALL upgrade by pulling the new images under today's public names and restarting, with no edits to its compose file, Helm values or Railway template. An older install first upgrades to v0.129.x (Decision 4 in design.md).

#### Scenario: Compose pull and restart

- **WHEN** an open source compose install runs `docker compose pull` and `docker compose up -d` with its existing files
- **THEN** every service starts, the migration job succeeds, and the existing data is there

#### Scenario: Install older than v0.104.0

- **WHEN** an open source install older than v0.104.0 pulls the new images and starts
- **THEN** the migration runner stops before any change and tells the operator to upgrade to v0.129.x first; this path is checked by a static review of the runner, not by a live upgrade test

### Requirement: Sign-in methods follow the deployment without the access entitlement

On every plan without the access entitlement, the sign-in check SHALL read `allow_email` and `allow_social` from the deployment settings instead of the organization's stored flags, and SHALL keep the stored SSO and root flags.

#### Scenario: Open source organization after the upgrade

- **WHEN** an organization created on an open source install stored `allow_social` false, and the operator later turned on social sign-in for the deployment
- **THEN** after the upgrade a member can sign in with social sign-in on a plan without the access entitlement

#### Scenario: SSO after a paid key expires

- **WHEN** an organization set up SSO under a paid key and the key expires
- **THEN** the stored SSO flag stays and SSO sign-in keeps working

### Requirement: One install event

The one image SHALL NOT add an install event of its own. The install event SHALL be the anonymous `instance_installed` from #8237, and the sign-up event SHALL carry `is_cloud` instead of `is_ee`.

#### Scenario: Upgraded open source install starts

- **WHEN** an upgraded open source install starts for the first time
- **THEN** it sends no `self_hosted_deployment_created` event, and the install event comes only from the #8237 code

#### Scenario: Sign-up on self-hosted

- **WHEN** a person signs up on a self-hosted install
- **THEN** the sign-up event carries `is_cloud` false and no `is_ee`
