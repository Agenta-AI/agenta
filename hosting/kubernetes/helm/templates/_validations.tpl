{{/* ================================================================
   Validations live here and are invoked from a template that always
   renders (currently `secrets.yaml` and `postgresql-auth-secret.yaml`).
   Each validator `fail`s with a message that points at the offending
   key and includes a fix, so the operator doesn't have to read the
   chart source to know what's wrong.
   ================================================================ */}}

{{/* ================================================================
   Validate pgauth secret configuration.
   When a user provides secrets.existingSecret AND the bundled
   PostgreSQL is enabled, Bitnami must be pointed at the user's
   secret (since the chart-managed pgauth secret is not created).
   We detect the chart default by checking whether the raw values
   string still contains the literal `{{` (the unrendered tpl
   expression from values.yaml — Helm does not tpl-render values
   itself; Bitnami renders it at install time, so when read here
   the value is still the literal template).
   ================================================================ */}}
{{- define "agenta.validatePgauthSecret" -}}
{{- $secrets := default dict .Values.secrets -}}
{{- $global := default dict .Values.global -}}
{{- $pg := default dict $global.postgresql -}}
{{- $auth := default dict $pg.auth -}}
{{- $existing := default "" $auth.existingSecret -}}
{{- $isDefault := or (eq $existing "") (hasPrefix "{{" $existing) -}}
{{- if and (eq (include "agenta.postgresql.enabled" .) "true") $secrets.existingSecret $isDefault }}
{{- fail `

CONFIGURATION ERROR: secrets.existingSecret is set but global.postgresql.auth.existingSecret
still has its default value.

When using a pre-created Secret with the bundled PostgreSQL, you must also tell the Bitnami
PostgreSQL subchart which Secret to read the password from. Set:

  global.postgresql.auth.existingSecret: "<your-secret-name>"

For example:

  helm install agenta hosting/kubernetes/helm \
    -f hosting/kubernetes/oss/.values.oss.yaml \
    --set secrets.existingSecret=my-secret \
    --set global.postgresql.auth.existingSecret=my-secret

The Secret must contain a key named POSTGRES_PASSWORD.
` }}
{{- end }}
{{- end }}

{{/* ================================================================
   Validate that the three public URLs the app surfaces in pods
   (AGENTA_WEB_URL / AGENTA_API_URL / AGENTA_SERVICES_URL) will be
   non-empty at runtime. Empty values silently break OAuth redirects,
   email links, CORS allow-lists, and any absolute-URL builder.

   The helper `agenta.{web,api,services}UrlEffective` already derives
   the URLs from `ingress.host` when ingress is enabled. We fail if ANY
   of the three resolves to empty — both the common case (ingress
   disabled and none of agenta.webUrl/apiUrl/servicesUrl set) and
   partial misconfigurations (e.g. only one or two of the URLs set
   with ingress disabled). Fail fast rather than letting the app start
   broken.
   ================================================================ */}}
{{- define "agenta.validatePublicUrls" -}}
{{- $web := include "agenta.webUrlEffective" . -}}
{{- $api := include "agenta.apiUrlEffective" . -}}
{{- $svc := include "agenta.servicesUrlEffective" . -}}
{{- if or (eq $web "") (eq $api "") (eq $svc "") }}
{{- fail `

CONFIGURATION ERROR: AGENTA_WEB_URL / AGENTA_API_URL / AGENTA_SERVICES_URL would be empty.

The chart derives these from ingress.host when ingress.enabled=true. Either:

  1. Enable ingress and set a host:

       ingress:
         enabled: true
         host: agenta.example.com
         # tls is optional and is a list, in the shape the Ingress spec uses.
         # Any non-empty list also switches the derived URLs to https.
         tls:
           - hosts:
               - agenta.example.com
             secretName: agenta-tls

  2. Or set the three URLs explicitly:

       agenta:
         webUrl:      "https://agenta.example.com"
         apiUrl:      "https://agenta.example.com/api"
         servicesUrl: "https://agenta.example.com/services"

Empty URLs would silently break OAuth redirects, email links, CORS, and any
absolute-URL builder in the app.
` }}
{{- end }}
{{- end }}

{{/* ================================================================
   A public object-store route hands credentials and signed requests to
   clients outside the cluster. Require the URL advertised to those
   clients to use HTTPS. TLS may be configured through spec.tls or
   controller-specific annotations, so validate the advertised URL
   rather than prescribing one Ingress controller's configuration.
   ================================================================ */}}
{{- define "agenta.validateSeaweedfsIngress" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $store := default dict $values.store -}}
{{- $seaweedfs := default dict $store.seaweedfs -}}
{{- $ingress := default dict $seaweedfs.ingress -}}
{{- if and (eq (include "agenta.store.enabled" .) "true") (eq (include "agenta.seaweedfs.enabled" .) "true") $ingress.enabled -}}
{{- $endpoint := default "" $store.endpointUrl -}}
{{- if not (hasPrefix "https://" $endpoint) -}}
{{- fail `

CONFIGURATION ERROR: a public SeaweedFS ingress requires an HTTPS store.endpointUrl.

Set store.endpointUrl to the public HTTPS URL and configure TLS through
store.seaweedfs.ingress.tls or your Ingress controller's annotations. For example:

  store:
    endpointUrl: "https://store.example.com"
    seaweedfs:
      ingress:
        enabled: true
        host: store.example.com
        tls:
          - hosts: [store.example.com]
            secretName: agenta-store-tls
` -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   Validate that the canonical app secrets are provided when the chart
   is creating the Secret itself (i.e. secrets.existingSecret is unset).
   Without this guard the chart renders, the pods start, and the app
   crashes on first request because required credentials are empty.

   Also rejects the literal placeholder "replace-me" shipped in
   values.yaml's defaults for authKey/cryptKey/servicesInternalKey/runnerToken — otherwise
   a stock `helm install` with no overrides silently deploys with a
   publicly-known secret instead of failing.

   When the user opts into secrets.existingSecret they're declaring
   "I'll populate these myself" — we trust that and skip the check.
   agentRunner.auth.tokenSecretRef is a separate escape hatch for just
   the runner token: if set, the runner reads its token from the
   operator's own Secret and agenta.runnerToken is not required.
   ================================================================ */}}
{{- define "agenta.validateRequiredSecrets" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $secrets := default dict .Values.secrets -}}
{{- $agenta := default dict $values.agenta -}}
{{- $postgres := default dict $values.postgres -}}
{{- $postgresql := default dict $values.postgresql -}}
{{- $postgresqlExternal := default dict $postgresql.external -}}
{{- $agentRunner := default dict $values.agentRunner -}}
{{- $runnerAuth := default dict $agentRunner.auth -}}
{{- $placeholder := "replace-me" -}}
{{- if not $secrets.existingSecret -}}
{{- $missing := list -}}
{{- if or (not $agenta.authKey) (eq $agenta.authKey $placeholder) -}}{{- $missing = append $missing "agenta.authKey" -}}{{- end -}}
{{- if or (not $agenta.cryptKey) (eq $agenta.cryptKey $placeholder) -}}{{- $missing = append $missing "agenta.cryptKey" -}}{{- end -}}
{{- if or (not $agenta.servicesInternalKey) (eq $agenta.servicesInternalKey $placeholder) -}}{{- $missing = append $missing "agenta.servicesInternalKey" -}}{{- end -}}
{{- if not $runnerAuth.tokenSecretRef -}}
{{- if or (not $agenta.runnerToken) (eq $agenta.runnerToken $placeholder) -}}{{- $missing = append $missing "agenta.runnerToken" -}}{{- end -}}
{{- end -}}
{{- /* postgres.password is required unless the operator supplied full
       external URIs for all three databases (core, tracing, supertokens),
       in which case credentials live inside the URIs themselves and
       POSTGRES_PASSWORD is never substituted. */ -}}
{{- $uriCore := or $postgresqlExternal.uriCore $postgres.uriCore -}}
{{- $uriTracing := or $postgresqlExternal.uriTracing $postgres.uriTracing -}}
{{- $uriSupertokens := or $postgresqlExternal.uriSupertokens $postgres.uriSupertokens -}}
{{- $allUrisProvided := and $uriCore $uriTracing $uriSupertokens -}}
{{- $postgresPasswordRequired := or (eq (include "agenta.postgresql.enabled" .) "true") (not $allUrisProvided) -}}
{{- if and $postgresPasswordRequired (not $postgres.password) -}}
{{- $missing = append $missing "postgres.password" -}}
{{- end -}}
{{- if $missing -}}
{{- fail (printf `

CONFIGURATION ERROR: required secret(s) missing or still set to the placeholder "replace-me": %s

Generate real values and set them in your values file:

  openssl rand -hex 32   # run once per secret

  agenta:
    authKey:     "<32+ random bytes hex>"
    cryptKey:    "<32+ random bytes hex>"
    servicesInternalKey: "<32+ random bytes hex>"
    runnerToken: "<32+ random bytes hex>"
  postgres:
    password: "<your-postgres-password>"

Or pass them on the command line:

  helm install agenta hosting/kubernetes/helm \
    --set agenta.authKey=$(openssl rand -hex 32) \
    --set agenta.cryptKey=$(openssl rand -hex 32) \
    --set agenta.servicesInternalKey=$(openssl rand -hex 32) \
    --set agenta.runnerToken=$(openssl rand -hex 32) \
    --set postgres.password=<your-postgres-password>

Or provide a pre-created Kubernetes Secret and point the chart at it:

  secrets:
    existingSecret: my-agenta-secret

The Secret must contain keys: AGENTA_AUTH_KEY, AGENTA_CRYPT_KEY, AGENTA_SERVICES_INTERNAL_KEY, AGENTA_RUNNER_TOKEN, POSTGRES_PASSWORD.

agenta.runnerToken alone can also be satisfied by pointing the runner at your own Secret:

  agentRunner:
    auth:
      tokenSecretRef:
        name: my-runner-token-secret
        key: token
` (join ", " $missing)) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   Validate that redisDurable.persistence.enabled isn't being toggled
   on an upgrade. StatefulSet volumeClaimTemplates are immutable
   post-create; flipping the toggle would make `helm upgrade` fail
   with a confusing "forbidden: updates to statefulset spec" error.
   Fail fast at template time with a clear message instead.
   ================================================================ */}}
{{- define "agenta.validateRedisDurablePersistenceToggle" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $rd := default dict $values.redisDurable -}}
{{- $persistence := default dict $rd.persistence -}}
{{- $desiredEnabled := true -}}
{{- if hasKey $persistence "enabled" -}}
{{- $desiredEnabled = $persistence.enabled -}}
{{- end -}}
{{- /* lookup is empty during `helm template` and on first install — skip
       the check there. Only enforce when an existing StatefulSet is found. */ -}}
{{- $name := printf "%s-redis-durable" (include "agenta.fullname" .) -}}
{{- $existing := lookup "apps/v1" "StatefulSet" .Release.Namespace $name -}}
{{- if $existing -}}
{{- $existingVCT := default (list) (default dict $existing.spec).volumeClaimTemplates -}}
{{- $existingHasPersistence := gt (len $existingVCT) 0 -}}
{{- if ne $existingHasPersistence $desiredEnabled -}}
{{- fail (printf `

CONFIGURATION ERROR: redisDurable.persistence.enabled is being toggled from %v to %v on an existing release.

StatefulSet volumeClaimTemplates are immutable after creation. Toggling persistence
requires recreating the StatefulSet:

  1. Back up any data you want to keep:
       kubectl -n %s exec %s-0 -c redis -- redis-cli SAVE
       kubectl -n %s cp %s-0:/data ./redis-durable-backup

  2. Delete the StatefulSet (PVCs are retained):
       kubectl -n %s delete statefulset %s

  3. Re-run helm upgrade.

If you didn't intend to toggle persistence, restore the previous value of
redisDurable.persistence.enabled in your values file (was: %v).
` $existingHasPersistence $desiredEnabled .Release.Namespace $name .Release.Namespace $name .Release.Namespace $name $existingHasPersistence) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   Validate the Alembic hook phase. A typo would silently fall back to
   "post", so an operator who asked for "pre" would keep the behavior
   they tried to change and never learn why.
   ================================================================ */}}
{{- define "agenta.validateAlembicHookPhase" -}}
{{- $phase := include "agenta.alembic.hookPhase" . -}}
{{- if not (has $phase (list "post" "pre")) -}}
{{- fail (printf `

CONFIGURATION ERROR: alembic.hookPhase=%q is not a valid phase.

Allowed values:

  post   (default) run the migrations after the release is applied. Required with
         the bundled PostgreSQL, which does not exist yet at pre-install time.
  pre              run the migrations before the app pods start. Use this with an
         external database (postgresql.enabled=false).
` $phase) -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   A local sandbox is a process inside the runner pod that started
   it. A second runner pod cannot reach it, so the local provider
   runs exactly one runner pod.
   ================================================================ */}}
{{- define "agenta.validateRunnerReplicas" -}}
{{- $replicas := int (include "agenta.agentRunner.replicas" .) -}}
{{- if and (eq (include "agenta.agentRunner.enabled" .) "true") (eq (include "agenta.agentRunner.localProviderEnabled" .) "true") (gt $replicas 1) -}}
{{- fail (printf `

CONFIGURATION ERROR: agentRunner.replicas=%d, but agentRunner.providers.enabled lists "local".

A local sandbox runs inside the runner pod that started it, and no other runner pod can reach
it. With the local provider, keep one runner:

  agentRunner.replicas: 1

To run more than one runner, enable only remote sandbox providers:

  agentRunner.providers.enabled: [daytona]
  agentRunner.providers.default: daytona
` $replicas) -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   The same reason forbids a rolling update with the local provider:
   the surge pod would run beside the old one. A strategy without a
   type is a RollingUpdate to Kubernetes.
   ================================================================ */}}
{{- define "agenta.validateRunnerStrategy" -}}
{{- $runner := default dict .Values.agentRunner -}}
{{- $type := default "RollingUpdate" (default dict $runner.strategy).type -}}
{{- if and (eq (include "agenta.agentRunner.enabled" .) "true") (eq (include "agenta.agentRunner.localProviderEnabled" .) "true") $runner.strategy (ne $type "Recreate") -}}
{{- fail (printf `

CONFIGURATION ERROR: agentRunner.strategy is %q, but agentRunner.providers.enabled lists "local".

A rolling update starts the new runner pod beside the old one, and a local sandbox runs inside
the pod that started it. With the local provider, remove agentRunner.strategy (the chart then
uses Recreate) or set:

  agentRunner.strategy:
    type: Recreate
` $type) -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   The chart owns four runner variables, and an entry in agentRunner.env
   or agentRunner.extraEnv (which comes last and wins in the kubelet)
   would replace any of them, so refuse them there.
   AGENTA_RUNNER_REPLICA_ID: the api binds each turn to one replica id
   and refuses beats from any other id. A fixed value gives every pod
   one id, the surge pod of a rolling update too, and pods that share
   an id can take the same turn. The pod name is the only id.
   AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS: the wait must end inside the
   grace period, which agenta.validateRunnerShutdownWait checks on
   agentRunner.shutdownWaitSeconds.
   AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS and
   AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER: agenta.validateRunnerReplicas
   and agenta.validateRunnerStrategy read agentRunner.providers to keep
   the local provider on one pod. An override would run local sandboxes
   on pods those checks allowed for remote providers only.
   ================================================================ */}}
{{- define "agenta.validateRunnerChartOwnedEnv" -}}
{{- $runner := default dict .Values.agentRunner -}}
{{- $env := default dict $runner.env -}}
{{- $fixes := dict -}}
{{- $_ := set $fixes "AGENTA_RUNNER_REPLICA_ID" `The api binds each turn to the runner pod that runs it, by replica id, so every pod needs its own
id. A fixed value gives every pod the same id, including the new pod that a rolling update starts
beside the old one. The chart always sets the id to the pod name.` -}}
{{- $_ = set $fixes "AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS" `The wait must end inside the runner's grace period. The chart checks agentRunner.shutdownWaitSeconds
against that limit, so set the wait there:

  agentRunner.shutdownWaitSeconds: <seconds>` -}}
{{- $providersFix := `The chart allows more than one runner pod, or a rolling update, only when the runner has no local
sandbox provider, and it checks agentRunner.providers to decide. Set the providers there, so the
check, the runner, Services and the web all use the same value:

  agentRunner.providers.enabled: [<provider>, ...]
  agentRunner.providers.default: <provider>` -}}
{{- $_ = set $fixes "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS" $providersFix -}}
{{- $_ = set $fixes "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER" $providersFix -}}
{{- if eq (include "agenta.agentRunner.enabled" .) "true" -}}
{{- range $name := list "AGENTA_RUNNER_REPLICA_ID" "AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS" "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS" "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER" -}}
{{- $source := "" -}}
{{- if hasKey $env $name -}}
{{- $source = "agentRunner.env" -}}
{{- end -}}
{{- range $entry := (default list $runner.extraEnv) -}}
{{- if and (kindIs "map" $entry) (eq (toString $entry.name) $name) -}}
{{- $source = "agentRunner.extraEnv" -}}
{{- end -}}
{{- end -}}
{{- if $source -}}
{{- fail (printf `

CONFIGURATION ERROR: %s sets %s, which the chart owns. Remove it from %s.

%s
` $source $name $source (get $fixes $name)) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   The runner's shutdown runs inside the grace period: the preStop
   delay, the wait, then the cancel and the teardown, which take up to
   80 s with the default AGENTA_RUNNER_HARNESS_CANCEL_SETTLE_MS. A wait
   past grace - 100 lets the KILL signal land before the sandboxes are
   deleted, so refuse it. The default wait is grace - 100, so only an
   explicit value can pass the limit.
   ================================================================ */}}
{{- define "agenta.validateRunnerShutdownWait" -}}
{{- $runner := default dict .Values.agentRunner -}}
{{- if and (eq (include "agenta.agentRunner.enabled" .) "true") (not (kindIs "invalid" $runner.shutdownWaitSeconds)) -}}
{{- $wait := int $runner.shutdownWaitSeconds -}}
{{- $grace := int (include "agenta.agentRunner.terminationGracePeriodSeconds" .) -}}
{{- $limit := max 0 (sub $grace 100) -}}
{{- if gt $wait $limit -}}
{{- fail (printf `

CONFIGURATION ERROR: agentRunner.shutdownWaitSeconds=%d is more than
agentRunner.terminationGracePeriodSeconds (%d) minus 100.

After the wait the runner cancels the turns that still run and deletes its sandboxes, which
takes up to 80 seconds, after a 10-second preStop delay. Lower the wait to %d or less, or raise
the grace period:

  agentRunner.terminationGracePeriodSeconds: %d
` $wait $grace $limit (add $wait 100)) -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   Validate license value is in the allowed set. Catches typos like
   `agenta.license: enterprise` that would otherwise fall through to
   the OSS code paths and silently disable EE features.
   ================================================================ */}}
{{- define "agenta.validateLicense" -}}
{{- $license := include "agenta.edition" . -}}
{{- if not (has $license (list "oss" "ee")) -}}
{{- fail (printf `

CONFIGURATION ERROR: agenta.license=%q is not a valid edition.

Allowed values: "oss", "ee".
` $license) -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   redisVolatile.external.caCert is accepted by the schema, because the
   schema shares one definition between the two Redis blocks, but only
   redisDurable mounts a CA today. Fail loudly rather than ignore it.
   ================================================================ */}}
{{- define "agenta.validateRedisVolatileCaCert" -}}
{{- $rv := default dict .Values.redisVolatile -}}
{{- $ext := default dict $rv.external -}}
{{- if $ext.caCert }}
{{- fail "redisVolatile.external.caCert is not implemented: the chart mounts a CA for redisDurable only. Put the authority in the cluster trust store, or open an issue if you need it for the cache." }}
{{- end }}
{{- end }}

{{/* ================================================================
   The durable-Redis CA volume projects the key REDIS_DURABLE_CA_CERT
   explicitly, and Kubernetes refuses to mount a Secret volume whose
   named key is absent: every affected pod then fails to start. Two
   combinations produce exactly that, so refuse them at render time
   with the fix in the message.
   ================================================================ */}}
{{- define "agenta.validateRedisDurableCaCert" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $secrets := default dict .Values.secrets -}}
{{- $rd := default dict $values.redisDurable -}}
{{- $ext := default dict $rd.external -}}
{{- $ca := $ext.caCert -}}
{{- if $ca }}
{{- $isPlaceholder := eq ($ca | toString) "from-existing-secret" -}}
{{- if and $isPlaceholder (not $secrets.existingSecret) }}
{{- fail `

CONFIGURATION ERROR: redisDurable.external.caCert is "from-existing-secret" but
secrets.existingSecret is not set.

That placeholder means "the Secret I supply already holds REDIS_DURABLE_CA_CERT".
Without secrets.existingSecret the chart creates the Secret itself and writes no
such key, so the CA volume would reference a key that does not exist and every
pod that talks to the durable Redis would fail to start.

Pick one:

  # the chart owns the Secret: give it the PEM
  redisDurable:
    external:
      caCert: |
        -----BEGIN CERTIFICATE-----
        ...
        -----END CERTIFICATE-----

  # you own the Secret: put REDIS_DURABLE_CA_CERT in it and keep the placeholder
  secrets:
    existingSecret: my-agenta-secret
`}}
{{- end }}
{{- if and (not $isPlaceholder) $secrets.existingSecret }}
{{- fail `

CONFIGURATION ERROR: redisDurable.external.caCert holds a certificate, but
secrets.existingSecret is set.

With secrets.existingSecret the chart creates no Secret, so a PEM given here is
never written anywhere. The CA volume reads REDIS_DURABLE_CA_CERT from your
Secret, and if your Secret does not hold it, every pod that talks to the durable
Redis fails to start.

Put the PEM in your own Secret under the key REDIS_DURABLE_CA_CERT, then set:

  redisDurable:
    external:
      caCert: from-existing-secret
`}}
{{- end }}
{{- end }}
{{- end }}
