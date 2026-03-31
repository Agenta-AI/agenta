{{/*
Expand the name of the chart.
*/}}
{{- define "agenta.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agenta.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label value.
*/}}
{{- define "agenta.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "agenta.labels" -}}
helm.sh/chart: {{ include "agenta.chart" . }}
{{ include "agenta.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "agenta.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agenta.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* ================================================================
   Secret name — either user-provided or chart-managed
   ================================================================ */}}
{{- define "agenta.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "agenta.fullname" . }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL auth secret name.
   The default in values.yaml is a Go template expression
   (e.g. '{{ printf "%s-pgauth" .Release.Name }}') which the
   Bitnami subchart evaluates via tpl().  We use tpl() here too
   so both sides always resolve to the same name.  Plain strings
   (e.g. "my-secret") pass through tpl() unchanged.
   ================================================================ */}}
{{- define "agenta.pgauthSecretName" -}}
{{- tpl .Values.global.postgresql.auth.existingSecret . }}
{{- end }}

{{/* ================================================================
   ServiceAccount name
   ================================================================ */}}
{{- define "agenta.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agenta.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* ================================================================
   API image (shared by api, workers, cron, alembic)
   ================================================================ */}}
{{- define "agenta.apiImage" -}}
{{ .Values.api.image.repository }}:{{ .Values.api.image.tag | default .Chart.AppVersion }}
{{- end }}

{{/* ================================================================
   imagePullSecrets
   ================================================================ */}}
{{- define "agenta.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL host
   ================================================================ */}}
{{- define "agenta.postgresHost" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" .Release.Name }}
{{- else }}
{{- required "postgresql.external.host is required when postgresql.enabled=false" .Values.postgresql.external.host }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL port
   ================================================================ */}}
{{- define "agenta.postgresPort" -}}
{{- if .Values.postgresql.enabled }}
{{- 5432 }}
{{- else }}
{{- .Values.postgresql.external.port | default 5432 }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL username
   ================================================================ */}}
{{- define "agenta.postgresUsername" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.username }}
{{- else }}
{{- .Values.postgresql.external.username | default "agenta" }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL URI — Core (asyncpg)
   Uses $(POSTGRES_PASSWORD) for K8s env var substitution at runtime
   ================================================================ */}}
{{- define "agenta.postgresUriCore" -}}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.external.uriCore }}
{{- .Values.postgresql.external.uriCore }}
{{- else }}
{{- $base := printf "postgresql+asyncpg://%s:$(POSTGRES_PASSWORD)@%s:%s/%s" (include "agenta.postgresUsername" .) (include "agenta.postgresHost" .) (include "agenta.postgresPort" . | toString) .Values.postgresql.databases.core }}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.external.sslmode }}
{{- printf "%s?ssl=%s" $base .Values.postgresql.external.sslmode }}
{{- else }}
{{- $base }}
{{- end }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL URI — Tracing (asyncpg)
   ================================================================ */}}
{{- define "agenta.postgresUriTracing" -}}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.external.uriTracing }}
{{- .Values.postgresql.external.uriTracing }}
{{- else }}
{{- $base := printf "postgresql+asyncpg://%s:$(POSTGRES_PASSWORD)@%s:%s/%s" (include "agenta.postgresUsername" .) (include "agenta.postgresHost" .) (include "agenta.postgresPort" . | toString) .Values.postgresql.databases.tracing }}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.external.sslmode }}
{{- printf "%s?ssl=%s" $base .Values.postgresql.external.sslmode }}
{{- else }}
{{- $base }}
{{- end }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL URI — SuperTokens (sync driver, no +asyncpg)
   ================================================================ */}}
{{- define "agenta.postgresUriSupertokens" -}}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.external.uriSupertokens }}
{{- .Values.postgresql.external.uriSupertokens }}
{{- else }}
{{- $base := printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%s/%s" (include "agenta.postgresUsername" .) (include "agenta.postgresHost" .) (include "agenta.postgresPort" . | toString) .Values.postgresql.databases.supertokens }}
{{- if and (not .Values.postgresql.enabled) .Values.postgresql.external.sslmode }}
{{- printf "%s?sslmode=%s" $base .Values.postgresql.external.sslmode }}
{{- else }}
{{- $base }}
{{- end }}
{{- end }}
{{- end }}

{{/* ================================================================
   Redis Volatile URI
   Includes password via $(REDIS_VOLATILE_PASSWORD) when set.
   ================================================================ */}}
{{- define "agenta.redisVolatileUri" -}}
{{- if .Values.redisVolatile.enabled }}
{{- if .Values.redisVolatile.password }}
{{- printf "redis://:$(REDIS_VOLATILE_PASSWORD)@%s-redis-volatile:%d/0" (include "agenta.fullname" .) (.Values.redisVolatile.port | int) }}
{{- else }}
{{- printf "redis://%s-redis-volatile:%d/0" (include "agenta.fullname" .) (.Values.redisVolatile.port | int) }}
{{- end }}
{{- else }}
{{- required "redisVolatile.external.uri is required when redisVolatile.enabled=false" .Values.redisVolatile.external.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   Redis Durable URI
   Includes password via $(REDIS_DURABLE_PASSWORD) when set.
   ================================================================ */}}
{{- define "agenta.redisDurableUri" -}}
{{- if .Values.redisDurable.enabled }}
{{- if .Values.redisDurable.password }}
{{- printf "redis://:$(REDIS_DURABLE_PASSWORD)@%s-redis-durable:%d/0" (include "agenta.fullname" .) (.Values.redisDurable.port | int) }}
{{- else }}
{{- printf "redis://%s-redis-durable:%d/0" (include "agenta.fullname" .) (.Values.redisDurable.port | int) }}
{{- end }}
{{- else }}
{{- required "redisDurable.external.uri is required when redisDurable.enabled=false" .Values.redisDurable.external.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   SuperTokens connection URI
   ================================================================ */}}
{{- define "agenta.supertokensUri" -}}
{{- if .Values.supertokens.enabled }}
{{- printf "http://%s-supertokens:%d" (include "agenta.fullname" .) (.Values.supertokens.port | int) }}
{{- else }}
{{- required "supertokens.external.uri is required when supertokens.enabled=false" .Values.supertokens.external.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   Shared web env vars (public-facing / derived flags)
   ================================================================ */}}
{{- define "agenta.webOptionalEnv" -}}
- name: POSTHOG_API_KEY
  value: {{ .Values.global.posthogApiKey | quote }}
{{- with .Values.secrets.oauth }}
{{- range $key, $val := . }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end }}
{{- if .Values.email.sendgrid.apiKey }}
- name: SENDGRID_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: SENDGRID_API_KEY
      optional: true
{{- end }}
- name: SENDGRID_FROM_ADDRESS
  value: {{ .Values.email.sendgrid.fromAddress | quote }}
{{- if .Values.integrations.composio.apiKey }}
- name: COMPOSIO_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: COMPOSIO_API_KEY
      optional: true
{{- end }}
- name: CLOUDFLARE_TURNSTILE_SITE_KEY
  value: {{ .Values.captcha.turnstile.siteKey | quote }}
{{- if .Values.captcha.turnstile.secretKey }}
- name: CLOUDFLARE_TURNSTILE_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: CLOUDFLARE_TURNSTILE_SECRET_KEY
      optional: true
{{- end }}
{{- end }}

{{/* ================================================================
   Shared backend env vars (typed self-host config + escape hatches)
   ================================================================ */}}
{{- define "agenta.backendOptionalEnv" -}}
- name: POSTHOG_API_KEY
  value: {{ .Values.global.posthogApiKey | quote }}
- name: SENDGRID_FROM_ADDRESS
  value: {{ .Values.email.sendgrid.fromAddress | quote }}
- name: COMPOSIO_API_URL
  value: {{ .Values.integrations.composio.apiUrl | quote }}
- name: CLOUDFLARE_TURNSTILE_SITE_KEY
  value: {{ .Values.captcha.turnstile.siteKey | quote }}
- name: AGENTA_ALLOWED_DOMAINS
  value: {{ .Values.accessControl.allowedDomains | quote }}
- name: AGENTA_BLOCKED_DOMAINS
  value: {{ .Values.accessControl.blockedDomains | quote }}
- name: AGENTA_BLOCKED_EMAILS
  value: {{ .Values.accessControl.blockedEmails | quote }}
- name: AGENTA_ORG_CREATION_ALLOWLIST
  value: {{ .Values.accessControl.orgCreationAllowlist | quote }}
{{- with .Values.secrets.oauth }}
{{- range $key, $val := . }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end }}
{{- with .Values.secrets.llmProviders }}
{{- range $key, $val := . }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end }}
{{- if .Values.email.sendgrid.apiKey }}
- name: SENDGRID_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: SENDGRID_API_KEY
      optional: true
{{- end }}
{{- if .Values.integrations.composio.apiKey }}
- name: COMPOSIO_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: COMPOSIO_API_KEY
      optional: true
{{- end }}
{{- if .Values.observability.newRelic.licenseKey }}
- name: NEW_RELIC_LICENSE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: NEW_RELIC_LICENSE_KEY
      optional: true
{{- end }}
{{- if .Values.captcha.turnstile.secretKey }}
- name: CLOUDFLARE_TURNSTILE_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: CLOUDFLARE_TURNSTILE_SECRET_KEY
      optional: true
{{- end }}
{{- end }}

{{/* ================================================================
   Common environment variables shared by api, workers, cron, alembic
   ================================================================ */}}
{{- define "agenta.commonEnv" -}}
- name: AGENTA_LICENSE
  value: "oss"
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: POSTGRES_PASSWORD
- name: AGENTA_AUTH_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: AGENTA_AUTH_KEY
- name: AGENTA_CRYPT_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: AGENTA_CRYPT_KEY
{{- if .Values.redisVolatile.password }}
- name: REDIS_VOLATILE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: REDIS_VOLATILE_PASSWORD
{{- end }}
{{- if .Values.redisDurable.password }}
- name: REDIS_DURABLE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: REDIS_DURABLE_PASSWORD
{{- end }}
- name: AGENTA_WEB_URL
  value: {{ .Values.global.webUrl | quote }}
- name: AGENTA_API_URL
  value: {{ .Values.global.apiUrl | quote }}
- name: AGENTA_SERVICES_URL
  value: {{ .Values.global.servicesUrl | quote }}
- name: POSTGRES_URI_CORE
  value: {{ include "agenta.postgresUriCore" . | quote }}
- name: POSTGRES_URI_TRACING
  value: {{ include "agenta.postgresUriTracing" . | quote }}
- name: POSTGRES_URI_SUPERTOKENS
  value: {{ include "agenta.postgresUriSupertokens" . | quote }}
- name: REDIS_URI
  value: {{ include "agenta.redisVolatileUri" . | quote }}
- name: REDIS_URI_VOLATILE
  value: {{ include "agenta.redisVolatileUri" . | quote }}
- name: REDIS_URI_DURABLE
  value: {{ include "agenta.redisDurableUri" . | quote }}
- name: SUPERTOKENS_CONNECTION_URI
  value: {{ include "agenta.supertokensUri" . | quote }}
- name: SUPERTOKENS_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: SUPERTOKENS_API_KEY
      optional: true
{{ include "agenta.backendOptionalEnv" . }}
{{- end }}

{{/* ================================================================
   Wait-for-postgres init container (used when postgresql.enabled)
   ================================================================ */}}
{{- define "agenta.waitForPostgres" -}}
- name: wait-for-postgres
  image: busybox:1.36
  command:
    - sh
    - -c
    - |
      echo "Waiting for PostgreSQL at {{ include "agenta.postgresHost" . }}:{{ include "agenta.postgresPort" . }}..."
      until nc -z {{ include "agenta.postgresHost" . }} {{ include "agenta.postgresPort" . }}; do
        echo "PostgreSQL not ready, retrying in 2s..."
        sleep 2
      done
      echo "PostgreSQL is ready."
{{- end }}

{{/* ================================================================
   Wait-for-redis init containers (volatile + durable)
   ================================================================ */}}
{{- define "agenta.waitForRedis" -}}
{{- if .Values.redisVolatile.enabled }}
- name: wait-for-redis-volatile
  image: busybox:1.36
  command:
    - sh
    - -c
    - |
      echo "Waiting for Redis Volatile at {{ include "agenta.fullname" . }}-redis-volatile:{{ .Values.redisVolatile.port }}..."
      until nc -z {{ include "agenta.fullname" . }}-redis-volatile {{ .Values.redisVolatile.port }}; do
        echo "Redis Volatile not ready, retrying in 2s..."
        sleep 2
      done
      echo "Redis Volatile is ready."
{{- end }}
{{- if .Values.redisDurable.enabled }}
- name: wait-for-redis-durable
  image: busybox:1.36
  command:
    - sh
    - -c
    - |
      echo "Waiting for Redis Durable at {{ include "agenta.fullname" . }}-redis-durable:{{ .Values.redisDurable.port }}..."
      until nc -z {{ include "agenta.fullname" . }}-redis-durable {{ .Values.redisDurable.port }}; do
        echo "Redis Durable not ready, retrying in 2s..."
        sleep 2
      done
      echo "Redis Durable is ready."
{{- end }}
{{- end }}
