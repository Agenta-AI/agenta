# Proposal - local TLS certificates and private CA support

## Goal

Provide a coherent, edition-neutral way to run Agenta behind both public and
locally managed TLS certificates, and to trust an internal/private CA across
Compose, Kubernetes, API, services, workers, SDK, and tracing paths.

The feature should work for both OSS and EE, and for both Docker Compose and
Kubernetes. Issue #2407 focuses on OSS local hosting, but the implementation
should avoid OSS-only behavior.

## Non-goals

- Do not make browsers trust a private CA. Operators must distribute the root
  CA through their device management or browser trust process.
- Do not replace Kubernetes ingress controller TLS configuration. The chart
  should expose/document the expected values and trust bundle wiring.
- Do not disable TLS verification as the primary path. Insecure flags may
  remain separate escape hatches, but private CA support should preserve
  verification.

## Configuration model

Use standard runtime and library environment variables as the primary trust
mechanism. Do not introduce an Agenta-specific CA bundle variable unless a
later implementation discovers a code path that cannot consume the standard
variables.

For private/local CA trust, mount one CA bundle file into the relevant
containers and point the standard variables at it:

```env
SSL_CERT_FILE=/app/certs/ca.pem
REQUESTS_CA_BUNDLE=/app/certs/ca.pem
CURL_CA_BUNDLE=/app/certs/ca.pem
NODE_EXTRA_CA_CERTS=/app/certs/ca.pem
OTEL_EXPORTER_OTLP_CERTIFICATE=/app/certs/ca.pem
OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE=/app/certs/ca.pem
```

For public CA certificates, these variables are normally unnecessary. Public
certificates should work through the default trust stores.

### Precedence

1. Explicit code-level TLS configuration, for example
   `httpx.Client(verify="/path/to/ca.pem")`.
2. Library-specific environment variables, for example
   `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`, `OTEL_EXPORTER_OTLP_CERTIFICATE`,
   `REQUESTS_CA_BUNDLE`, and `CURL_CA_BUNDLE`.
3. Runtime-wide environment variables, especially `SSL_CERT_FILE`.
4. Runtime/library default trust store.
5. Explicit insecure override, such as `verify=False`. This remains an escape
   hatch and should not be the primary implementation.

### Naming notes

`*_CA_BUNDLE` and `*_CERT_FILE` are ecosystem-specific names. For this use
case they all point to a trusted CA bundle, not to Agenta's server
certificate:

- `SSL_CERT_FILE`: OpenSSL/Python default CA bundle path.
- `REQUESTS_CA_BUNDLE`: Python `requests` CA bundle path.
- `CURL_CA_BUNDLE`: curl/libcurl CA bundle path.
- `NODE_EXTRA_CA_CERTS`: additional CA certificates for Node.
- `OTEL_EXPORTER_OTLP_CERTIFICATE`: OpenTelemetry's CA certificate file for
  OTLP TLS verification.
- `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`: trace-specific OpenTelemetry CA
  certificate file.

## Docker Compose

### Static TLS certificates for ingress

Add static-certificate support for Traefik in Compose.

For OSS and EE, Compose should support both public ACME certificates and
mounted local cert/key files.

Static local certificate support should expose a small cert/key contract such
as:

```env
TRAEFIK_DOMAIN=agenta.internal
AGENTA_TLS_CERT_FILE=/certs/tls.crt
AGENTA_TLS_KEY_FILE=/certs/tls.key
```

Mount a local certificate directory into Traefik and configure Traefik dynamic
TLS certificates instead of ACME when cert/key files are supplied.

EE should have parity with the OSS SSL compose path. EE should not remain
HTTP-only when OSS has a TLS entrypoint. The edition differences should be
limited to image names, migration commands, env examples, and network names.

### CA bundle mounting

Mount the same CA bundle into all containers that may make outbound HTTPS
requests:

- `api`
- `worker-evaluations`
- `worker-tracing`
- `worker-webhooks`
- `worker-events`
- `cron`
- `alembic`
- `services`
- `web`

Set the standard env vars in each relevant service:

```yaml
environment:
  - SSL_CERT_FILE=/app/certs/ca.pem
  - REQUESTS_CA_BUNDLE=/app/certs/ca.pem
  - CURL_CA_BUNDLE=/app/certs/ca.pem
  - NODE_EXTRA_CA_CERTS=/app/certs/ca.pem
  - OTEL_EXPORTER_OTLP_CERTIFICATE=/app/certs/ca.pem
  - OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE=/app/certs/ca.pem
```

Node-only env vars are harmless for Python containers, but implementation may
choose to set `NODE_EXTRA_CA_CERTS` only on `web` if preferred.

## Kubernetes

### Ingress TLS

Continue using the existing generic `ingress.tls` surface:

```yaml
ingress:
  enabled: true
  host: agenta.internal
  tls:
    - secretName: agenta-tls
      hosts:
        - agenta.internal
```

This works for both public certificates managed by cert-manager and manually
created TLS Secrets backed by local/private certificates. It already makes
effective public URLs derive `https://` when URLs are not explicitly set.

### Private CA bundle

Add a chart-level TLS trust configuration:

```yaml
tls:
  caBundle:
    existingConfigMap: agenta-ca-bundle
    key: ca.pem
    mountPath: /app/certs/ca.pem
```

Alternative Secret-backed form:

```yaml
tls:
  caBundle:
    existingSecret: agenta-ca-bundle
    key: ca.pem
    mountPath: /app/certs/ca.pem
```

Render the volume, volumeMount, and standard env vars into backend pods and
web pods. This should apply to API, workers, cron, alembic, services, and web
unless a component explicitly opts out.

Per-component env overrides should remain available for unusual deployments,
but the first-class `tls.caBundle` value should cover the common case.

## Runtime HTTP clients

Most Agenta-owned Python HTTP paths use `httpx.Client()` or
`httpx.AsyncClient()` with default `trust_env=True`, so `SSL_CERT_FILE` should
be enough for those paths. The implementation should first verify that no
client disables environment trust.

If a code path disables env trust or constructs custom SSL contexts, prefer
removing that custom behavior or teaching it to respect the standard env vars
instead of adding an Agenta-specific config path.

For third-party public SaaS calls, document that a custom CA bundle file may
need to include both internal and public roots if it replaces the default
trust store.

## SDK and generated client

The generated Python client already accepts custom `httpx` clients for users
who need explicit code-level TLS configuration. For the default SDK path,
standard env vars should be enough as long as the generated client and SDK
helpers keep `trust_env=True`.

Do not add `ag.init(ca_bundle=...)` in the first implementation. It can be a
future convenience API if standard env vars are insufficient or too hard to
document.

## OpenTelemetry

Configure OTLP through OpenTelemetry's standard certificate env vars:

```env
OTEL_EXPORTER_OTLP_CERTIFICATE=/app/certs/ca.pem
OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE=/app/certs/ca.pem
```

Verify that the pinned `OTLPSpanExporter` honors these variables. If the
custom `OTLPExporter` subclass bypasses or overrides that behavior, adjust it
to preserve OpenTelemetry's standard precedence.

The SDK should not swallow TLS failures as a generic "traces will not be
exported" warning without enough context. At minimum, log the endpoint and
that certificate verification failed.

## Documentation

Add self-hosting docs for:

- Compose OSS with local cert/key and CA bundle.
- Compose EE with local cert/key and CA bundle.
- Compose OSS/EE with public ACME certificates.
- Kubernetes ingress TLS Secret and CA bundle ConfigMap/Secret.
- Kubernetes public certificate manager flow.
- SDK usage with standard env vars and optional explicit custom `httpx`
  clients.
- Browser trust requirements.

## Compatibility

Default behavior remains unchanged when no CA bundle is configured.

Existing deployments using public CA certificates keep working. Existing
manual env-var workarounds continue to work because `SSL_CERT_FILE`,
`REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, and
OpenTelemetry's certificate env vars are the documented runtime surface.
