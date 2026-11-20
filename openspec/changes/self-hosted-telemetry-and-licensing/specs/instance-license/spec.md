# Instance license

## Purpose

Let an instance admin turn on paid or registered features from inside a self-hosted instance with a key, checked offline, so the instance needs no license server to run. Key checks and plan resolution are enterprise code and run on the EE image until one image ships.

## ADDED Requirements

### Requirement: Signed license key
A license key SHALL be the text `agenta_license_v1.<payload>.<signature>`: base64url JSON with `key_id` (UUID), `plan`, `customer` (the customer's name), `seats` (a number, or null for no limit), `issued_at`, `expires_at` (null for no expiry) and `telemetry` (`required` or `exempt`), and an Ed25519 signature of the payload part. Agenta SHALL sign with a private key kept outside the repository. The instance SHALL check with a public key in the code, with no network call.

#### Scenario: Valid key
- **WHEN** an instance admin adds a key whose signature checks, whose `key_id` is not on the refusal list in the code, and whose `expires_at` is null or in the future
- **THEN** the instance SHALL use the key's `plan` for every organization on the instance

#### Scenario: Tampered key
- **WHEN** any part of the key was changed after signing
- **THEN** the instance SHALL refuse the key with "This license key is not valid" and SHALL keep the current plan

#### Scenario: No internet
- **WHEN** the instance has no outbound network
- **THEN** adding and checking a key SHALL still work

### Requirement: Instance admin
An instance admin SHALL be a user whose email is in `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS`, or, when that list is unset, the owner of the oldest organization. Only an instance admin SHALL see the License page, add a key or register the instance. The API SHALL check this on every license route, not only in the browser.

#### Scenario: Organization owner who is not an instance admin
- **WHEN** the owner of a second organization opens the License page
- **THEN** the page SHALL say that only an instance admin can manage the license, and the API SHALL refuse the license routes for that user

### Requirement: Key from the License page, a link, or the environment
Agenta SHALL accept a key in three ways: pasted by an instance admin on a License page in settings, through a link to that page with the key in the URL fragment (`#key=`, so it never reaches a server log), and from `AGENTA_LICENSE_KEY`. A key from the environment SHALL take priority and SHALL make the page read-only. The page SHALL show the plan, the customer, seats used and allowed, and the expiry date.

#### Scenario: Activation link
- **WHEN** an instance admin opens the link from the registration email while signed in
- **THEN** the page SHALL ask them to confirm, then activate the key and show the plan

#### Scenario: Non-admin opens the link
- **WHEN** a user who is not an instance admin opens the link
- **THEN** the page SHALL say that only an instance admin can add a license and SHALL NOT activate it

#### Scenario: OSS image
- **WHEN** an instance admin opens the License page on the OSS image
- **THEN** the page SHALL show the plan "Community" and the registration form, and SHALL say that license keys need the Enterprise image, with a link to the upgrade docs, in place of the key field

### Requirement: Expiry and seats
When a key expires, the instance SHALL fall back to `self_hosted_community` and SHALL keep all data. From 30 days before expiry, instance admins SHALL see a notice with the date. When users exceed `seats`, the instance SHALL keep working and SHALL show instance admins a notice; it SHALL NOT block sign-in in v1.

#### Scenario: Key expired
- **WHEN** `expires_at` has passed
- **THEN** enterprise screens SHALL show their locked state, existing users SHALL keep signing in, and no data SHALL be deleted

### Requirement: Registration key
On a self-hosted instance with no paid key, on either image, an instance admin SHALL be able to register by entering an email and agreeing to product updates. The API SHALL send the email, instance id, version and web URL (only to build the link, not stored) to Agenta. Agenta SHALL email a key with `plan: "self_hosted_registered"`, `expires_at: null`, the email as `customer`, and an activation link. No telemetry event SHALL carry this email.

#### Scenario: Request a registration key
- **WHEN** an instance admin submits the form
- **THEN** the page SHALL say "We sent your key to <email>" and SHALL activate nothing until the admin uses the key

#### Scenario: Agenta endpoint unreachable
- **WHEN** the request fails
- **THEN** the page SHALL say it could not reach Agenta and suggest trying again later, without technical detail

### Requirement: Plan without a key
On an instance without Stripe, every organization's plan SHALL be the plan of the valid license key, or `self_hosted_community` when there is none, whatever its stored subscription says. `AGENTA_ACCESS_DEFAULT_PLAN` and env plan overrides SHALL NOT give such an instance an enterprise flag without a key. With Stripe set up, the plan SHALL come from the subscription, as today.

#### Scenario: EE image, no key, no Stripe
- **WHEN** an EE instance starts with no key and no Stripe setup
- **THEN** it SHALL run on `self_hosted_community` and the enterprise screens SHALL show their locked state

#### Scenario: Env var tries to unlock enterprise
- **WHEN** an instance without Stripe and without a key sets `AGENTA_ACCESS_DEFAULT_PLAN=self_hosted_enterprise`
- **THEN** it SHALL still run on `self_hosted_community` and SHALL log one warning at startup

### Requirement: Community and registered plans
The plan table in `api/ee/src/core/access/entitlements/types.py` SHALL gain `self_hosted_community` and `self_hosted_registered`. Both SHALL have all five enterprise flags off and no seat or usage limits. `get_free_plan()` SHALL stay the cloud free plan. Feature checks SHALL keep using the existing entitlement helpers.

#### Scenario: Instance admin registers today
- **WHEN** an instance admin activates a registration key on a release that has added no features to the plan
- **THEN** the License page SHALL show "Registered" and every enterprise screen SHALL stay locked

#### Scenario: Registered plan gains a feature in a release
- **WHEN** a release adds a feature to `self_hosted_registered` in the plan table
- **THEN** every instance on that plan SHALL get it after upgrading, with the same key
