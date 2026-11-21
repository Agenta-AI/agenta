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

### Requirement: Translated refusal in /m

`/m` SHALL show the refusals `project_limit_reached` and `instance_organization_limit_reached` as translated text in all 7 locales, with a next step that depends on whether the person is the instance admin.

#### Scenario: Instance admin hits the project limit

- **WHEN** the instance admin creates a second project in an organization on an instance with no key
- **THEN** `/m` shows the translated project limit message and a button that opens the License tab

#### Scenario: Member hits the project limit

- **WHEN** a person who is not the instance admin hits the project limit
- **THEN** `/m` shows the translated message that tells them to ask their instance admin, and no License button

#### Scenario: Person with no organization

- **WHEN** a signed-in person belongs to no organization
- **THEN** `/m` tells them they need an invitation to an organization, instead of "No projects found."
