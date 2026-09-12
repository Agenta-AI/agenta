# Research - local TLS certificates and private CA support

## Origin

GitHub issue [#2407](https://github.com/Agenta-AI/agenta/issues/2407)
asks for support for locally generated/internal certificates when hosting
Agenta locally in OSS mode. The user specifically reports that HTTP works,
but HTTPS fails for the Agenta CLI/SDK and tracing export when the server
certificate is signed by an internal CA.

Although the issue is OSS-focused, the same capability should work in OSS and
EE, and should cover both public certificates and local/private certificates.

The issue is open, labeled `enhancement` and `backlog`, assigned to
`junaway`, and linked from Linear as `AGE-3786`.

## Problem shape

This is broader than enabling HTTPS on the public entrypoint. There are four
distinct trust surfaces:

1. User/browser to web/API/services.
2. External SDK/CLI clients to Agenta API and OTLP endpoints.
3. Backend/workers/services calling internal or customer-controlled HTTPS
   endpoints.
4. SDK/runtime code paths inside workflow services, evaluator execution, and
   tracing exporters.

Supporting only ingress TLS does not solve the SDK, OpenTelemetry, webhook,
or server-side HTTP client failures when a private CA is involved.

## Docker Compose state

OSS has an HTTPS-specific compose file:

- `hosting/docker-compose/oss/docker-compose.gh.ssl.yml`

That file enables Traefik TLS routers for web, API, and services:

- web: `traefik.http.routers.web.tls=true`
- API: `traefik.http.routers.api.tls=true`
- services: `traefik.http.routers.services.tls=true`

The Traefik config at `hosting/docker-compose/oss/ssl/traefik.yml` uses ACME:

```yaml
certificatesResolvers:
  myResolver:
    acme:
      tlschallenge: true
      storage: "acme.json"
```

This is useful for public certificates, but it does not provide a static
local certificate/key path for internally provisioned certs.

EE compose currently has no equivalent SSL file. Its Traefik service in
`hosting/docker-compose/ee/docker-compose.gh.yml` exposes only the `web`
entrypoint on port 80:

```yaml
command:
  - --api.dashboard=true
  - --providers.docker
  - --entrypoints.web.address=:80
ports:
  - "${TRAEFIK_PORT:-80}:80"
```

## Kubernetes state

The Helm chart has generic ingress TLS support:

- `hosting/kubernetes/helm/templates/ingress.yaml` renders `spec.tls` from
  `ingress.tls`.
- `hosting/kubernetes/helm/templates/_helpers.tpl` derives public URL scheme
  from ingress TLS: if `ingress.tls` exists, the effective web/API/services
  URLs use `https://`.

That covers public TLS termination when the operator supplies a Kubernetes
TLS Secret through ingress config. It does not provide first-class mounting
of a private CA bundle into API, worker, cron, services, or web pods.

Per-component environment overrides exist through the component schema:

```json
"env": {
  "type": "object",
  "additionalProperties": {
    "type": ["string", "number", "boolean"]
  }
}
```

That means operators can manually set env vars like `SSL_CERT_FILE`, but
there is no chart-level `tls.caBundle` or `customCa` value that mounts the
bundle everywhere it is needed.

## Runtime configuration state

The central API config in `api/oss/src/utils/env.py` has URL settings:

```python
class AgentaConfig(BaseModel):
    web_url: str = os.getenv("AGENTA_WEB_URL") or "http://localhost"
    services_url: str = os.getenv("AGENTA_SERVICES_URL") or "http://localhost/services"
    api_url: str = os.getenv("AGENTA_API_URL") or "http://localhost/api"
    api_internal_url: str | None = os.getenv("AGENTA_API_INTERNAL_URL")
```

There is no Agenta-specific CA bundle, cert file, key file, or TLS
verification setting in the shared `env.agenta` object today. That may be
fine: standard runtime variables are a better first option if the underlying
libraries already honor them.

## SDK and generated client state

The generated Python client supports custom `httpx` clients:

```python
AgentaApi(..., httpx_client: Optional[httpx.Client] = None)
AsyncAgentaApi(..., httpx_client: Optional[httpx.AsyncClient] = None)
```

That allows advanced callers to use explicit code-level TLS configuration:

```python
httpx.Client(verify="/path/to/ca.pem")
```

However, `ag.init()` does not expose a CA bundle option. That may not be a
problem if `httpx` keeps its default `trust_env=True` behavior, because
`SSL_CERT_FILE` can be enough for the default path.

Several SDK helper paths also create plain `httpx.Client()` or
`httpx.AsyncClient()` directly:

- `sdks/python/agenta/sdk/utils/client.py`
- `sdks/python/agenta/sdk/middlewares/routing/auth.py`
- `sdks/python/agenta/sdk/middlewares/running/vault.py`
- `sdks/python/agenta/sdk/middlewares/running/resolver.py`
- `sdks/python/agenta/sdk/engines/running/handlers.py`

A generated-client-only change would therefore leave important SDK paths
unfixed.

## OpenTelemetry state

`sdks/python/agenta/sdk/engines/tracing/exporters.py` subclasses
`OTLPSpanExporter`:

```python
class OTLPExporter(OTLPSpanExporter):
    ...
```

It injects credentials into the exporter session but does not expose or
configure certificate verification behavior. This matches the issue report:
OTLP/tracing may fail even when normal HTTPS calls can be made with standard
certificate configuration.

## Backend outbound HTTP state

The API and workers contain direct `httpx.AsyncClient()` usage without a
shared TLS configuration helper. Relevant examples:

- `api/oss/src/core/workflows/service.py` invokes workflow service URLs.
- `api/oss/src/core/webhooks/delivery.py` sends webhook deliveries.
- `api/oss/src/core/ai_services/client.py` calls Agenta AI services.
- `api/oss/src/core/tools/providers/composio/adapter.py` calls Composio.
- `api/oss/src/core/auth/turnstile.py` calls Cloudflare Turnstile.
- EE service helpers also use direct `httpx`.

Not every external SaaS call should necessarily use an internal-only CA
bundle. If operators set a bundle that replaces default roots, that bundle may
need to include both internal and public roots.

## Browser and web container state

The web entrypoint writes runtime browser config to `public/__env.js`:

```sh
NEXT_PUBLIC_AGENTA_API_URL: "${AGENTA_API_URL:-http://localhost/api}"
```

Browser trust is controlled by the user's OS/browser trust store. Agenta
cannot make a browser trust an internal CA through application config. The
operator must install the root CA on user devices or use a certificate chain
trusted by those devices.

Server-side Node code in the web container may need `NODE_EXTRA_CA_CERTS`
when it performs HTTPS calls to internal endpoints.

## Existing escape hatches

Operators can sometimes work around the issue with platform-native env vars:

- `SSL_CERT_FILE` for Python/OpenSSL/httpx.
- `REQUESTS_CA_BUNDLE` for requests-based clients.
- `CURL_CA_BUNDLE` for curl/libcurl.
- `NODE_EXTRA_CA_CERTS` for Node.
- `OTEL_EXPORTER_OTLP_CERTIFICATE` for OpenTelemetry OTLP TLS verification.
- `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE` for trace-specific OTLP TLS
  verification.

These are not documented as a coherent Agenta feature, are not mounted by the
Compose/Helm manifests, and do not give SDK users an obvious `ag.init(...)`
option.

The naming is ecosystem-specific. In this use case, `*_CERT_FILE` and
`*_CA_BUNDLE` variables all point to a trusted CA bundle file, not to
Agenta's server certificate.
