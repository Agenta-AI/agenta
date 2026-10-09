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

On the first install in the pre phase the Job names no ServiceAccount. It runs
before the release's own ServiceAccount is applied, and Kubernetes refuses a pod
that names a ServiceAccount which does not exist, so the Job never starts one and
the install sits in pending-install. The migration reaches PostgreSQL only and
needs no Kubernetes API access, so on that one install its pod takes the
namespace's default ServiceAccount and mounts no token.

Every later upgrade names the ServiceAccount again. By then the first install has
created it, and naming it keeps the identity you configured on it. That matters
if you annotate it, because `serviceAccount.annotations` is where a GKE release
binds the workload identity that reaches Cloud SQL with IAM auth.

So the first install is the one case with no named identity for the migration. If
the migration itself needs one, or a cluster policy requires a named
ServiceAccount, create the ServiceAccount yourself and set
`serviceAccount.create: false` with `serviceAccount.name`. The chart names that
one in every phase, because it exists before the install starts.

## A managed ingress (GKE)

```yaml
agenta:
  webUrl: "https://agenta.example.com"
  apiUrl: "https://agenta.example.com/api"
  servicesUrl: "https://agenta.example.com/services"
ingress:
  enabled: true
  className: ""            # see the note below: GKE ignores this field
  host: agenta.example.com
  annotations:
    kubernetes.io/ingress.class: gce
    kubernetes.io/ingress.global-static-ip-name: agenta-ip
    networking.gke.io/managed-certificates: agenta-cert
    networking.gke.io/v1beta1.FrontendConfig: agenta-https
```

Set the three public URLs yourself. A Google-managed certificate leaves
`ingress.tls` empty, and the chart then derives `http://` URLs. Keep the default paths, which use `pathType: Prefix`. With `ImplementationSpecific`
GKE treats `/api` as an exact path, and `/api/...` never reaches the API. The
static IP, the ManagedCertificate and the FrontendConfig are yours to create; see
[Prepare a Kubernetes deployment for production](../../docs/docs/self-host/deploy/05-kubernetes-production.mdx).

The GKE ingress controller ignores `spec.ingressClassName`. An Ingress carrying
`className: gce` gets no controller events and never gets an IP, even with an
IngressClass object present. The controller reacts only to the legacy
`kubernetes.io/ingress.class` annotation. Set `ingress.className: ""` so the
chart leaves the field out, and route with the annotation. An unset
`ingress.className` still defaults to `traefik`, which is right for the bundled
stack.

You do not have to strip either prefix, and the GCE controller cannot. The API
strips a leading `/api` itself, and the services backend strips a leading
`/services`. Each strips in a loop, so a double prefix also routes, and neither
emits a redirect. A controller that does strip the prefix also works, because
after the strip the request arrives with no prefix. Keep the mobile path at
`/m`, because the mobile image is built with that basePath.

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
requests with a 502, so every rollout drops a few requests. Three keys per
workload close the window. The chart sets defaults on most workloads (listed in
`values.yaml` under "Graceful rollouts"), and a key you set replaces its default:

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
  must have that shell. The chart's own default hook is an exec `sleep 10` on
  `agentRunner`, `api`, `services`, `web` and `webMobile`; a custom image without
  `sleep` must set its own `lifecycle`.
- `strategy` is for Deployments. The durable Redis and SeaweedFS are
  StatefulSets and the migration is a Job; neither has a `spec.strategy`, so the
  chart does not render one there. `lifecycle` and
  `terminationGracePeriodSeconds` do work on all of them.
- `maxUnavailable: 0` needs room for one more pod than you run today. On a full
  cluster the rollout waits for a node instead of starting.

The keys work on every workload: `api`, `services`, `web`, `webMobile`, `cron`,
`workerStreams`, `workerQueues`, `agentRunner`, `supertokens`, `redisVolatile`,
`redisDurable`, `store.seaweedfs` and `alembic`.

## Long streams and worker shutdown

The api proxies every agent model call through the LLM gateway as a streaming
response, and one response can run for many minutes. Gunicorn stops a worker in
two cases: when the worker has served `api.gunicorn.maxRequests` requests (a
guard against slow memory leaks), and when the pod gets the TERM signal. In both
cases the worker stops taking new requests and finishes the requests it has open,
for at most `api.gunicorn.gracefulTimeout` seconds. Then it is killed and any
stream still open is cut.

```yaml
api:
  gunicorn:
    gracefulTimeout: 900      # default; cover the longest stream you allow
    maxRequests: 100000       # default; 0 turns recycling off
    maxRequestsJitter: 10000  # default
    timeout: 60               # default; the hung-worker check, not a request limit
  # terminationGracePeriodSeconds defaults to gracefulTimeout + 30
```

Three settings outside the gunicorn block must be at least as long as
`gracefulTimeout`, or they cut the stream first:

- `api.terminationGracePeriodSeconds`. The kubelet sends KILL at the end of it.
  The chart default is `gracefulTimeout + 30`, which covers the 10-second preStop
  delay. If you set the grace period yourself, keep that margin.
  GKE Autopilot caps the grace period at 600 seconds and silently rewrites a
  larger value to 600, so the default of 930 does not hold there. On Autopilot,
  set `gracefulTimeout` to 560 or less and `terminationGracePeriodSeconds` to
  600. Check the value the cluster applied with
  `kubectl get deploy <release>-api -o jsonpath='{.spec.template.spec.terminationGracePeriodSeconds}'`.
- The load balancer's connection draining. On GKE this is
  `connectionDraining.drainingTimeoutSec` on the api's `BackendConfig`. After that
  timeout the load balancer stops all traffic to the old pod, open streams
  included.
- The load balancer's response timeout, for example `timeoutSec` on a GKE
  `BackendConfig`. This one caps every stream, not only the ones on a pod that is
  stopping.

A worker that is draining does not take new requests, and gunicorn starts its
replacement only after it exits. With the default of two workers, a pod serves on
one worker while the other drains. The jitter keeps the two workers from
recycling at the same time.

## Availability under disruption

The chart renders a PodDisruptionBudget and topologySpreadConstraints per
workload, both on by default. Every workload gets `maxUnavailable: 1`. A
workload with two or more replicas also gets a hard one-pod-per-node constraint
plus a soft one-per-zone constraint. A workload with one replica gets no
constraints.

```yaml
podDisruptionBudgets:
  enabled: true           # false removes every generated budget
topologySpread:
  enabled: true           # false removes every generated constraint
api:
  replicas: 2
  pdb:
    maxUnavailable: 1     # or minAvailable; replaces the default
agentRunner:
  pdb:
    minAvailable: 1       # refuse every voluntary eviction, for the grace period
```

Nothing here makes a single replica highly available. This is why a single
replica gets `maxUnavailable: 1`: `minAvailable: 1` over one pod permits no
disruption at all, so the platform cannot drain that node, and it evicts the pod
at the end of the grace period anyway. Give any workload that must stay
reachable `replicas: 2`.

An empty `<workload>.topologySpreadConstraints` list removes the constraints for
that workload. `topologySpread.enabled: false` removes them for every workload.

The block in `values.yaml` under "Availability under disruption" is the source of
truth. The operator-facing guide is
[Prepare a Kubernetes deployment for production](../../docs/docs/self-host/deploy/05-kubernetes-production.mdx).

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
namespace, on that store's port. Selecting a pod turns off its default
allow-everything, so that single rule is also the deny for every other source
and port. Egress is left alone.

Policies are additive, so this deny holds only while no other policy selects the
same pods. A namespace-wide allow policy, which is a common way to start, still
lets its own sources in. These policies take nothing away from one that is
already there. Check what else selects the store pods before you count the store
as locked down.

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

## More than one runner pod

`agentRunner.replicas` above 1 needs remote sandbox providers only. A local
sandbox runs inside the runner pod that started it, so the render fails when
`agentRunner.providers.enabled` lists `local` with more than one runner. With
only remote providers the runner rolls out with `RollingUpdate` (`maxSurge: 1`,
`maxUnavailable: 0`); with `local` it keeps `Recreate`, and the render fails for an
explicit `agentRunner.strategy` of another type. These checks read
`agentRunner.providers`, so the chart owns `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS`
and `AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER`: the render fails when
`agentRunner.env` or `agentRunner.extraEnv` sets either one. Set them with
`agentRunner.providers.enabled` and `agentRunner.providers.default`.

Each turn is bound to the pod that runs it, by the pod's replica id. The chart
sets that id to the pod name, and the render fails when `agentRunner.env` or
`agentRunner.extraEnv` sets `AGENTA_RUNNER_REPLICA_ID`: a shared id would let two
pods take the same turn. The api sends a Stop to that pod's IP, and Services
sends the session's follow-up messages there. A NetworkPolicy that blocks api or
Services traffic to runner pod IPs on the runner port breaks Stop and follow-up
routing.

On SIGTERM a runner pod refuses new turns with a 503, lets its running turns
finish for `agentRunner.shutdownWaitSeconds`, cancels the rest, and deletes its
sandboxes. With `RollingUpdate` the default wait is the grace period minus 100
seconds (200 of the default 300), and the render fails for a longer one. The 100
seconds cover the preStop delay, the cancel and the teardown with the default
`AGENTA_RUNNER_HARNESS_CANCEL_SETTLE_MS`. With `Recreate` (the local provider) the
default wait is 0, because the new pod starts only after the old pod exits. The chart owns
`AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS`: the render fails when `agentRunner.env` or
`agentRunner.extraEnv` sets it.

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
