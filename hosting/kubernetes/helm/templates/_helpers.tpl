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
   Safe accessors — return values dicts with empty-dict fallbacks.
   This lets templates dereference subkeys without nil-pointer panics
   when the user omits a whole top-level section from values.yaml.
   ================================================================ */}}
{{- define "agenta.api" -}}{{ default dict .Values.api | toYaml }}{{- end }}
{{- define "agenta.web" -}}{{ default dict .Values.web | toYaml }}{{- end }}
{{- define "agenta.svc" -}}{{ default dict .Values.services | toYaml }}{{- end }}

{{/* ================================================================
   Component enabled flags (default true).
   ================================================================ */}}
{{- define "agenta.api.enabled" -}}
{{- $v := (default dict .Values.api).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.web.enabled" -}}
{{- $v := (default dict .Values.web).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.services.enabled" -}}
{{- $v := (default dict .Values.services).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.supertokens.enabled" -}}
{{- $v := (default dict .Values.supertokens).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.cron.enabled" -}}
{{- $v := (default dict .Values.cron).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.alembic.enabled" -}}
{{- $v := (default dict .Values.alembic).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.postgresql.enabled" -}}
{{- $v := (default dict .Values.postgresql).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.redisVolatile.enabled" -}}
{{- $v := (default dict .Values.redisVolatile).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.redisDurable.enabled" -}}
{{- $v := (default dict .Values.redisDurable).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.workerEvaluations.enabled" -}}
{{- $v := (default dict .Values.workerEvaluations).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.workerTracing.enabled" -}}
{{- $v := (default dict .Values.workerTracing).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.workerWebhooks.enabled" -}}
{{- $v := (default dict .Values.workerWebhooks).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.workerEvents.enabled" -}}
{{- $v := (default dict .Values.workerEvents).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}
{{- define "agenta.ingress.enabled" -}}
{{- $v := (default dict .Values.ingress).enabled -}}
{{- if kindIs "invalid" $v }}true{{- else }}{{- $v -}}{{- end }}
{{- end }}

{{/* ================================================================
   Replicas (default 1).
   ================================================================ */}}
{{- define "agenta.api.replicas" -}}{{ default 1 (default dict .Values.api).replicas }}{{- end }}
{{- define "agenta.web.replicas" -}}{{ default 1 (default dict .Values.web).replicas }}{{- end }}
{{- define "agenta.services.replicas" -}}{{ default 1 (default dict .Values.services).replicas }}{{- end }}
{{- define "agenta.supertokens.replicas" -}}{{ default 1 (default dict .Values.supertokens).replicas }}{{- end }}
{{- define "agenta.cron.replicas" -}}{{ default 1 (default dict .Values.cron).replicas }}{{- end }}
{{- define "agenta.workerEvaluations.replicas" -}}{{ default 1 (default dict .Values.workerEvaluations).replicas }}{{- end }}
{{- define "agenta.workerTracing.replicas" -}}{{ default 1 (default dict .Values.workerTracing).replicas }}{{- end }}
{{- define "agenta.workerWebhooks.replicas" -}}{{ default 1 (default dict .Values.workerWebhooks).replicas }}{{- end }}
{{- define "agenta.workerEvents.replicas" -}}{{ default 1 (default dict .Values.workerEvents).replicas }}{{- end }}

{{/* ================================================================
   Workers (gunicorn worker count, default 2).
   ================================================================ */}}
{{- define "agenta.api.workers" -}}{{ default 2 (default dict .Values.api).workers }}{{- end }}
{{- define "agenta.services.workers" -}}{{ default 2 (default dict .Values.services).workers }}{{- end }}

{{/* ================================================================
   Ports (defaults).
   ================================================================ */}}
{{- define "agenta.api.port" -}}{{ default 8000 (default dict .Values.api).port }}{{- end }}
{{- define "agenta.web.port" -}}{{ default 3000 (default dict .Values.web).port }}{{- end }}
{{- define "agenta.services.port" -}}{{ default 80 (default dict .Values.services).port }}{{- end }}
{{- define "agenta.supertokens.port" -}}{{ default 3567 (default dict .Values.supertokens).port }}{{- end }}
{{- define "agenta.redisVolatile.port" -}}{{ default 6379 (default dict .Values.redisVolatile).port }}{{- end }}
{{- define "agenta.redisDurable.port" -}}{{ default 6381 (default dict .Values.redisDurable).port }}{{- end }}

{{/* ================================================================
   Image pull policies (default IfNotPresent).
   ================================================================ */}}
{{- define "agenta.api.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.api).image).pullPolicy }}{{- end }}
{{- define "agenta.web.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.web).image).pullPolicy }}{{- end }}
{{- define "agenta.services.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.services).image).pullPolicy }}{{- end }}
{{- define "agenta.supertokens.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.supertokens).image).pullPolicy }}{{- end }}
{{- define "agenta.redisVolatile.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.redisVolatile).image).pullPolicy }}{{- end }}
{{- define "agenta.redisDurable.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.redisDurable).image).pullPolicy }}{{- end }}

{{/* ================================================================
   Section accessors (return the section dict or an empty dict).
   ================================================================ */}}
{{- define "agenta.agentaSection" -}}{{ default dict .Values.agenta }}{{- end }}
{{- define "agenta.accessSection" -}}{{ default dict (default dict .Values.agenta).access }}{{- end }}
{{- define "agenta.alembicSection" -}}{{ default dict .Values.alembic }}{{- end }}
{{- define "agenta.cloudflareTurnstileSection" -}}{{ default dict (default dict .Values.cloudflare).turnstile }}{{- end }}
{{- define "agenta.composioSection" -}}{{ default dict .Values.composio }}{{- end }}
{{- define "agenta.newrelicSection" -}}{{ default dict .Values.newrelic }}{{- end }}
{{- define "agenta.postgresSection" -}}{{ default dict .Values.postgres }}{{- end }}
{{- define "agenta.posthogSection" -}}{{ default dict .Values.posthog }}{{- end }}
{{- define "agenta.sendgridSection" -}}{{ default dict .Values.sendgrid }}{{- end }}
{{- define "agenta.supertokensSection" -}}{{ default dict .Values.supertokens }}{{- end }}
{{- define "agenta.secretsSection" -}}{{ default dict .Values.secrets }}{{- end }}
{{- define "agenta.redisVolatileSection" -}}{{ default dict .Values.redisVolatile }}{{- end }}
{{- define "agenta.redisDurableSection" -}}{{ default dict .Values.redisDurable }}{{- end }}

{{/* ================================================================
   Secret name — either user-provided or chart-managed
   ================================================================ */}}
{{- define "agenta.secretName" -}}
{{- $secrets := default dict .Values.secrets -}}
{{- if $secrets.existingSecret }}
{{- $secrets.existingSecret }}
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
{{- $global := default dict .Values.global -}}
{{- $pg := default dict $global.postgresql -}}
{{- $auth := default dict $pg.auth -}}
{{- $existing := default (printf "%s-pgauth" .Release.Name) $auth.existingSecret -}}
{{- tpl $existing . }}
{{- end }}

{{/* ================================================================
   ServiceAccount name
   ================================================================ */}}
{{- define "agenta.serviceAccountName" -}}
{{- $sa := default dict .Values.serviceAccount -}}
{{- if $sa.create }}
{{- default (include "agenta.fullname" .) $sa.name }}
{{- else }}
{{- default "default" $sa.name }}
{{- end }}
{{- end }}

{{/* ================================================================
   Agenta edition
   ================================================================ */}}
{{- define "agenta.edition" -}}
{{- $agenta := default dict .Values.agenta -}}
{{- default "oss" $agenta.license -}}
{{- end }}

{{/* ================================================================
   API image (shared by api, workers, cron, alembic)
   ================================================================ */}}
{{- define "agenta.apiImageRepository" -}}
{{- $img := default dict (default dict .Values.api).image -}}
{{- if $img.repository -}}
{{- $img.repository -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
ghcr.io/agenta-ai/internal-ee-agenta-api
{{- else -}}
ghcr.io/agenta-ai/agenta-api
{{- end -}}
{{- end }}

{{- define "agenta.apiImage" -}}
{{- $img := default dict (default dict .Values.api).image -}}
{{ include "agenta.apiImageRepository" . }}:{{ $img.tag | default .Chart.AppVersion }}
{{- end }}

{{- define "agenta.webImageRepository" -}}
{{- $img := default dict (default dict .Values.web).image -}}
{{- if $img.repository -}}
{{- $img.repository -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
ghcr.io/agenta-ai/internal-ee-agenta-web
{{- else -}}
ghcr.io/agenta-ai/agenta-web
{{- end -}}
{{- end }}

{{- define "agenta.webImage" -}}
{{- $img := default dict (default dict .Values.web).image -}}
{{ include "agenta.webImageRepository" . }}:{{ $img.tag | default .Chart.AppVersion }}
{{- end }}

{{- define "agenta.servicesImageRepository" -}}
{{- $img := default dict (default dict .Values.services).image -}}
{{- if $img.repository -}}
{{- $img.repository -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
ghcr.io/agenta-ai/internal-ee-agenta-services
{{- else -}}
ghcr.io/agenta-ai/agenta-services
{{- end -}}
{{- end }}

{{- define "agenta.servicesImage" -}}
{{- $img := default dict (default dict .Values.services).image -}}
{{ include "agenta.servicesImageRepository" . }}:{{ $img.tag | default .Chart.AppVersion }}
{{- end }}

{{/* ================================================================
   Supertokens image (default repo and tag).
   ================================================================ */}}
{{- define "agenta.supertokensImage" -}}
{{- $img := default dict (default dict .Values.supertokens).image -}}
{{- $repo := default "registry.supertokens.io/supertokens/supertokens-postgresql" $img.repository -}}
{{- $tag := default "11" $img.tag -}}
{{ $repo }}:{{ $tag }}
{{- end }}

{{/* ================================================================
   Redis images (default repo and tag).
   ================================================================ */}}
{{- define "agenta.redisVolatileImage" -}}
{{- $img := default dict (default dict .Values.redisVolatile).image -}}
{{- $repo := default "redis" $img.repository -}}
{{- $tag := default "8" $img.tag -}}
{{ $repo }}:{{ $tag }}
{{- end }}

{{- define "agenta.redisDurableImage" -}}
{{- $img := default dict (default dict .Values.redisDurable).image -}}
{{- $repo := default "redis" $img.repository -}}
{{- $tag := default "8" $img.tag -}}
{{ $repo }}:{{ $tag }}
{{- end }}

{{/* ================================================================
   Redis defaults (maxmemory, eviction policy).
   ================================================================ */}}
{{- define "agenta.redisVolatile.maxmemory" -}}{{ default "512mb" (default dict .Values.redisVolatile).maxmemory }}{{- end }}
{{- define "agenta.redisVolatile.maxmemoryPolicy" -}}{{ default "volatile-lru" (default dict .Values.redisVolatile).maxmemoryPolicy }}{{- end }}
{{- define "agenta.redisDurable.maxmemory" -}}{{ default "512mb" (default dict .Values.redisDurable).maxmemory }}{{- end }}
{{- define "agenta.redisDurable.maxmemoryPolicy" -}}{{ default "noeviction" (default dict .Values.redisDurable).maxmemoryPolicy }}{{- end }}

{{/* ================================================================
   Alembic job defaults.
   ================================================================ */}}
{{- define "agenta.alembic.activeDeadlineSeconds" -}}{{ default 600 (default dict .Values.alembic).activeDeadlineSeconds }}{{- end }}
{{- define "agenta.alembic.backoffLimit" -}}{{ default 3 (default dict .Values.alembic).backoffLimit }}{{- end }}
{{- define "agenta.alembic.ttlSecondsAfterFinished" -}}{{ default 300 (default dict .Values.alembic).ttlSecondsAfterFinished }}{{- end }}

{{/* ================================================================
   Ingress defaults.
   ================================================================ */}}
{{- define "agenta.ingress.className" -}}{{ default "nginx" (default dict .Values.ingress).className }}{{- end }}
{{- define "agenta.ingress.host" -}}{{ default "agenta.local" (default dict .Values.ingress).host }}{{- end }}
{{- define "agenta.ingress.paths.api.path" -}}
{{- $paths := default dict (default dict .Values.ingress).paths -}}
{{- $api := default dict $paths.api -}}
{{- default "/api" $api.path -}}
{{- end }}
{{- define "agenta.ingress.paths.api.pathType" -}}
{{- $paths := default dict (default dict .Values.ingress).paths -}}
{{- $api := default dict $paths.api -}}
{{- default "Prefix" $api.pathType -}}
{{- end }}
{{- define "agenta.ingress.paths.services.path" -}}
{{- $paths := default dict (default dict .Values.ingress).paths -}}
{{- $svc := default dict $paths.services -}}
{{- default "/services" $svc.path -}}
{{- end }}
{{- define "agenta.ingress.paths.services.pathType" -}}
{{- $paths := default dict (default dict .Values.ingress).paths -}}
{{- $svc := default dict $paths.services -}}
{{- default "Prefix" $svc.pathType -}}
{{- end }}
{{- define "agenta.ingress.paths.web.path" -}}
{{- $paths := default dict (default dict .Values.ingress).paths -}}
{{- $w := default dict $paths.web -}}
{{- default "/" $w.path -}}
{{- end }}
{{- define "agenta.ingress.paths.web.pathType" -}}
{{- $paths := default dict (default dict .Values.ingress).paths -}}
{{- $w := default dict $paths.web -}}
{{- default "Prefix" $w.pathType -}}
{{- end }}

{{/* ================================================================
   Postgresql section defaults (Bitnami subchart wiring).
   ================================================================ */}}
{{- define "agenta.postgresql.authUsername" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $auth := default dict $pg.auth -}}
{{- default "agenta" $auth.username -}}
{{- end }}

{{/* ================================================================
   Edition-specific paths and database names
   ================================================================ */}}
{{- define "agenta.webServerPath" -}}
{{- if eq (include "agenta.edition" .) "ee" -}}
./ee/server.js
{{- else -}}
./oss/server.js
{{- end -}}
{{- end }}

{{- define "agenta.alembicRunnerModule" -}}
{{- if eq (include "agenta.edition" .) "ee" -}}
ee.databases.postgres.migrations.runner
{{- else -}}
oss.databases.postgres.migrations.runner
{{- end -}}
{{- end }}

{{- define "agenta.alembicCfgPathCore" -}}
{{- $a := default dict .Values.alembic -}}
{{- if $a.cfgPathCore -}}{{- $a.cfgPathCore -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
/app/ee/databases/postgres/migrations/core/alembic.ini
{{- else -}}
/app/oss/databases/postgres/migrations/core/alembic.ini
{{- end -}}
{{- end }}

{{- define "agenta.alembicCfgPathTracing" -}}
{{- $a := default dict .Values.alembic -}}
{{- if $a.cfgPathTracing -}}{{- $a.cfgPathTracing -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
/app/ee/databases/postgres/migrations/tracing/alembic.ini
{{- else -}}
/app/oss/databases/postgres/migrations/tracing/alembic.ini
{{- end -}}
{{- end }}

{{- define "agenta.postgresDbCore" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $dbs := default dict $pg.databases -}}
{{- if $dbs.core -}}
{{- $dbs.core -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
agenta_ee_core
{{- else -}}
agenta_oss_core
{{- end -}}
{{- end }}

{{- define "agenta.postgresDbTracing" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $dbs := default dict $pg.databases -}}
{{- if $dbs.tracing -}}
{{- $dbs.tracing -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
agenta_ee_tracing
{{- else -}}
agenta_oss_tracing
{{- end -}}
{{- end }}

{{- define "agenta.postgresDbSupertokens" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $dbs := default dict $pg.databases -}}
{{- if $dbs.supertokens -}}
{{- $dbs.supertokens -}}
{{- else if eq (include "agenta.edition" .) "ee" -}}
agenta_ee_supertokens
{{- else -}}
agenta_oss_supertokens
{{- end -}}
{{- end }}

{{/* ================================================================
   imagePullSecrets
   ================================================================ */}}
{{- define "agenta.imagePullSecrets" -}}
{{- $global := default dict .Values.global -}}
{{- with $global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL host
   ================================================================ */}}
{{- define "agenta.postgresHost" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- if eq (include "agenta.postgresql.enabled" .) "true" }}
{{- printf "%s-postgresql" .Release.Name }}
{{- else }}
{{- required "postgresql.external.host is required when postgresql.enabled=false" $ext.host }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL port
   ================================================================ */}}
{{- define "agenta.postgresPort" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- if eq (include "agenta.postgresql.enabled" .) "true" }}
{{- 5432 }}
{{- else }}
{{- $ext.port | default 5432 }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL username
   ================================================================ */}}
{{- define "agenta.postgresUsername" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $auth := default dict $pg.auth -}}
{{- $ext := default dict $pg.external -}}
{{- if eq (include "agenta.postgresql.enabled" .) "true" }}
{{- default "agenta" $auth.username }}
{{- else }}
{{- $ext.username | default "agenta" }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL URI — Core (asyncpg)
   Uses $(POSTGRES_PASSWORD) for K8s env var substitution at runtime
   ================================================================ */}}
{{- define "agenta.postgresUriCore" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- $top := default dict .Values.postgres -}}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.uriCore }}
{{- $ext.uriCore }}
{{- else if and (ne (include "agenta.postgresql.enabled" .) "true") $top.uriCore }}
{{- $top.uriCore }}
{{- else if $top.uriCore }}
{{- $top.uriCore }}
{{- else }}
{{- $base := printf "postgresql+asyncpg://%s:$(POSTGRES_PASSWORD)@%s:%s/%s" (include "agenta.postgresUsername" .) (include "agenta.postgresHost" .) (include "agenta.postgresPort" . | toString) (include "agenta.postgresDbCore" .) }}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.sslmode }}
{{- printf "%s?ssl=%s" $base $ext.sslmode }}
{{- else }}
{{- $base }}
{{- end }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL URI — Tracing (asyncpg)
   ================================================================ */}}
{{- define "agenta.postgresUriTracing" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- $top := default dict .Values.postgres -}}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.uriTracing }}
{{- $ext.uriTracing }}
{{- else if $top.uriTracing }}
{{- $top.uriTracing }}
{{- else }}
{{- $base := printf "postgresql+asyncpg://%s:$(POSTGRES_PASSWORD)@%s:%s/%s" (include "agenta.postgresUsername" .) (include "agenta.postgresHost" .) (include "agenta.postgresPort" . | toString) (include "agenta.postgresDbTracing" .) }}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.sslmode }}
{{- printf "%s?ssl=%s" $base $ext.sslmode }}
{{- else }}
{{- $base }}
{{- end }}
{{- end }}
{{- end }}

{{/* ================================================================
   PostgreSQL URI — SuperTokens (sync driver, no +asyncpg)
   ================================================================ */}}
{{- define "agenta.postgresUriSupertokens" -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- $top := default dict .Values.postgres -}}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.uriSupertokens }}
{{- $ext.uriSupertokens }}
{{- else if $top.uriSupertokens }}
{{- $top.uriSupertokens }}
{{- else }}
{{- $base := printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%s/%s" (include "agenta.postgresUsername" .) (include "agenta.postgresHost" .) (include "agenta.postgresPort" . | toString) (include "agenta.postgresDbSupertokens" .) }}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.sslmode }}
{{- printf "%s?sslmode=%s" $base $ext.sslmode }}
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
{{- $rv := default dict .Values.redisVolatile -}}
{{- $ext := default dict $rv.external -}}
{{- $port := include "agenta.redisVolatile.port" . | int -}}
{{- $topRedis := default dict .Values.redis -}}
{{- if eq (include "agenta.redisVolatile.enabled" .) "true" }}
{{- if $rv.password }}
{{- printf "redis://:$(REDIS_VOLATILE_PASSWORD)@%s-redis-volatile:%d/0" (include "agenta.fullname" .) $port }}
{{- else }}
{{- printf "redis://%s-redis-volatile:%d/0" (include "agenta.fullname" .) $port }}
{{- end }}
{{- else if $ext.uri }}
{{- $ext.uri }}
{{- else if $topRedis.uriVolatile }}
{{- $topRedis.uriVolatile }}
{{- else if $topRedis.uri }}
{{- $topRedis.uri }}
{{- else }}
{{- required "redisVolatile.external.uri or redis.uriVolatile is required when redisVolatile.enabled=false" $ext.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   Redis Durable URI
   Includes password via $(REDIS_DURABLE_PASSWORD) when set.
   ================================================================ */}}
{{- define "agenta.redisDurableUri" -}}
{{- $rd := default dict .Values.redisDurable -}}
{{- $ext := default dict $rd.external -}}
{{- $port := include "agenta.redisDurable.port" . | int -}}
{{- $topRedis := default dict .Values.redis -}}
{{- if eq (include "agenta.redisDurable.enabled" .) "true" }}
{{- if $rd.password }}
{{- printf "redis://:$(REDIS_DURABLE_PASSWORD)@%s-redis-durable:%d/0" (include "agenta.fullname" .) $port }}
{{- else }}
{{- printf "redis://%s-redis-durable:%d/0" (include "agenta.fullname" .) $port }}
{{- end }}
{{- else if $ext.uri }}
{{- $ext.uri }}
{{- else if $topRedis.uriDurable }}
{{- $topRedis.uriDurable }}
{{- else }}
{{- required "redisDurable.external.uri or redis.uriDurable is required when redisDurable.enabled=false" $ext.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   SuperTokens connection URI
   ================================================================ */}}
{{- define "agenta.supertokensUri" -}}
{{- $st := default dict .Values.supertokens -}}
{{- $ext := default dict $st.external -}}
{{- if eq (include "agenta.supertokens.enabled" .) "true" }}
{{- printf "http://%s-supertokens:%d" (include "agenta.fullname" .) (include "agenta.supertokens.port" . | int) }}
{{- else if $st.uriCore }}
{{- $st.uriCore }}
{{- else if $ext.uri }}
{{- $ext.uri }}
{{- else }}
{{- required "supertokens.external.uri or supertokens.uriCore is required when supertokens.enabled=false" $ext.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   Shared web env vars (public-facing / derived flags)
   ================================================================ */}}
{{- define "agenta.webOptionalEnv" -}}
{{- $posthog := default dict .Values.posthog -}}
{{- $sendgrid := default dict .Values.sendgrid -}}
{{- $composio := default dict .Values.composio -}}
{{- $cf := default dict (default dict .Values.cloudflare).turnstile -}}
{{- $secrets := default dict .Values.secrets -}}
- name: POSTHOG_API_KEY
  value: {{ $posthog.apiKey | default "" | quote }}
{{- with $secrets.oauth }}
{{- range $key, $val := . }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end }}
{{- if $sendgrid.apiKey }}
- name: SENDGRID_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: SENDGRID_API_KEY
      optional: true
{{- end }}
- name: SENDGRID_FROM_ADDRESS
  value: {{ $sendgrid.fromAddress | default "" | quote }}
{{- if $composio.apiKey }}
- name: COMPOSIO_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: COMPOSIO_API_KEY
      optional: true
{{- end }}
- name: CLOUDFLARE_TURNSTILE_SITE_KEY
  value: {{ $cf.siteKey | default "" | quote }}
{{- if $cf.secretKey }}
- name: CLOUDFLARE_TURNSTILE_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: CLOUDFLARE_TURNSTILE_SECRET_KEY
      optional: true
{{- end }}
{{- end }}

{{/* ================================================================
   Common environment variables shared by api, workers, cron, alembic.
   Inlines the legacy `backendOptionalEnv` block.
   ================================================================ */}}
{{- define "agenta.commonEnv" -}}
{{- $agenta := default dict .Values.agenta -}}
{{- $access := default dict $agenta.access -}}
{{- $rv := default dict .Values.redisVolatile -}}
{{- $rd := default dict .Values.redisDurable -}}
{{- $posthog := default dict .Values.posthog -}}
{{- $sendgrid := default dict .Values.sendgrid -}}
{{- $composio := default dict .Values.composio -}}
{{- $cf := default dict (default dict .Values.cloudflare).turnstile -}}
{{- $nr := default dict .Values.newrelic -}}
{{- $secrets := default dict .Values.secrets -}}
- name: AGENTA_LICENSE
  value: {{ include "agenta.edition" . | quote }}
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
{{- if $rv.password }}
- name: REDIS_VOLATILE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: REDIS_VOLATILE_PASSWORD
{{- end }}
{{- if $rd.password }}
- name: REDIS_DURABLE_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: REDIS_DURABLE_PASSWORD
{{- end }}
- name: AGENTA_WEB_URL
  value: {{ $agenta.webUrl | default "" | quote }}
- name: AGENTA_SERVICES_URL
  value: {{ $agenta.servicesUrl | default "" | quote }}
- name: AGENTA_API_URL
  value: {{ $agenta.apiUrl | default "" | quote }}
{{- if $agenta.apiInternalUrl }}
- name: AGENTA_API_INTERNAL_URL
  value: {{ $agenta.apiInternalUrl | quote }}
{{- end }}
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
- name: SUPERTOKENS_URI_CORE
  value: {{ include "agenta.supertokensUri" . | quote }}
- name: SUPERTOKENS_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: SUPERTOKENS_API_KEY
      optional: true
- name: POSTHOG_API_KEY
  value: {{ $posthog.apiKey | default "" | quote }}
- name: SENDGRID_FROM_ADDRESS
  value: {{ $sendgrid.fromAddress | default "" | quote }}
- name: COMPOSIO_API_URL
  value: {{ $composio.apiUrl | default "" | quote }}
- name: CLOUDFLARE_TURNSTILE_SITE_KEY
  value: {{ $cf.siteKey | default "" | quote }}
{{- if $access.allowedDomains }}
- name: AGENTA_ACCESS_ALLOWED_DOMAINS
  value: {{ $access.allowedDomains | quote }}
{{- end }}
{{- if $access.blockedDomains }}
- name: AGENTA_ACCESS_BLOCKED_DOMAINS
  value: {{ $access.blockedDomains | quote }}
{{- end }}
{{- if $access.blockedEmails }}
- name: AGENTA_ACCESS_BLOCKED_EMAILS
  value: {{ $access.blockedEmails | quote }}
{{- end }}
{{- if $access.allowedOwnerEmails }}
- name: AGENTA_ACCESS_ALLOWED_OWNER_EMAILS
  value: {{ $access.allowedOwnerEmails | quote }}
{{- end }}
{{- with $access.plans }}
- name: AGENTA_ACCESS_PLANS
  value: {{ toJson . | quote }}
{{- end }}
{{- with $access.roles }}
- name: AGENTA_ACCESS_ROLES
  value: {{ toJson . | quote }}
{{- end }}
{{- with $access.rolesOverlay }}
- name: AGENTA_ACCESS_ROLES_OVERLAY
  value: {{ toJson . | quote }}
{{- end }}
{{- if $access.defaultPlan }}
- name: AGENTA_ACCESS_DEFAULT_PLAN
  value: {{ $access.defaultPlan | quote }}
{{- end }}
{{- with $access.defaultPlanOverlay }}
- name: AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY
  value: {{ toJson . | quote }}
{{- end }}
{{- with $secrets.oauth }}
{{- range $key, $val := . }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end }}
{{- with $secrets.llmProviders }}
{{- range $key, $val := . }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end }}
{{- if $sendgrid.apiKey }}
- name: SENDGRID_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: SENDGRID_API_KEY
      optional: true
{{- end }}
{{- if $composio.apiKey }}
- name: COMPOSIO_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: COMPOSIO_API_KEY
      optional: true
{{- end }}
{{- if $nr.licenseKey }}
- name: NEWRELIC_LICENSE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: NEWRELIC_LICENSE_KEY
      optional: true
{{- end }}
{{- if $cf.secretKey }}
- name: CLOUDFLARE_TURNSTILE_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: CLOUDFLARE_TURNSTILE_SECRET_KEY
      optional: true
{{- end }}
{{- end }}

{{/* ================================================================
   Wait-for-postgres init container (used when postgresql.enabled)
   ================================================================ */}}
{{- define "agenta.waitForPostgres" -}}
- name: wait-for-postgres
  image: busybox:1
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
{{- if eq (include "agenta.redisVolatile.enabled" .) "true" }}
- name: wait-for-redis-volatile
  image: busybox:1
  command:
    - sh
    - -c
    - |
      echo "Waiting for Redis Volatile at {{ include "agenta.fullname" . }}-redis-volatile:{{ include "agenta.redisVolatile.port" . }}..."
      until nc -z {{ include "agenta.fullname" . }}-redis-volatile {{ include "agenta.redisVolatile.port" . }}; do
        echo "Redis Volatile not ready, retrying in 2s..."
        sleep 2
      done
      echo "Redis Volatile is ready."
{{- end }}
{{- if eq (include "agenta.redisDurable.enabled" .) "true" }}
- name: wait-for-redis-durable
  image: busybox:1
  command:
    - sh
    - -c
    - |
      echo "Waiting for Redis Durable at {{ include "agenta.fullname" . }}-redis-durable:{{ include "agenta.redisDurable.port" . }}..."
      until nc -z {{ include "agenta.fullname" . }}-redis-durable {{ include "agenta.redisDurable.port" . }}; do
        echo "Redis Durable not ready, retrying in 2s..."
        sleep 2
      done
      echo "Redis Durable is ready."
{{- end }}
{{- end }}
