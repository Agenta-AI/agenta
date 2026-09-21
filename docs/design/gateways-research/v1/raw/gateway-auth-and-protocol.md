# LLM and MCP Gateway: Authentication and Protocol Design

## Purpose

Provide one gateway for coding-agent harnesses such as Codex, Claude Code, and OpenCode, while allowing different upstream authentication methods and preserving native model protocols.

The gateway is responsible for:

- Gateway user identity and tenancy
- Authorization, policy, rate limits, and budgets
- Usage tracking, audit events, and observability
- Selecting approved upstream destinations
- Protecting upstream credentials
- MCP access control and tool governance

The gateway is not, initially, a universal model-protocol translator.

## Core principles

1. `X-AG-Credentials` is the gateway's credential signal. Its value is opaque to clients and is validated only by the gateway.
2. Provider authentication and gateway authentication are independent.
3. Provider credentials never leave the gateway in gateway-owned API/cloud modes.
4. In subscription pass-through mode, the user's vendor subscription authentication stays in the harness and is forwarded unchanged.
5. The gateway never forwards `X-AG-Credentials` to an upstream provider.
6. Model protocols are forwarded natively whenever possible; do not translate formats merely to route traffic.

## Credentials header

Clients send the gateway identity in a dedicated header:

```http
X-AG-Credentials: <ag-credentials>
```

The header is separate from the provider's own API key, OAuth token, cloud identity, or subscription session.

Gateway processing must:

- Authenticate and authorize `<ag-credentials>`.
- Associate the request with a gateway user, tenant, and policy context.
- Remove the header before the upstream request is made.
- Redact the header from application logs, traces, errors, recordings, and support exports.

The gateway should support revocation, expiry, rotation, scoping, and device or installation binding according to its own credential design. This document deliberately does not prescribe the credential's shape.

## Model authentication modes

### 1. Gateway-owned upstream authentication

Use this mode for centrally managed API and cloud-provider access.

```text
Harness
  X-AG-Credentials: <ag-credentials>
        |
        v
AG Gateway
  - authenticate gateway user
  - apply policy and select route
  - obtain upstream credential from a vault or workload identity
        |
        v
Provider API or cloud endpoint
```

The gateway may authenticate upstream using:

- Provider API keys
- AWS IAM roles and SigV4 for Bedrock
- Google service accounts or workload identity for Vertex AI
- Azure managed identity or API credentials
- A tenant-specific or user-supplied API credential stored in a secure vault

The harness receives no upstream secret. Upstream billing belongs to the account selected by the gateway.

### 2. Subscription pass-through

Use this mode only where a harness has a vendor-supported subscription login and can route requests through the gateway.

```text
Harness
  vendor subscription authentication
  X-AG-Credentials: <ag-credentials>
        |
        v
AG Gateway
  - authenticate gateway user
  - authorize pass-through route
  - remove X-AG-Credentials
  - preserve vendor authentication
        |
        v
Vendor subscription service
```

The provider continues to authenticate and bill the user's subscription. The gateway credential supplies the gateway's own attribution, tenancy, policy, and audit context.

The gateway should not centralize or replay subscription session files as a substitute for per-user vendor authentication. Those sessions are user credentials, may be renewable or device-bound, and do not provide a safe general-purpose service-credential model. A gateway credential cannot itself prove entitlement to a user's vendor subscription.

If it matters that the gateway user and the provider subscription principal are the same person, use a provider-supported identity claim, introspection mechanism, or explicit account-pairing workflow. Do not depend on parsing or retaining opaque subscription tokens.

### 3. Hybrid local-agent mode

Some harnesses may not support custom outbound headers or refreshable gateway credentials. Use a local agent in that case.

```text
Harness --> local AG agent --> AG Gateway --> provider
                |                 |
          vendor auth        gateway identity
```

The local agent can authenticate to the gateway using a short-lived credential or mTLS and add the gateway identity without changing the harness's native provider login behavior.

## Harness configuration model

Every harness needs two independently configurable concepts:

1. The model provider base URL, pointed at the AG Gateway.
2. A way to attach `X-AG-Credentials: <ag-credentials>`.

For subscription pass-through, do not configure a provider API-key override that causes the harness to stop using its subscription login.

Conceptually:

```text
base URL:          https://gateway.example
gateway identity:  X-AG-Credentials: <ag-credentials>
provider identity: harness-managed subscription login, or gateway-managed upstream auth
```

Claude Code supports a custom-header mechanism and a base-URL override. OpenCode supports provider-specific request headers and a base URL. Codex provider configuration supports additional fixed or environment-derived HTTP headers. Validate behavior against the exact harness release before rollout.

## Protocol-preserving proxy

The gateway's initial model plane should be a protocol-aware but body-preserving reverse proxy.

```text
/v1/responses          -> OpenAI Responses upstream
/v1/chat/completions   -> OpenAI Chat Completions upstream
/v1/messages           -> Anthropic Messages upstream
```

For an approved route, the gateway forwards:

- Request method and path
- Request body without semantic translation
- Required provider headers, including capability or beta headers
- Server-Sent Events (SSE) streams without changing their event format
- Provider response body, status, and relevant headers

This avoids the fragility of translating one provider's tool-use, reasoning, cache, streaming, and structured-output semantics into another provider's API format.

### Permitted inspection

“Pass-through” does not mean no gateway processing. The gateway must at least inspect or control:

- Destination and route
- HTTP method and endpoint
- Gateway identity and authorization result
- Presence of required provider authentication
- Status, latency, request/response byte counts, and errors
- Token usage when supplied in an upstream response or terminal stream event

If policy is model-specific, the gateway must additionally inspect the model field. If the body must remain fully opaque, enforce policy at the endpoint, credential, tenant, or route level instead.

## Routing and policy

On every model request:

1. Authenticate `X-AG-Credentials`.
2. Determine the gateway user, tenant, project, and applicable policy.
3. Classify the request by protocol endpoint and approved route.
4. Verify the required authentication mode:
   - valid vendor subscription authentication for pass-through; or
   - gateway-owned upstream authentication for API/cloud routes.
5. Enforce allowed endpoints, providers, models, rate limits, budgets, and data policy.
6. Remove gateway-only headers and forward the request.
7. Stream the response back while collecting permitted telemetry.
8. Emit an audit event with gateway identity, route, protocol, timing, status, and usage.

The gateway should fail closed when a route is unknown, a required credential is missing, or a protocol feature cannot be preserved.

## Observability and audit

Record gateway metadata separately from provider metadata.

Recommended fields:

- Gateway user and tenant
- Harness and harness version, where available
- Route and protocol endpoint
- Provider and model, where safely available
- Authentication mode: `gateway-owned`, `subscription-pass-through`, or `byok`
- Request ID and upstream request ID
- Start/end time, latency, status, retry count, and stream outcome
- Token usage and cost only when reliably reported
- Policy decision and denial reason

Avoid recording prompts, completions, provider authorization values, or `X-AG-Credentials` by default. Make payload capture an explicit, access-controlled, retention-limited feature.

## MCP gateway

The MCP plane is independent of model authentication.

```text
Harness --> AG MCP Gateway --> approved MCP servers
```

The MCP gateway should use the same gateway identity model, with `X-AG-Credentials` or the equivalent identity mechanism for the selected MCP transport. It can then:

- Expose only permitted tools by tenant, user, project, or environment
- Perform OAuth or API-key handling for downstream MCP services
- Apply per-tool authorization and audit logging
- Enforce output and data-handling limits
- Aggregate multiple downstream MCP servers behind one endpoint

Users may use a direct vendor model subscription while still using the AG MCP Gateway for centralized tool governance.

## Explicit non-goals for the first version

- Translating Anthropic Messages into OpenAI Responses, or the reverse
- Advertising universal feature compatibility across models
- Treating vendor subscription sessions as centrally managed service credentials
- Forwarding gateway credentials to providers
- Storing secrets in harness configuration files or source control

## Recommended rollout order

1. Implement a body-preserving proxy for one provider protocol and one upstream route.
2. Add `X-AG-Credentials` validation, header stripping, audit events, and rate limits.
3. Add subscription pass-through only after testing the harness's vendor-auth behavior and required headers.
4. Add gateway-owned API/cloud routes backed by a vault or workload identities.
5. Add the remaining native protocol front doors.
6. Add an MCP gateway with scoped downstream credentials and per-tool policy.
7. Add a local agent for harnesses that cannot carry a second gateway identity signal.

