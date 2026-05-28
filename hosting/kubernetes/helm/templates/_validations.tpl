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
         tls: true   # optional

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
   Validate that the canonical app secrets are provided when the chart
   is creating the Secret itself (i.e. secrets.existingSecret is unset).
   Without this guard the chart renders, the pods start, and the app
   crashes on first request because AGENTA_AUTH_KEY / AGENTA_CRYPT_KEY
   are empty. Fail at install time instead.

   When the user opts into secrets.existingSecret they're declaring
   "I'll populate these myself" — we trust that and skip the check.
   ================================================================ */}}
{{- define "agenta.validateRequiredSecrets" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $secrets := default dict .Values.secrets -}}
{{- $agenta := default dict $values.agenta -}}
{{- $postgres := default dict $values.postgres -}}
{{- $postgresql := default dict $values.postgresql -}}
{{- $postgresqlExternal := default dict $postgresql.external -}}
{{- if not $secrets.existingSecret -}}
{{- $missing := list -}}
{{- if not $agenta.authKey -}}{{- $missing = append $missing "agenta.authKey" -}}{{- end -}}
{{- if not $agenta.cryptKey -}}{{- $missing = append $missing "agenta.cryptKey" -}}{{- end -}}
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

CONFIGURATION ERROR: required secret(s) missing: %s

Either set them in your values file:

  agenta:
    authKey:  "<32+ random bytes hex>"
    cryptKey: "<32+ random bytes hex>"
  postgres:
    password: "<your-postgres-password>"

Or provide a pre-created Kubernetes Secret and point the chart at it:

  secrets:
    existingSecret: my-agenta-secret

The Secret must contain keys: AGENTA_AUTH_KEY, AGENTA_CRYPT_KEY, POSTGRES_PASSWORD.
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
