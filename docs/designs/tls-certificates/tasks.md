# Tasks

Ordered for incremental delivery. Each block should be testable on its own.

## 1. Confirm requirements and current behavior

- [ ] Reproduce issue #2407 with a local HTTPS Agenta endpoint signed by a
      private CA.
- [ ] Confirm which paths fail: generated client, `ag.init()`, OTLP export,
      workflow invocation, webhook delivery, and web-to-API calls.
- [ ] Confirm whether standard env vars fix each failing path:
      `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`,
      `NODE_EXTRA_CA_CERTS`, `OTEL_EXPORTER_OTLP_CERTIFICATE`, and
      `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`.
- [ ] Decide final ingress cert/key names for static local certificates, such
      as `AGENTA_TLS_CERT_FILE` and `AGENTA_TLS_KEY_FILE`.
- [ ] Decide whether static-cert Compose support is a new compose file or an
      extension of the existing SSL files.
- [ ] Confirm the solution is edition-neutral: OSS and EE should expose the
      same TLS shape.

## 2. Standard env var verification

- [ ] Verify default `httpx.Client()` and `httpx.AsyncClient()` paths honor
      `SSL_CERT_FILE` in this repo's pinned dependency set.
- [ ] Verify Python `requests` paths honor `REQUESTS_CA_BUNDLE`.
- [ ] Verify curl/script paths honor `CURL_CA_BUNDLE` where relevant.
- [ ] Verify Node server-side HTTPS calls honor `NODE_EXTRA_CA_CERTS`.
- [ ] Verify OpenTelemetry OTLP export honors
      `OTEL_EXPORTER_OTLP_CERTIFICATE` and
      `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`.
- [ ] Only if a required path ignores standard variables, design a narrowly
      scoped code change for that path.

## 3. Backend HTTP clients

- [ ] Audit direct `httpx.Client` and `httpx.AsyncClient` usage under
      `api/oss/src` and `api/ee/src`.
- [ ] Confirm none of those clients set `trust_env=False` or custom SSL
      contexts that bypass `SSL_CERT_FILE`.
- [ ] Confirm workflow service invocation in
      `api/oss/src/core/workflows/service.py` works with `SSL_CERT_FILE`.
- [ ] Confirm webhook delivery in `api/oss/src/core/webhooks/delivery.py`
      works with `SSL_CERT_FILE`.
- [ ] Add targeted tests only for paths that need code changes.

## 4. SDK initialization

- [ ] Verify generated `AgentaApi` and `AsyncAgentaApi` work with
      `SSL_CERT_FILE`.
- [ ] Verify SDK helper clients in `sdks/python/agenta/sdk/utils/client.py`
      work with `SSL_CERT_FILE`.
- [ ] Verify SDK middleware clients in routing auth, running vault, and
      running resolver work with `SSL_CERT_FILE`.
- [ ] Document explicit custom `httpx.Client(verify=...)` usage for advanced
      users who want code-level precedence.
- [ ] Defer `ag.init(ca_bundle=...)` unless standard env vars prove
      insufficient.

## 5. OpenTelemetry export

- [ ] Check the pinned OpenTelemetry exporter API and env handling for
      `OTEL_EXPORTER_OTLP_CERTIFICATE` and
      `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE`.
- [ ] Confirm Agenta's custom `OTLPExporter` subclass preserves standard OTLP
      certificate env behavior.
- [ ] Add a test or smoke fixture that exports a span to an HTTPS OTLP
      endpoint signed by a private CA.
- [ ] Improve TLS failure logging enough to distinguish certificate failures
      from generic export failures.

## 6. Docker Compose - OSS

- [ ] Preserve existing public ACME certificate support.
- [ ] Add static local certificate support for Traefik.
- [ ] Support cert/key env vars or documented file locations.
- [ ] Mount the local cert/key into Traefik.
- [ ] Mount the CA bundle into API, workers, cron, alembic, services, and web.
- [ ] Set `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`,
      `NODE_EXTRA_CA_CERTS`, `OTEL_EXPORTER_OTLP_CERTIFICATE`, and
      `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE` where appropriate.
- [ ] Update OSS env examples with commented TLS/CA variables.

## 7. Docker Compose - EE

- [ ] Add EE SSL compose parity with OSS.
- [ ] Support both public ACME certificates and static local cert/key files.
- [ ] Use EE image names and EE network names.
- [ ] Mount cert/key and CA bundle consistently with OSS.
- [ ] Update EE env examples with commented TLS/CA variables.
- [ ] Smoke test with GHCR-authenticated EE images if available.

## 8. Kubernetes Helm

- [ ] Add chart values for `tls.caBundle.existingConfigMap`.
- [ ] Add chart values for `tls.caBundle.existingSecret`.
- [ ] Add `key` and `mountPath` values.
- [ ] Render volume and volumeMounts into API, workers, cron, alembic,
      services, and web deployments/jobs.
- [ ] Render `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`,
      `NODE_EXTRA_CA_CERTS`, `OTEL_EXPORTER_OTLP_CERTIFICATE`, and
      `OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE` env vars where appropriate.
- [ ] Update `values.schema.json`.
- [ ] Add example values to both OSS and EE Kubernetes example files.
- [ ] Add Helm render tests or snapshot checks for ConfigMap and Secret modes.

## 9. Documentation

- [ ] Document browser trust requirements.
- [ ] Document OSS Compose with static cert/key and CA bundle.
- [ ] Document EE Compose with static cert/key and CA bundle.
- [ ] Document public certificate flows for OSS/EE Compose.
- [ ] Document Kubernetes ingress TLS Secret setup.
- [ ] Document public cert-manager style Kubernetes certificate flow.
- [ ] Document Kubernetes CA bundle ConfigMap/Secret setup.
- [ ] Document SDK usage with standard env vars.
- [ ] Document optional explicit custom `httpx.Client(verify=...)`.
- [ ] Warn that custom CA bundles may need to include public roots if the
      deployment also calls public SaaS APIs.

## 10. End-to-end verification

- [ ] Generate a local root CA and server certificate for `agenta.local`.
- [ ] Start OSS Compose over HTTPS with static cert/key.
- [ ] Verify browser access after trusting the root CA locally.
- [ ] Verify Python SDK API call with standard env vars.
- [ ] Verify OTLP/tracing export with standard env vars.
- [ ] Verify workflow service invocation over HTTPS.
- [ ] Verify webhook delivery to a private CA-signed endpoint.
- [ ] Repeat the hosting smoke on EE Compose if credentials are available.
- [ ] Render Helm OSS and EE values with ingress TLS and CA bundle enabled.
