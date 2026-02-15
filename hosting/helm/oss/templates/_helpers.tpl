{{/*
Expand the name of the chart.
*/}}
{{- define "agenta-oss.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agenta-oss.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "agenta-oss.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agenta-oss.labels" -}}
helm.sh/chart: {{ include "agenta-oss.chart" . }}
{{ include "agenta-oss.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agenta-oss.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agenta-oss.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component selector labels
*/}}
{{- define "agenta-oss.componentSelectorLabels" -}}
app.kubernetes.io/name: {{ include "agenta-oss.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "agenta-oss.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agenta-oss.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL connection strings
*/}}
{{- define "agenta-oss.postgres.core" -}}
{{- if .Values.postgresql.enabled -}}
postgresql+asyncpg://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ include "agenta-oss.fullname" . }}-postgresql:5432/{{ .Values.postgresql.auth.database }}
{{- else -}}
{{ .Values.externalPostgresql.coreUri }}
{{- end -}}
{{- end }}

{{- define "agenta-oss.postgres.tracing" -}}
{{- if .Values.postgresql.enabled -}}
postgresql+asyncpg://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ include "agenta-oss.fullname" . }}-postgresql:5432/agenta_oss_tracing
{{- else -}}
{{ .Values.externalPostgresql.tracingUri }}
{{- end -}}
{{- end }}

{{- define "agenta-oss.postgres.supertokens" -}}
{{- if .Values.postgresql.enabled -}}
postgresql://{{ .Values.postgresql.auth.username }}:{{ .Values.postgresql.auth.password }}@{{ include "agenta-oss.fullname" . }}-postgresql:5432/agenta_oss_supertokens
{{- else -}}
{{ .Values.externalPostgresql.supertokensUri }}
{{- end -}}
{{- end }}

{{/*
Redis URL
*/}}
{{- define "agenta-oss.redis.url" -}}
{{- if .Values.redis.enabled }}
redis://{{ include "agenta-oss.fullname" . }}-redis-master:6379/0
{{- else }}
{{ .Values.externalRedis.url }}
{{- end }}
{{- end }}

{{/*
RabbitMQ URL
*/}}
{{- define "agenta-oss.rabbitmq.url" -}}
{{- if .Values.rabbitmq.enabled }}
amqp://{{ .Values.rabbitmq.auth.username }}@{{ include "agenta-oss.fullname" . }}-rabbitmq://
{{- else }}
{{ .Values.externalRabbitmq.url }}
{{- end }}
{{- end }}

