## ADDED Requirements

### Requirement: Project limit by instance plan

On an install that is not cloud, `POST /projects/` SHALL refuse a new project when the organization already has as many projects as the instance plan allows: 1 for `self_hosted_community`, no limit for every other plan unless the limits table says otherwise.

#### Scenario: Upgraded open source install with no key, second project

- **WHEN** an organization on an install that came from the open source image, with no license key has 1 project and a member with the right to create projects calls `POST /projects/`
- **THEN** the API answers HTTP 403 with `detail.code` equal to `project_limit_reached` and `detail.limit` equal to 1, and no project is created

#### Scenario: Enterprise install with no key

- **WHEN** an organization on an install that came from the enterprise image, with no license key has 1 project and a member calls `POST /projects/`
- **THEN** the API answers HTTP 403 with `detail.code` equal to `project_limit_reached`

#### Scenario: Free key

- **WHEN** the instance has an active `self_hosted_registered` key and an organization with 1 project creates another
- **THEN** the project is created

#### Scenario: Paid key

- **WHEN** the instance has an active key with a paid plan and an organization with 1 project creates another
- **THEN** the project is created

#### Scenario: Expired key

- **WHEN** the instance key has expired and an organization with 1 project creates another
- **THEN** the API answers HTTP 403 with `detail.code` equal to `project_limit_reached`

#### Scenario: Existing projects are kept

- **WHEN** an organization already has 4 projects and the instance plan allows 1
- **THEN** all 4 projects stay readable and usable, and only a fifth is refused

#### Scenario: Plan read fails

- **WHEN** reading the instance plan raises an error
- **THEN** the project is created and the error is logged

### Requirement: Cloud project limit unchanged

On cloud, `POST /projects/` SHALL keep the Stripe plan limit from `PROJECT_LIMITS` and SHALL answer its refusal with `detail.code` equal to `project_limit_reached`.

#### Scenario: Hobby organization

- **WHEN** a cloud organization on `cloud_v0_hobby` has 1 project and creates another
- **THEN** the API answers HTTP 403 with `detail.code` equal to `project_limit_reached` and the Hobby message in `detail.message`

### Requirement: Organization limit by instance plan

On an install that is not cloud, `POST /organizations/` SHALL refuse a new organization when the instance already has as many organizations (not deleted) as the plan allows: 1 for `self_hosted_community` and `self_hosted_registered`, no limit for a paid plan.

#### Scenario: Second organization without a paid key

- **WHEN** the instance has 1 organization, no paid key, and a user calls `POST /organizations/`
- **THEN** the API answers HTTP 403 with `detail.code` equal to `instance_organization_limit_reached` and `detail.limit` equal to 1

#### Scenario: Paid key

- **WHEN** the instance has an active paid key and 1 organization, and a user calls `POST /organizations/`
- **THEN** the organization is created

#### Scenario: Cloud

- **WHEN** the install is cloud and a user calls `POST /organizations/`
- **THEN** the instance organization limit does not apply

#### Scenario: Existing organizations are kept

- **WHEN** an instance with no key already has 3 organizations
- **THEN** all 3 stay, and a fourth is refused

#### Scenario: Two requests at the same moment (accepted race)

- **WHEN** an instance with no paid key and no organization gets two organization creations at the same moment
- **THEN** both can pass the check, because the check counts and then creates with no lock; the instance keeps both organizations, and every later creation is refused

### Requirement: Sign-up skips the personal organization at the limit

During sign-up, `create_accounts` SHALL skip the personal organization, without raising, when the instance is at its organization limit, and the new user SHALL stay signed up.

#### Scenario: Second person signs up on an OSS instance

- **WHEN** an instance with no paid key has 1 organization and a new person signs up
- **THEN** the user is created, no organization is created for them, and the sign-up succeeds

#### Scenario: First person on a new instance

- **WHEN** an instance has no organization and the first person signs up
- **THEN** the user and their organization are created, as today

#### Scenario: Invited person signs up

- **WHEN** an instance at its organization limit has a pending invitation for a new person and that person signs up
- **THEN** the user is created with no personal organization and can accept the invitation

### Requirement: Limits shown in /m before and at a refusal

`/m` SHALL read the usage when the project or organization dialog opens, SHALL keep Create off at the limit, and SHALL show `project_limit_reached` and `instance_organization_limit_reached` as translated text in all 7 locales, with a next step that depends on whether the person is the instance admin.

#### Scenario: Instance admin at the project limit

- **WHEN** the instance admin opens the create project dialog in an organization that uses 1 of 1 projects
- **THEN** `/m` shows the count with a bar, keeps Create off, shows "Register this instance for free to create more projects." and a "Register this instance" button that opens the registration in place

#### Scenario: Member at the project limit

- **WHEN** a person who is not the instance admin opens the create project dialog at the limit
- **THEN** `/m` shows "Ask your instance admin to register this instance for more projects." and no register button

#### Scenario: Organization limit

- **WHEN** a person opens the create organization dialog on an instance at its organization limit
- **THEN** `/m` shows the limit, keeps Create off, and names a paid license key or an invitation, never the free key

#### Scenario: Refusal from the API

- **WHEN** a create call answers HTTP 403 with one of the two codes
- **THEN** `/m` shows the translated text for that code instead of the English `detail.message`

#### Scenario: Settings projects list

- **WHEN** the instance admin opens Settings > Projects in an organization that uses 1 of 1 projects
- **THEN** `/m` shows "This organization uses 1 of 1 projects" with a Register button

#### Scenario: Person with no organization

- **WHEN** a signed-in person belongs to no organization
- **THEN** `/m` shows a card that names who to ask and the signed-in account, with "Check again" and "Sign out", instead of "No projects found."

### Requirement: Usage in the license API

`GET /instance/license` SHALL return `usage.projects` for the request's organization and `usage.organizations` for the instance, each as `{count, limit}` with `limit` null for no limit, and `GET /instance/license/usage` SHALL return the same usage to any person signed in to the app.

#### Scenario: Instance with no key

- **WHEN** an instance with no key has 1 organization with 1 project and a member calls `GET /instance/license/usage`
- **THEN** the answer has `projects` `{count: 1, limit: 1}` and `organizations` `{count: 1, limit: 1}`

#### Scenario: Paid key

- **WHEN** the instance has an active paid key
- **THEN** both limits are null

#### Scenario: Not signed in

- **WHEN** a caller with no app session calls `GET /instance/license/usage`
- **THEN** the API refuses the call

### Requirement: Registration step in onboarding

`/m` SHALL show the registration as a full onboarding step right after the survey, with "Send me a free key" and "Skip". The updates box SHALL start ticked and SHALL be optional. The setup answers SHALL go with every registration.

#### Scenario: Register with the box ticked

- **WHEN** a new admin finishes the survey and sends the registration with the box ticked
- **THEN** the free key is sent, the Loops contact gets `agentaProductUpdates` true, and the setup answers are stored on it

#### Scenario: Register with the box unticked

- **WHEN** the admin unticks "Send me security and product updates (about once a month)" and sends the registration
- **THEN** the free key is still sent, `agentaProductUpdates` is false, and security notices still reach that email

#### Scenario: Skip

- **WHEN** the admin selects "Skip"
- **THEN** onboarding goes on, and the License tab, the project limit dialog and Settings > Projects still offer the registration

#### Scenario: Answers are labels only

- **WHEN** the admin typed free text for "Other" in the survey
- **THEN** the registration carries only the chosen option labels, never the typed text

### Requirement: One-time registration prompt on upgraded installs

The instance admin of an install with no key that skipped onboarding SHALL see the registration step once as a prompt, and a skip SHALL be stored on the server through `POST /instance/license/registration-prompt/dismiss`.

#### Scenario: First visit after the upgrade

- **WHEN** the instance admin of an upgraded open source install opens `/m` for the first time after the upgrade
- **THEN** `/m` shows the registration prompt

#### Scenario: Skipped once

- **WHEN** the admin skipped the prompt and opens `/m` later in another browser
- **THEN** `GET /instance/license` reports the skip and the prompt does not show

#### Scenario: Member

- **WHEN** a person who is not the instance admin opens `/m`
- **THEN** no registration prompt shows

### Requirement: Free key tied to the instance

The API SHALL accept a `self_hosted_registered` key only when its instance id is this instance's id, on activation and when it reads a stored or environment key. Paid keys SHALL stay untied.

#### Scenario: Key from this instance

- **WHEN** the instance admin adds the free key that this instance registered for
- **THEN** the plan becomes `self_hosted_registered`

#### Scenario: Key from another instance

- **WHEN** a free key that names another instance id is added or set in `AGENTA_LICENSE_KEY`
- **THEN** the plan stays `self_hosted_community` and the License tab says the key belongs to another instance

#### Scenario: Paid key on any instance

- **WHEN** a valid paid key is added on an instance it was not issued from
- **THEN** the paid plan applies

### Requirement: Registration links the instance to the email

The website worker SHALL store the registration on the Loops contact with the `agenta*` fields and SHALL send `instance_registered` to the self-hosted PostHog project, whatever the instance telemetry switch says. An instance that does not register SHALL stay anonymous.

#### Scenario: Loops contact

- **WHEN** a registration succeeds
- **THEN** the contact has `source` "self-hosted registration", `userGroup` "self-hosted", and `agentaInstanceId`, `agentaVersion`, `agentaRegisteredAt`, `agentaPlan`, `agentaRole`, `agentaTeamSize`, `agentaHeardFrom` and `agentaProductUpdates`

#### Scenario: PostHog join

- **WHEN** a registration succeeds
- **THEN** PostHog gets `instance_registered` with distinct id the instance id and group `instance`, a `$groupidentify` with `registered_email`, and `$set: {email}` on the person `<instance_id>:<user_id>`

#### Scenario: Survey event carries no email

- **WHEN** the self-hosted survey event is sent
- **THEN** it carries no email

### Requirement: License tab and locked pages

The License tab SHALL show the plan with usage bars, one "Register this instance for free" card before a key, a "Registered" badge after a free key, the days left for a paid key, and an "Add a license key" dialog. Each locked enterprise page SHALL show one "Available on the Enterprise plan" box.

#### Scenario: Before a key

- **WHEN** the instance admin opens the License tab on an instance with no key
- **THEN** it shows the "Community" plan, the project and organization bars, the registration card and "Add a license key"

#### Scenario: After a free key

- **WHEN** the instance has its free key
- **THEN** the tab shows "Community" with a "Registered" badge and no registration card

#### Scenario: After a paid key

- **WHEN** the instance has a paid key
- **THEN** the tab shows the plan, the seats bar and the days left

#### Scenario: Locked page

- **WHEN** a person opens an enterprise page on a plan that does not include it
- **THEN** the page shows one compact "Available on the Enterprise plan" box and the settings below stay visible and read only
