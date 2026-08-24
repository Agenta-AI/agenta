# WP32 — Bedrock/Vertex endpoint base URL validation and coverage

Close OR17. The endpoint `base_url` is an upstream host for Bedrock and a host plus the permitted
shared prefix for Vertex; protocol doors append only their own path tail.

## Scope

- Validate the exact accepted shape for each deployment and reject unrelated paths, query strings,
  fragments, and invalid hosts.
- Add representative Bedrock and Vertex endpoint fixtures with explicit base URLs.
- Cover every supported protocol door, including the static field-rewrite doors, proving the route
  does not silently select another endpoint or capability.

## Required verification

- **Unit:** deployment-specific URL grammar, malformed-value rejection, and route construction.
- **Integration:** registered Bedrock/Vertex endpoint fixtures reach every translated protocol
  door and static rewrite without live cloud credentials.
- **Acceptance:** OSS and EE gateway socket calls prove each deployment uses its configured
  `base_url` and never falls back to another endpoint or capability.

## Done when

All supported Bedrock and Vertex routes use the configured endpoint deterministically, malformed
base URLs fail at registration, and tests require no live AWS or Google credentials.
