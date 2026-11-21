## ADDED Requirements

### Requirement: The OSS image accepts a license key

The OSS image SHALL check, store and apply a license key through `PUT /instance/license` and `AGENTA_LICENSE_KEY`, with the same signature check and the same instance admin rule as the EE image.

#### Scenario: Instance admin adds the free key on OSS

- **WHEN** the instance admin of an OSS instance sends a valid `self_hosted_registered` key to `PUT /instance/license`
- **THEN** the API stores it and `GET /instance/license` answers plan `self_hosted_registered`

#### Scenario: Activation link on OSS

- **WHEN** the instance admin opens the activation link from the free key email on an OSS instance
- **THEN** the License tab adds the key, as on EE

#### Scenario: Key in the environment on OSS

- **WHEN** `AGENTA_LICENSE_KEY` holds a valid key on the OSS image
- **THEN** the instance plan is the key's plan, and `PUT /instance/license` answers HTTP 409

#### Scenario: Invalid key on OSS

- **WHEN** someone sends a key with a bad signature to `PUT /instance/license` on OSS
- **THEN** the API answers HTTP 400 and the plan stays as it was

#### Scenario: Paid key on OSS

- **WHEN** an OSS instance has an active `self_hosted_enterprise` key
- **THEN** the project and organization limits do not apply, and enterprise features such as the audit log and the full role catalog stay unavailable because the OSS image does not ship them

#### Scenario: Cloud key on OSS

- **WHEN** `AGENTA_LICENSE_KEY` holds a cloud key on the OSS image
- **THEN** the install is not treated as cloud
