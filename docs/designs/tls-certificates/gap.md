# Gap analysis - local TLS certificates and private CA support

## Summary

Agenta has partial HTTPS hosting support, but not a coherent TLS and private
CA feature across editions and deployment modes. The major gap is
consistency: ingress TLS, SDK clients, OpenTelemetry export, backend HTTP
clients, Compose, and Helm all need a documented way to use public
certificates or trust the same operator-provided private CA bundle.

## Current capabilities

- OSS Compose can run through Traefik with TLS using ACME.
- Kubernetes Helm can render ingress TLS and derive `https://` public URLs.
- The generated Python client allows advanced callers to pass a custom
  `httpx.Client`.
- Operators can manually set standard env vars like `SSL_CERT_FILE`,
  `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, and
  OpenTelemetry certificate variables in some deployments.

## Missing capabilities

### Compose

- OSS SSL compose supports ACME, not static local cert/key files.
- EE compose has no SSL parity path.
- Compose files do not mount a CA bundle into all containers.
- Compose env examples mention Traefik SSL directories but do not define a
  complete cert/key/CA configuration contract.

### Kubernetes

- Ingress TLS works generically, but there is no first-class CA bundle mount
  for Agenta pods.
- The chart does not expose `tls.caBundle` values.
- There are env overrides, but no volume/volumeMount support dedicated to CA
  bundle distribution.

### API and workers

- `env.agenta` has URL fields but no Agenta-specific CA bundle field. This is
  acceptable if the implementation standardizes on runtime env vars.
- Direct `httpx.AsyncClient()` calls are scattered across API, workers, and
  EE services.
- There is no shared HTTP client factory or TLS verification helper.

### SDK

- `ag.init()` does not accept `ca_bundle`.
- `ag.init()` constructs generated API clients without custom `httpx`
  clients.
- SDK helper paths create direct `httpx.Client()` / `AsyncClient()` instances
  and would not be fixed by generated-client changes alone.
- Auth, vault, resolver, and authed helper calls need the same CA behavior.
- This may still work without SDK API changes if all `httpx` clients preserve
  default environment trust.

### OpenTelemetry

- `OTLPExporter` subclasses OpenTelemetry's HTTP exporter but does not expose
  CA bundle configuration.
- The issue specifically reports tracing/export failure over HTTPS.

### Web

- Browser trust must be solved outside Agenta.
- Web container server-side Node calls may need `NODE_EXTRA_CA_CERTS`, but the
  hosting manifests do not wire it today.

## Design questions

1. Should Agenta introduce `AGENTA_CA_BUNDLE`, or rely on standard env vars?

   Recommendation: rely on standard env vars first. Add an Agenta-specific
   alias only if a required code path cannot consume those standards.

2. Should Agenta support client certificates/mTLS now?

   Recommendation: no for this issue. The request is about trusting local
   server certificates and root CA chains. mTLS can be a later design.

3. Should Compose use one SSL file or separate ACME/static variants?

   Recommendation: keep the current ACME path working and add static-cert
   support in a way that is explicit. A separate static SSL compose file may
   be easier to document and test.

4. Should the Helm CA bundle be ConfigMap or Secret backed?

   Recommendation: support both. Root CA bundles are often not secret, but
   organizations may still prefer Secret distribution.

## Risks

- A custom CA bundle can accidentally remove public roots if operators provide
  a file containing only the internal CA. That can break OpenAI, Anthropic,
  Composio, Cloudflare, SendGrid, PostHog, and other public HTTPS calls.
- OpenTelemetry's exporter may not use the same `httpx`/OpenSSL path as the
  rest of the SDK, so it needs dedicated testing.
- Changing generated SDK files may be overwritten by Fern regeneration unless
  the generator config or post-generation patch strategy is updated.
- Browser trust cannot be fixed by application config; docs must be explicit
  to avoid false expectations.
- EE Compose parity may require private image testing with GHCR auth.

## Testing gaps

- No local HTTPS fixture exists for a private CA-signed Agenta endpoint.
- No SDK test currently validates standard TLS env vars with the default
  `ag.init()` path.
- No OTLP export test validates HTTPS with a private CA.
- No Helm render test validates CA bundle volumes/env across all components.
- No Compose smoke test validates static cert/key TLS and SDK trust.

## Acceptance criteria

- OSS Compose supports public ACME certificates, static local cert/key TLS
  termination, and CA bundle trust for Agenta containers.
- EE Compose supports the same.
- Helm supports ingress TLS plus CA bundle mounting through first-class
  values.
- Standard env vars allow SDK API calls and OTLP export to an Agenta endpoint
  signed by a private CA.
- Backend workflow service invocation and webhook delivery can call HTTPS
  endpoints signed by the configured CA.
- Existing public-CA deployments behave unchanged.
