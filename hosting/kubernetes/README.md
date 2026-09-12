# Agenta on Kubernetes

The Helm chart in `helm/` deploys a full Agenta stack. The step-by-step guide is
[Deploy to Kubernetes](../../docs/docs/self-host/deploy/03-deploy-to-kubernetes.mdx).
This file is the operator reference for the values you need on a managed cluster.

## What is in this directory

| Path | What it is |
| --- | --- |
| `helm/` | The chart. `values.yaml` holds the defaults, and `values.schema.json` documents and validates declared fields. |
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
  className: ""            # see the note below: GKE ignores this field
  host: agenta.example.com
  annotations:
    kubernetes.io/ingress.class: gce
    kubernetes.io/ingress.global-static-ip-name: agenta-ip
    networking.gke.io/managed-certificates: agenta-cert
  paths:
    api:       { path: /api,      pathType: ImplementationSpecific }
    services:  { path: /services, pathType: ImplementationSpecific }
    webMobile: { path: /m,        pathType: ImplementationSpecific }
    web:       { path: /,         pathType: ImplementationSpecific }
```

The GKE ingress controller ignores `spec.ingressClassName`. An Ingress carrying
`className: gce` gets no controller events and never gets an IP, even with an
IngressClass object present. The controller reacts only to the legacy
`kubernetes.io/ingress.class` annotation. Set `ingress.className: ""` so the
chart leaves the field out, and route with the annotation. An unset
`ingress.className` still defaults to `traefik`, which is right for the bundled
stack.

Do not strip `/api`. The API is mounted at `/api` and its redirects keep the
prefix. Do strip `/services`. Keep the mobile path at `/m`, because the mobile
image is built with that basePath.

The GCE ingress controller reads two annotations off each Service, so set them
per component. Set the NEG annotation yourself even on Autopilot, which adds it
only when it creates the Service: a `helm upgrade --force` recreates Services
without it.

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

## Graceful rollouts

A managed load balancer keeps sending requests to a pod for a few seconds after
Kubernetes removes it from the endpoints. On GKE the endpoint group needs that
long to notice. A pod that exits as soon as it gets the TERM signal answers those
requests with a 502, so every rollout drops a few requests. Three optional keys
per workload close the window, and all three are unset by default:

```yaml
api:
  strategy:
    rollingUpdate:
      maxUnavailable: 0     # add the new pod before removing the old one
  lifecycle:
    preStop:
      sleep:
        seconds: 10         # keep answering while the load balancer catches up
  terminationGracePeriodSeconds: 45
```

`strategy` is rendered verbatim under the Deployment's `spec.strategy`.
`lifecycle` is rendered verbatim under the container's `lifecycle`, so any hook
the Kubernetes spec accepts works. `terminationGracePeriodSeconds` is rendered on
the pod spec.

Four things to get right:

- The grace period must be longer than the preStop delay plus the time the
  process needs to drain. The KILL signal lands at the end of the grace period
  whatever the hook is still doing.
- `preStop: {sleep: ...}` needs Kubernetes 1.30 or later. Below that, use
  `preStop: {exec: {command: ["sh", "-c", "sleep 10"]}}`, and note that the image
  must have that shell.
- `strategy` is for Deployments. The durable Redis and SeaweedFS are
  StatefulSets and the migration is a Job; neither has a `spec.strategy`, so the
  chart does not render one there. `lifecycle` and
  `terminationGracePeriodSeconds` do work on all of them.
- `maxUnavailable: 0` needs room for one more pod than you run today. On a full
  cluster the rollout waits for a node instead of starting.

The keys work on every workload: `api`, `services`, `web`, `webMobile`, `cron`,
`workerStreams`, `workerQueues`, `agentRunner`, `supertokens`, `redisVolatile`,
`redisDurable`, `store.seaweedfs` and `alembic`.

## Restricting the bundled data stores

Nothing stops one pod in the namespace from reaching the bundled Redis instances
or the bundled SeaweedFS, because by default no NetworkPolicy selects them. Turn
one on per store:

```yaml
networkPolicy:
  enabled: true
```

The chart then renders one NetworkPolicy per bundled store it deploys:
`redis-volatile`, `redis-durable` and `seaweedfs`. Each policy selects that
store's pods and allows ingress only from pods of this release, in the same
namespace, on that store's port. A pod that a NetworkPolicy selects accepts
nothing else, so that single rule is also the default deny for every other
source and port. Egress is left alone.

Read the policies back before you trust them. A cluster whose CNI does not
implement NetworkPolicy accepts the objects and ignores them, with no event and
no warning. GKE needs network policy enforcement or Dataplane V2 turned on for
the cluster.

To let in a client the release does not own, add raw `from:` entries. They are
appended to every store policy, on that store's port:

```yaml
networkPolicy:
  enabled: true
  extraIngressFrom:
    - ipBlock:
        cidr: 130.211.0.0/22   # Google Cloud load balancer health checkers
    - ipBlock:
        cidr: 35.191.0.0/16
```

Those two ranges are the ones to add when you publish the bundled store through
an Ingress, as in the SeaweedFS section below: the health check comes from the
load balancer, not from a pod. Health probes from the kubelet are a different
thing. They start on the node, and the common CNIs let node traffic through
regardless of pod policy.

The bundled PostgreSQL is not covered. The Bitnami subchart renders its own
NetworkPolicy, and that one allows every source on port 5432. Policies are
additive, so a narrower policy from this chart would take nothing away. Restrict
it through the subchart's own values instead:

```yaml
postgresql:
  primary:
    networkPolicy:
      allowExternal: false
      extraIngress:
        - ports:
            - port: 5432
          from:
            - podSelector:
                matchLabels:
                  app.kubernetes.io/instance: '{{ .Release.Name }}'
```

`allowExternal: false` narrows the subchart's rule to pods labelled
`<release>-postgresql-client: "true"`, which the Agenta workloads do not carry.
The `extraIngress` entry above is what lets them back in. The subchart renders
that value as a template, so the quoted `.Release.Name` expression resolves to
the release name.

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

### Reaching the bundled store from outside the cluster

Pods reach the bundled gateway through its in-cluster Service, and that is the
default. A Daytona sandbox runs outside the cluster and cannot resolve that name,
so give the gateway a hostname and point every pod at it. Set both keys:

```yaml
store:
  enabled: true
  endpointUrl: https://store.example.com    # what pods and sandboxes are told to use
  seaweedfs:
    enabled: true
    ingress:
      enabled: true                         # default false
      className: gce
      host: store.example.com
      annotations:
        kubernetes.io/ingress.global-static-ip-name: agenta-store-ip
      tls:
        - hosts:
            - store.example.com
          secretName: agenta-store-tls
```

`store.endpointUrl` wins over the internal Service URL whenever it is set, with
or without the bundled SeaweedFS. Leave it unset to keep the store internal.
The Ingress renders only when the bundled SeaweedFS is deployed, and `host` is
required once you enable it. The advertised `store.endpointUrl` must use HTTPS;
configure TLS with `ingress.tls` or controller-specific annotations. Compose
does the same thing with `AGENTA_STORE_TRAEFIK_ENABLE` and
`AGENTA_STORE_DOMAIN`.

## Extra environment variables

`<component>.env` takes plain strings only, so it cannot reference a Secret key.
Two more keys take raw Kubernetes entries. `extraEnv` renders explicit `env`
entries after the chart's own variables, so matching names there win. `envFrom`
supplies only names absent from explicit `env` entries, regardless of order:

```yaml
api:
  extraEnv:
    - name: AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY
      valueFrom:
        secretKeyRef:
          name: agenta
          key: AGENTA_STARTER_CREDITS_BRIDGE_MASTER_KEY
  envFrom:
    - secretRef:
        name: agenta-extra
        optional: true
```

Both work on every workload: `api`, `services`, `web`, `webMobile`, `cron`,
`workerStreams`, `workerQueues`, `agentRunner`, `alembic` and `supertokens`.

Be careful on the runner. Its environment is narrow on purpose, because a local
harness process shares that container and can read `/proc`. Add one key at a time
with `extraEnv`, and avoid `envFrom` there: it pulls a whole Secret and defeats
the guard in `helm/tests/test_runner_secret_absence.py`, which can only see
named entries.

## The runner bind address

The runner binds `127.0.0.1` on its own. In a pod the kubelet connects over the
pod IP, so a runner bound to loopback refuses every health probe and never
becomes ready. The chart sets `AGENTA_RUNNER_HOST=0.0.0.0` for you. Change it
with `agentRunner.host`, or through the `agentRunner.env` map, which suppresses
the chart's entry rather than adding a second one.

## Checking a values file before you install

```bash
helm lint hosting/kubernetes/helm -f my-values.yaml
helm template agenta hosting/kubernetes/helm -f my-values.yaml
```

`values.schema.json` validates declared fields, and the chart's own validations
fail the render with a message that names the key to fix. Some open sections,
including the root and `postgresql`, accept unknown keys for subchart wiring and
other pass-through settings.

The tests in `helm/tests/` render the chart and assert on the result. Run one
with `uv run hosting/kubernetes/helm/tests/<name>.py`; each needs `helm` on the
PATH.
