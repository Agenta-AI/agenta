# MCP OAuth registration delta

## MODIFIED Requirements

### Requirement: Resolve an OAuth client
Agenta SHALL reuse a stored client registration that covers the current callback URL. Otherwise it SHALL use dynamic client registration when the issuer advertises a registration endpoint. In the absence of that endpoint, it SHALL use a client metadata document only when the issuer explicitly advertises support and Agenta's API address is public HTTPS. It SHALL report unsupported registration if neither method is advertised, and unavailable registration if document support exists but the API address is unsuitable.

#### Scenario: Dynamic registration is advertised
- **WHEN** no reusable registration exists and the issuer advertises a registration endpoint
- **THEN** Agenta registers a client and stores its registration for reuse.

#### Scenario: No automatic registration method is advertised
- **WHEN** no reusable registration exists and the issuer advertises neither dynamic registration nor metadata-document support
- **THEN** Agenta refuses automatic consent with an actionable registered-client requirement
- **AND** it does not use the metadata URL as an invented client ID.

#### Scenario: Document support is explicit
- **WHEN** no reusable registration or registration endpoint exists, document support is true, and Agenta has a publicly resolvable HTTPS API address
- **THEN** Agenta uses the public client metadata URL as its client ID.

#### Scenario: Document support exists but the address is unsuitable
- **WHEN** the issuer supports metadata documents but Agenta cannot expose the document at public HTTPS
- **THEN** Agenta reports registration unavailable instead of beginning broken consent.

### Requirement: Report the registration strategy
The probe SHALL report OAuth metadata and classify registration as dynamic, metadata, unsupported, or unavailable. For unsupported registration it SHALL indicate whether the provider requires a client secret, based on the discovered token authentication methods.

#### Scenario: A confidential client is needed
- **WHEN** automatic registration is unsupported and the issuer does not advertise the `none` token authentication method
- **THEN** the probe reports unsupported registration and requires a client secret.

#### Scenario: A public client is allowed
- **WHEN** automatic registration is unsupported and the issuer advertises the `none` token authentication method
- **THEN** the probe permits a client ID without a client secret.

#### Scenario: A local deployment cannot use a metadata document
- **WHEN** document support is advertised, no registration endpoint exists, and Agenta's API address is not public HTTPS
- **THEN** the probe reports unavailable registration.
