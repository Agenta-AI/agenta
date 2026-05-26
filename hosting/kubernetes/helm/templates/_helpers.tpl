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
{{- $v := (default dict (include "agenta.values" . | fromYaml).supertokens).enabled -}}
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
{{- define "agenta.supertokens.replicas" -}}{{ default 1 (default dict (include "agenta.values" . | fromYaml).supertokens).replicas }}{{- end }}
{{- /* cron runs supercronic, which doesn't coordinate across replicas:
       N replicas = every scheduled job fires N times. Hard-set to 1.
       The values key is kept as documentation; we ignore user overrides. */ -}}
{{- define "agenta.cron.replicas" -}}1{{- end }}
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
{{- define "agenta.supertokens.port" -}}{{ default 3567 (default dict (include "agenta.values" . | fromYaml).supertokens).port }}{{- end }}
{{- define "agenta.redisVolatile.port" -}}{{ default 6379 (default dict .Values.redisVolatile).port }}{{- end }}
{{- define "agenta.redisDurable.port" -}}{{ default 6381 (default dict .Values.redisDurable).port }}{{- end }}

{{/* ================================================================
   Image pull policies (default IfNotPresent).
   ================================================================ */}}
{{- define "agenta.api.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.api).image).pullPolicy }}{{- end }}
{{- define "agenta.web.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.web).image).pullPolicy }}{{- end }}
{{- define "agenta.services.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.services).image).pullPolicy }}{{- end }}
{{- define "agenta.supertokens.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict (include "agenta.values" . | fromYaml).supertokens).image).pullPolicy }}{{- end }}
{{- define "agenta.redisVolatile.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.redisVolatile).image).pullPolicy }}{{- end }}
{{- define "agenta.redisDurable.pullPolicy" -}}{{ default "IfNotPresent" (default dict (default dict .Values.redisDurable).image).pullPolicy }}{{- end }}

{{/* ================================================================
   Canonical values reader. Helpers/templates that touch renamed
   paths (`agenta.*`, `posthog.*`, `postgres.*`, `supertokens.apiKey`,
   `sendgrid.*`, `composio.*`, `newrelic.*`, `cloudflare.*`) bind
   a local at the top of the helper:

       {{- $values := include "agenta.values" . | fromYaml -}}

   and read from `$values.X` instead of `.Values.X`. Per-component
   infra keys (`api.*`, `web.*`, `services.*`, `redisVolatile.*`,
   `redisDurable.*`, `ingress.*`, `workerX.*`, `cron.*`, `alembic.*`,
   `postgresql.*`, `identity.*`, `llm.*`, `secrets.*`, `global.*`)
   never had legacy forms and stay on direct `.Values.X` reads.

   `agenta.values` delegates to `agenta.deprecated` (in _compatibility.tpl)
   which folds pre-v0.100.3 keys into canonical positions. To remove
   compat: delete _compatibility.tpl and change the body below to
   `{{- .Values | toYaml -}}`.
   ================================================================ */}}
{{- define "agenta.values" -}}
{{- include "agenta.deprecated" . -}}
{{- end }}

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
{{- /* See serviceaccount.yaml: `default true` would silently override
       an explicit `serviceAccount.create: false`. Use hasKey so the
       helper agrees with the template — otherwise pods would mount a
       SA name the template never created. */ -}}
{{- $create := true -}}
{{- if hasKey $sa "create" -}}{{- $create = $sa.create -}}{{- end -}}
{{- if $create }}
{{- default (include "agenta.fullname" .) $sa.name }}
{{- else }}
{{- default "default" $sa.name }}
{{- end }}
{{- end }}

{{/* ================================================================
   Agenta edition
   ================================================================ */}}
{{- define "agenta.edition" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $agenta := default dict $values.agenta -}}
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
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $img := default dict (default dict $values.supertokens).image -}}
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
{{- define "agenta.ingress.className" -}}{{ default "traefik" (default dict .Values.ingress).className }}{{- end }}
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
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- $top := default dict $values.postgres -}}
{{- /* Override URIs are only honored when bundled PG is OFF.
       With bundled PG enabled, the in-cluster service URI always wins
       so a stale postgres.uriCore in values can't silently redirect
       traffic away from the StatefulSet we just deployed. */ -}}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.uriCore }}
{{- $ext.uriCore }}
{{- else if and (ne (include "agenta.postgresql.enabled" .) "true") $top.uriCore }}
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
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- $top := default dict $values.postgres -}}
{{- /* Override URIs honored only when bundled PG is OFF (see uriCore). */ -}}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.uriTracing }}
{{- $ext.uriTracing }}
{{- else if and (ne (include "agenta.postgresql.enabled" .) "true") $top.uriTracing }}
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
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $pg := default dict .Values.postgresql -}}
{{- $ext := default dict $pg.external -}}
{{- $top := default dict $values.postgres -}}
{{- /* Override URIs honored only when bundled PG is OFF (see uriCore). */ -}}
{{- if and (ne (include "agenta.postgresql.enabled" .) "true") $ext.uriSupertokens }}
{{- $ext.uriSupertokens }}
{{- else if and (ne (include "agenta.postgresql.enabled" .) "true") $top.uriSupertokens }}
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
{{- else if $topRedis.uri }}
{{- $topRedis.uri }}
{{- else }}
{{- required "redisDurable.external.uri or redis.uriDurable (or legacy redis.uri) is required when redisDurable.enabled=false" $ext.uri }}
{{- end }}
{{- end }}

{{/* ================================================================
   SuperTokens connection URI
   ================================================================ */}}
{{- define "agenta.supertokensUri" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $st := default dict $values.supertokens -}}
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
   Public URLs — derived from ingress.host when ingress is enabled.

   Resolution order (per URL):
     1. agenta.webUrl / apiUrl / servicesUrl explicitly set in values.
     2. Derived from ingress.host (+ scheme from ingress.tls) when
        ingress.enabled is true.
     3. Empty string (caller is responsible — validatePublicUrls
        below fails the install rather than letting empty URLs reach
        the runtime, which would silently break OAuth redirects,
        email links, CORS, and absolute-URL builders).
   ================================================================ */}}
{{- define "agenta.ingressScheme" -}}
{{- $ingress := default dict .Values.ingress -}}
{{- if $ingress.tls }}https{{ else }}http{{ end }}
{{- end }}

{{- define "agenta.webUrlEffective" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $agenta := default dict $values.agenta -}}
{{- $ingress := default dict .Values.ingress -}}
{{- if $agenta.webUrl -}}
{{- $agenta.webUrl -}}
{{- else if and (eq (include "agenta.ingress.enabled" .) "true") $ingress.host -}}
{{- printf "%s://%s" (include "agenta.ingressScheme" .) $ingress.host -}}
{{- end -}}
{{- end }}

{{- define "agenta.apiUrlEffective" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $agenta := default dict $values.agenta -}}
{{- $ingress := default dict .Values.ingress -}}
{{- if $agenta.apiUrl -}}
{{- $agenta.apiUrl -}}
{{- else if and (eq (include "agenta.ingress.enabled" .) "true") $ingress.host -}}
{{- printf "%s://%s/api" (include "agenta.ingressScheme" .) $ingress.host -}}
{{- end -}}
{{- end }}

{{- define "agenta.servicesUrlEffective" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $agenta := default dict $values.agenta -}}
{{- $ingress := default dict .Values.ingress -}}
{{- if $agenta.servicesUrl -}}
{{- $agenta.servicesUrl -}}
{{- else if and (eq (include "agenta.ingress.enabled" .) "true") $ingress.host -}}
{{- printf "%s://%s/services" (include "agenta.ingressScheme" .) $ingress.host -}}
{{- end -}}
{{- end }}

{{/* ================================================================
   Shared web env vars (public-facing / derived flags)
   ================================================================ */}}
{{- define "agenta.webOptionalEnv" -}}
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $posthog := default dict $values.posthog -}}
{{- $sendgrid := default dict $values.sendgrid -}}
{{- $composio := default dict $values.composio -}}
{{- $cf := default dict (default dict $values.cloudflare).turnstile -}}
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
{{- $values := include "agenta.values" . | fromYaml -}}
{{- $agenta := default dict $values.agenta -}}
{{- $access := default dict $agenta.access -}}
{{- $aiServices := default dict $agenta.aiServices -}}
{{- $agentaApi := default dict $agenta.api -}}
{{- $apiCaching := default dict $agentaApi.caching -}}
{{- $extras := default dict $agenta.extras -}}
{{- $logging := default dict $agenta.logging -}}
{{- $otlp := default dict $agenta.otlp -}}
{{- $agentaServices := default dict $agenta.services -}}
{{- $svcHook := default dict $agentaServices.hook -}}
{{- $svcCode := default dict $agentaServices.code -}}
{{- $svcMiddleware := default dict $agentaServices.middleware -}}
{{- $webhooksCfg := default dict $agenta.webhooks -}}
{{- $rv := default dict .Values.redisVolatile -}}
{{- $rd := default dict .Values.redisDurable -}}
{{- $posthog := default dict $values.posthog -}}
{{- $sendgrid := default dict $values.sendgrid -}}
{{- $composio := default dict $values.composio -}}
{{- $cf := default dict (default dict $values.cloudflare).turnstile -}}
{{- $nr := default dict $values.newrelic -}}
{{- $loops := default dict .Values.loops -}}
{{- $crisp := default dict .Values.crisp -}}
{{- $daytona := default dict .Values.daytona -}}
{{- $secrets := default dict .Values.secrets -}}
{{- $identity := default dict .Values.identity -}}
{{- $llm := default dict .Values.llm -}}
{{- $supertokensCfg := default dict $values.supertokens -}}
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
  value: {{ include "agenta.webUrlEffective" . | quote }}
- name: AGENTA_SERVICES_URL
  value: {{ include "agenta.servicesUrlEffective" . | quote }}
- name: AGENTA_API_URL
  value: {{ include "agenta.apiUrlEffective" . | quote }}
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
{{- if $posthog.apiUrl }}
- name: POSTHOG_API_URL
  value: {{ $posthog.apiUrl | quote }}
{{- end }}
- name: SENDGRID_FROM_ADDRESS
  value: {{ $sendgrid.fromAddress | default "" | quote }}
- name: COMPOSIO_API_URL
  value: {{ $composio.apiUrl | default "" | quote }}
- name: CLOUDFLARE_TURNSTILE_SITE_KEY
  value: {{ $cf.siteKey | default "" | quote }}
{{- if $cf.allowedHostnames }}
- name: CLOUDFLARE_TURNSTILE_ALLOWED_HOSTNAMES
  value: {{ $cf.allowedHostnames | quote }}
{{- end }}
{{- if hasKey $access "emailDisabled" }}
- name: AGENTA_ACCESS_EMAIL_DISABLED
  value: {{ $access.emailDisabled | quote }}
{{- end }}
{{- if $supertokensCfg.application }}
- name: SUPERTOKENS_APPLICATION
  value: {{ $supertokensCfg.application | quote }}
{{- end }}
{{- if $supertokensCfg.tenant }}
- name: SUPERTOKENS_TENANT
  value: {{ $supertokensCfg.tenant | quote }}
{{- end }}
{{- if $supertokensCfg.passwordPolicy }}
- name: SUPERTOKENS_PASSWORD_POLICY
  value: {{ $supertokensCfg.passwordPolicy | quote }}
{{- end }}
{{- if $supertokensCfg.passwordMinLength }}
- name: SUPERTOKENS_PASSWORD_MIN_LENGTH
  value: {{ $supertokensCfg.passwordMinLength | quote }}
{{- end }}
{{- if $supertokensCfg.passwordMaxLength }}
- name: SUPERTOKENS_PASSWORD_MAX_LENGTH
  value: {{ $supertokensCfg.passwordMaxLength | quote }}
{{- end }}
{{- if $supertokensCfg.passwordRegex }}
- name: SUPERTOKENS_PASSWORD_REGEX
  value: {{ $supertokensCfg.passwordRegex | quote }}
{{- end }}
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
{{- /* agenta.aiServices — AI service endpoint + auth */}}
{{- if $aiServices.apiUrl }}
- name: AGENTA_AI_SERVICES_API_URL
  value: {{ $aiServices.apiUrl | quote }}
{{- end }}
{{- if $aiServices.environmentSlug }}
- name: AGENTA_AI_SERVICES_ENVIRONMENT_SLUG
  value: {{ $aiServices.environmentSlug | quote }}
{{- end }}
{{- if $aiServices.apiKey }}
- name: AGENTA_AI_SERVICES_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: AGENTA_AI_SERVICES_API_KEY
      optional: true
{{- end }}
{{- if $aiServices.refinePromptKey }}
- name: AGENTA_AI_SERVICES_REFINE_PROMPT_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: AGENTA_AI_SERVICES_REFINE_PROMPT_KEY
      optional: true
{{- end }}
{{- /* agenta.api.caching — request-cache toggle */}}
{{- if hasKey $apiCaching "enabled" }}
- name: AGENTA_API_CACHING_ENABLED
  value: {{ $apiCaching.enabled | quote }}
{{- end }}
{{- /* agenta.logging — log destination + levels */}}
{{- if hasKey $logging "consoleEnabled" }}
- name: AGENTA_LOGGING_CONSOLE_ENABLED
  value: {{ $logging.consoleEnabled | quote }}
{{- end }}
{{- if $logging.consoleLevel }}
- name: AGENTA_LOGGING_CONSOLE_LEVEL
  value: {{ $logging.consoleLevel | quote }}
{{- end }}
{{- if hasKey $logging "fileEnabled" }}
- name: AGENTA_LOGGING_FILE_ENABLED
  value: {{ $logging.fileEnabled | quote }}
{{- end }}
{{- if $logging.fileLevel }}
- name: AGENTA_LOGGING_FILE_LEVEL
  value: {{ $logging.fileLevel | quote }}
{{- end }}
{{- if $logging.filePath }}
- name: AGENTA_LOGGING_FILE_PATH
  value: {{ $logging.filePath | quote }}
{{- end }}
{{- if hasKey $logging "otlpEnabled" }}
- name: AGENTA_LOGGING_OTLP_ENABLED
  value: {{ $logging.otlpEnabled | quote }}
{{- end }}
{{- if $logging.otlpLevel }}
- name: AGENTA_LOGGING_OTLP_LEVEL
  value: {{ $logging.otlpLevel | quote }}
{{- end }}
{{- /* agenta.otlp — OTLP ingestion knobs */}}
{{- if $otlp.maxBatchBytes }}
- name: AGENTA_OTLP_MAX_BATCH_BYTES
  value: {{ $otlp.maxBatchBytes | quote }}
{{- end }}
{{- /* agenta.webhooks — outbound webhook flags */}}
{{- if hasKey $webhooksCfg "allowInsecure" }}
- name: AGENTA_WEBHOOKS_ALLOW_INSECURE
  value: {{ $webhooksCfg.allowInsecure | quote }}
{{- end }}
{{- /* agenta.services.hook — surfaced to user-code runners via SDK */}}
{{- if hasKey $svcHook "allowInsecure" }}
- name: AGENTA_SERVICES_HOOK_ALLOW_INSECURE
  value: {{ $svcHook.allowInsecure | quote }}
{{- end }}
{{- /* agenta.services.code — SDK sandbox runner selector */}}
{{- if $svcCode.sandboxRunner }}
- name: AGENTA_SERVICES_CODE_SANDBOX_RUNNER
  value: {{ $svcCode.sandboxRunner | quote }}
{{- end }}
{{- /* agenta.services.middleware — SDK middleware toggles */}}
{{- if hasKey $svcMiddleware "authEnabled" }}
- name: AGENTA_SERVICES_MIDDLEWARE_AUTH_ENABLED
  value: {{ $svcMiddleware.authEnabled | quote }}
{{- end }}
{{- if hasKey $svcMiddleware "cachingEnabled" }}
- name: AGENTA_SERVICES_MIDDLEWARE_CACHING_ENABLED
  value: {{ $svcMiddleware.cachingEnabled | quote }}
{{- end }}
{{- /* agenta.extras.demos — EE reads AGENTA_DEMOS for demo workspace seeding */}}
{{- if $extras.demos }}
- name: AGENTA_DEMOS
  value: {{ $extras.demos | quote }}
- name: AGENTA_EXTRAS_DEMOS
  value: {{ $extras.demos | quote }}
{{- end }}
{{- /* crisp — surfaced as NEXT_PUBLIC_CRISP_WEBSITE_ID to the web container */}}
{{- if $crisp.websiteId }}
- name: CRISP_WEBSITE_ID
  value: {{ $crisp.websiteId | quote }}
{{- end }}
{{- /* daytona — sandbox runner config read by the agenta SDK */}}
{{- if $daytona.apiUrl }}
- name: DAYTONA_API_URL
  value: {{ $daytona.apiUrl | quote }}
{{- end }}
{{- if $daytona.snapshot }}
- name: DAYTONA_SNAPSHOT
  value: {{ $daytona.snapshot | quote }}
{{- end }}
{{- if $daytona.target }}
- name: DAYTONA_TARGET
  value: {{ $daytona.target | quote }}
{{- end }}
{{- if $daytona.apiKey }}
- name: DAYTONA_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: DAYTONA_API_KEY
      optional: true
{{- end }}
{{- /* loops — transactional email */}}
{{- if $loops.apiKey }}
- name: LOOPS_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" . }}
      key: LOOPS_API_KEY
      optional: true
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
{{- /* identity.<provider> — structured OAuth/OIDC (v0.100.3+) */}}
{{- $identityEnvVars := list }}
{{- with $identity.apple }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "APPLE_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "APPLE_OAUTH_CLIENT_SECRET" }}{{- end }}{{- if .keyId }}{{- $identityEnvVars = append $identityEnvVars "APPLE_KEY_ID" }}{{- end }}{{- if .privateKey }}{{- $identityEnvVars = append $identityEnvVars "APPLE_PRIVATE_KEY" }}{{- end }}{{- if .teamId }}{{- $identityEnvVars = append $identityEnvVars "APPLE_TEAM_ID" }}{{- end }}{{- end }}
{{- with $identity.azureAd }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "AZURE_AD_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "AZURE_AD_OAUTH_CLIENT_SECRET" }}{{- end }}{{- if .directoryId }}{{- $identityEnvVars = append $identityEnvVars "AZURE_AD_DIRECTORY_ID" }}{{- end }}{{- end }}
{{- with $identity.bitbucket }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "BITBUCKET_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "BITBUCKET_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.boxySaml }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "BOXY_SAML_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "BOXY_SAML_OAUTH_CLIENT_SECRET" }}{{- end }}{{- if .url }}{{- $identityEnvVars = append $identityEnvVars "BOXY_SAML_URL" }}{{- end }}{{- end }}
{{- with $identity.discord }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "DISCORD_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "DISCORD_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.facebook }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "FACEBOOK_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "FACEBOOK_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.github }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "GITHUB_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "GITHUB_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.gitlab }}{{- if .baseUrl }}{{- $identityEnvVars = append $identityEnvVars "GITLAB_BASE_URL" }}{{- end }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "GITLAB_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "GITLAB_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.google }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "GOOGLE_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "GOOGLE_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.googleWorkspaces }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "GOOGLE_WORKSPACES_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "GOOGLE_WORKSPACES_OAUTH_CLIENT_SECRET" }}{{- end }}{{- if .hd }}{{- $identityEnvVars = append $identityEnvVars "GOOGLE_WORKSPACES_HD" }}{{- end }}{{- end }}
{{- with $identity.linkedin }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "LINKEDIN_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "LINKEDIN_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- with $identity.okta }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "OKTA_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "OKTA_OAUTH_CLIENT_SECRET" }}{{- end }}{{- if .domain }}{{- $identityEnvVars = append $identityEnvVars "OKTA_DOMAIN" }}{{- end }}{{- end }}
{{- with $identity.twitter }}{{- if .clientId }}{{- $identityEnvVars = append $identityEnvVars "TWITTER_OAUTH_CLIENT_ID" }}{{- end }}{{- if .clientSecret }}{{- $identityEnvVars = append $identityEnvVars "TWITTER_OAUTH_CLIENT_SECRET" }}{{- end }}{{- end }}
{{- range $envName := $identityEnvVars }}
- name: {{ $envName }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $envName }}
      optional: true
{{- end }}
{{- /* llm.<provider> — structured LLM API keys (v0.100.3+) */}}
{{- $llmEnvVars := list }}
{{- if $llm.alephalpha }}{{- $llmEnvVars = append $llmEnvVars "ALEPHALPHA_API_KEY" }}{{- end }}
{{- if $llm.anthropic }}{{- $llmEnvVars = append $llmEnvVars "ANTHROPIC_API_KEY" }}{{- end }}
{{- if $llm.anyscale }}{{- $llmEnvVars = append $llmEnvVars "ANYSCALE_API_KEY" }}{{- end }}
{{- if $llm.cohere }}{{- $llmEnvVars = append $llmEnvVars "COHERE_API_KEY" }}{{- end }}
{{- if $llm.deepinfra }}{{- $llmEnvVars = append $llmEnvVars "DEEPINFRA_API_KEY" }}{{- end }}
{{- if $llm.gemini }}{{- $llmEnvVars = append $llmEnvVars "GEMINI_API_KEY" }}{{- end }}
{{- if $llm.groq }}{{- $llmEnvVars = append $llmEnvVars "GROQ_API_KEY" }}{{- end }}
{{- if $llm.minimax }}{{- $llmEnvVars = append $llmEnvVars "MINIMAX_API_KEY" }}{{- end }}
{{- if $llm.mistral }}{{- $llmEnvVars = append $llmEnvVars "MISTRAL_API_KEY" }}{{- end }}
{{- if $llm.openai }}{{- $llmEnvVars = append $llmEnvVars "OPENAI_API_KEY" }}{{- end }}
{{- if $llm.openrouter }}{{- $llmEnvVars = append $llmEnvVars "OPENROUTER_API_KEY" }}{{- end }}
{{- if $llm.perplexityai }}{{- $llmEnvVars = append $llmEnvVars "PERPLEXITYAI_API_KEY" }}{{- end }}
{{- if $llm.togetherai }}{{- $llmEnvVars = append $llmEnvVars "TOGETHERAI_API_KEY" }}{{- end }}
{{- range $envName := $llmEnvVars }}
- name: {{ $envName }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agenta.secretName" $ }}
      key: {{ $envName }}
      optional: true
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
{{/* ================================================================
   Combined wait-for init containers. Callers must check truthiness
   of the result before rendering `initContainers:`, since k8s rejects
   an empty list.
   ================================================================ */}}
{{- define "agenta.initContainers" -}}
{{- if eq (include "agenta.postgresql.enabled" .) "true" }}
{{- include "agenta.waitForPostgres" . }}
{{- end }}
{{- include "agenta.waitForRedis" . }}
{{- end }}

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
