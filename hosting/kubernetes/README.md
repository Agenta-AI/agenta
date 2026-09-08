# Agenta on Kubernetes

The Helm chart in `helm/` deploys a full Agenta stack. The step-by-step guide is
[Deploy to Kubernetes](../../docs/docs/self-host/deploy/03-deploy-to-kubernetes.mdx).
This file is the operator reference for the values you need on a managed cluster.

## What is in this directory

| Path | What it is |
| --- | --- |
| `helm/` | The chart. `values.yaml` holds the defaults, `values.schema.json` documents and validates every key. |
| `oss/values.oss.example.yaml` | A commented starting point for the OSS edition. |
| `ee/values.ee.example.yaml` | The same for the Enterprise edition. |
| `run.sh` | A wrapper around `helm upgrade --install`. Run `./hosting/kubernetes/run.sh --help`. |

Copy an example to `.values.oss.yaml` or `.values.ee.yaml` next to it, fill it in,
and `run.sh` picks it up.

## What the chart deploys

The api, the web app, the mobile web app, the services API, the agent runner, the
stream worker, the queue worker, the cron loop, SuperTokens, and a migration Job.
It can also bundle PostgreSQL, two Redis instances, and SeaweedFS, or you can
point it at your own.

The chart does not create a database, a DNS record, a TLS certificate, or a
static IP. Bring those yourself.

## Required values

The chart refuses to install until these are set. Generate each key with
`openssl rand -hex 32`.

```yaml
agenta:
  authKey: "..."
  cryptKey: "..."
  servicesInternalKey: "..."
  runnerToken: "..."
postgres:
  password: "..."
ingress:
  enabled: true
  host: agenta.example.com
```

The public URLs are derived from `ingress.host`. Set `agenta.webUrl`,
`agenta.apiUrl` and `agenta.servicesUrl` only if you route them somewhere else.

Instead of the four keys and the password you can pre-create one Secret and set
`secrets.existingSecret`. It must hold `AGENTA_AUTH_KEY`, `AGENTA_CRYPT_KEY`,
`AGENTA_SERVICES_INTERNAL_KEY`, `AGENTA_RUNNER_TOKEN` and `POSTGRES_PASSWORD`.
With the bundled PostgreSQL you must point the subchart at the same Secret:

```yaml
secrets:
  existingSecret: agenta
global:
  postgresql:
    auth:
      existingSecret: agenta
```

## An external PostgreSQL

```yaml
postgresql:
  enabled: false
  external:
    host: 10.20.30.40
    port: 5432
    username: agenta
    sslmode: require
postgres:
  password: "..."   # or a key in secrets.existingSecret
alembic:
  hookPhase: pre
```

Create the three databases first. The bundled PostgreSQL creates them through an
initdb script; an external one does not. On the OSS edition they are
`agenta_oss_core`, `agenta_oss_tracing` and `agenta_oss_supertokens`. On the EE
edition, `agenta_ee_*`. Override the names under `postgresql.databases`.

Nothing constrains the keys under `postgresql`, so `helm install` accepts a
misspelled one and falls back to the default. Render the chart and read the
`POSTGRES_URI_CORE` value back before you install.

`alembic.hookPhase: pre` runs the migration Job before the app pods start.
Keep the default `post` with the bundled PostgreSQL, whose StatefulSet does not
exist yet at pre-install time and would deadlock the Job.

## A managed ingress (GKE)

```yaml
ingress:
  enabled: true
  className: gce
  host: agenta.example.com
  annotations:
    kubernetes.io/ingress.global-static-ip-name: agenta-ip
    networking.gke.io/managed-certificates: agenta-cert
  paths:
    api:       { path: /api,      pathType: ImplementationSpecific }
    services:  { path: /services, pathType: ImplementationSpecific }
    webMobile: { path: /m,        pathType: ImplementationSpecific }
    web:       { path: /,         pathType: ImplementationSpecific }
```

Do not strip `/api`. The API is mounted at `/api` and its redirects keep the
prefix. Do strip `/services`. Keep the mobile path at `/m`, because the mobile
image is built with that basePath.

The GCE ingress controller reads two annotations off each Service, so set them
per component:

```yaml
api:
  service:
    annotations:
      cloud.google.com/neg: '{"ingress": true}'
      cloud.google.com/backend-config: '{"default": "agenta-api"}'
web:
  service:
    annotations:
      cloud.google.com/neg: '{"ingress": true}'
```

`webMobile.service.annotations` and `services.service.annotations` work the same
way. The BackendConfig objects themselves are yours to create; put them in
`extraObjects` if you want the release to own them.

To route one more path on the same host, or a second hostname, use
`ingress.extraPaths` and `ingress.extraHosts`. The Service must already exist in
the namespace.

```yaml
ingress:
  extraPaths:
    - path: /llm
      pathType: ImplementationSpecific
      serviceName: litellm
      servicePort: 4000
  extraHosts:
    - host: docs.example.com
      paths:
        - path: /
          serviceName: docs
          servicePort: 80
```

For TLS that you manage yourself, `ingress.tls` is a list in the shape the
Ingress spec uses. Any non-empty list also switches the derived URLs to https.

## GKE Autopilot

Autopilot rejects the `SYS_ADMIN` capability and a hostPath mount of
`/dev/fuse`. The runner asks for both when the object store is on, so that a
local sandbox can mount the store prefix on the node. Turn it off and run
sandboxes on Daytona instead:

```yaml
agentRunner:
  fuse:
    enabled: false
  providers:
    enabled: [daytona]
    default: daytona
    daytona:
      apiKeySecretRef:
        name: agenta-daytona
        key: api-key
```

## The object store

`store.enabled` is false by default and the whole `store` block does nothing
until you set it. Turning it on also deploys a bundled SeaweedFS StatefulSet,
because `store.seaweedfs.enabled` defaults to true. With your own S3 or GCS
bucket, turn that off:

```yaml
store:
  enabled: true
  seaweedfs:
    enabled: false
  endpointUrl: https://s3.us-east-1.amazonaws.com
  region: us-east-1
  bucket: agenta
  accessKey: "..."
  secretKey: "..."
```

## Checking a values file before you install

```bash
helm lint hosting/kubernetes/helm -f my-values.yaml
helm template agenta hosting/kubernetes/helm -f my-values.yaml
```

`values.schema.json` rejects an unknown or misspelled key, and the chart's own
validations fail the render with a message that names the key to fix.

The tests in `helm/tests/` render the chart and assert on the result. Run one
with `uv run hosting/kubernetes/helm/tests/<name>.py`; each needs `helm` on the
PATH.
