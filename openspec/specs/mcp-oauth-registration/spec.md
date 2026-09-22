# MCP OAuth registration

## Purpose

Record the existing client-selection behavior at main commit `5e36059503e8bb76500a7cec2caf5cb86e8ee01d`. OAuth is the authorization protocol through which a user grants access. A client registration identifies Agenta to the provider; a grant contains an individual connection's tokens. This baseline deliberately records the unsupported-registration defect corrected by the active change. It is not the desired final behavior.

## Requirements

### Requirement: Resolve an OAuth client
Agenta SHALL reuse a stored client registration that covers the current callback URL. Otherwise it SHALL use dynamic client registration when the issuer advertises a registration endpoint. In the absence of that endpoint, it SHALL use its client metadata document when its API address is public HTTPS, or report registration unavailable otherwise.

#### Scenario: Dynamic registration is advertised
- **WHEN** no reusable registration exists and the issuer advertises a registration endpoint
- **THEN** Agenta registers a client and stores its registration for reuse.

#### Scenario: No automatic registration method is advertised
- **WHEN** no reusable registration or registration endpoint exists and Agenta has a publicly resolvable HTTPS API address
- **THEN** this baseline uses Agenta's metadata URL as the client ID without checking explicit provider support
- **AND** providers that reject that identity cannot complete consent.

### Requirement: Report the registration strategy
The probe SHALL report OAuth metadata and classify registration as dynamic, metadata, or unavailable. It SHALL describe deployment-address limitations before asking the person to continue.

#### Scenario: A local deployment cannot use a metadata document
- **WHEN** no registration endpoint exists and Agenta's API address is not public HTTPS
- **THEN** the probe reports unavailable registration.

### Requirement: Preserve grant and registration association
Agenta SHALL keep access and refresh tokens in the project vault, the existing write-only secret store. It SHALL retain the registration association used to issue a grant and reject a changed issuer during refresh.

#### Scenario: The server changes its issuer
- **WHEN** refreshed discovery names an issuer different from the one pinned to the grant
- **THEN** Agenta refuses to present the refresh token to the changed issuer.
