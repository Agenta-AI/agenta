{{/*
================================================================
Backward-compatibility layer for pre-v0.100.2 values.yaml shapes.

v0.100.2 reshaped the chart's values keys (see
docs/docs/self-host/upgrades/v0.100.2-migration.mdx). To let
operators upgrade without rewriting their values file first, this
helper accepts the legacy paths and folds them into the canonical
v0.100.2 positions. The rest of the chart only ever reads the
canonical shape via `agenta.values` (defined in _helpers.tpl),
which delegates to this `agenta.deprecated` helper.

The helper is idempotent: passing a pure-v0.100.2 values dict
returns it unchanged.

Renames handled here:
  global.agentaLicense     -> agenta.license
  global.webUrl            -> agenta.webUrl
  global.apiUrl            -> agenta.apiUrl
  global.servicesUrl       -> agenta.servicesUrl
  global.posthogApiKey     -> posthog.apiKey
  secrets.agentaAuthKey    -> agenta.authKey
  secrets.agentaCryptKey   -> agenta.cryptKey
  secrets.postgresPassword -> postgres.password
  secrets.supertokensApiKey-> supertokens.apiKey
  accessControl.<key>      -> agenta.access.<key>  (orgCreationAllowlist -> allowedOwnerEmails)
  email.sendgrid.*         -> sendgrid.*
  integrations.composio.*  -> composio.*
  observability.newRelic.* -> newrelic.*
  captcha.turnstile.*      -> cloudflare.turnstile.*

NOT translated (already accepted as-is by the new chart):
  global.imagePullSecrets  (Bitnami subchart convention; stays under global)
  global.postgresql.*      (Bitnami subchart wiring; stays under global)
  secrets.existingSecret   (Helm-only escape hatch; unchanged)
  secrets.oauth            (flat map; templates still read this)
  secrets.llmProviders     (flat map; templates still read this)

Removing this layer in a future release:
  1. Delete this file (`templates/_compat.tpl`).
  2. In _helpers.tpl, change the `agenta.values` body to
     `{{- .Values | toYaml -}}` (one line). All consumers stay
     unchanged because they call `include "agenta.values" .`.
================================================================ */}}
{{- define "agenta.deprecated" -}}
{{- $v := deepCopy .Values -}}
{{- $legacyGlobal := default dict $v.global -}}
{{- $legacySecrets := default dict $v.secrets -}}
{{- $legacyAccess := default dict $v.accessControl -}}
{{- $legacyEmail := default dict (default dict $v.email).sendgrid -}}
{{- $legacyComposio := default dict (default dict $v.integrations).composio -}}
{{- $legacyNewRelic := default dict (default dict $v.observability).newRelic -}}
{{- $legacyTurnstile := default dict (default dict $v.captcha).turnstile -}}

{{/* Legacy keys, when explicitly set by the user, win over canonical
     defaults shipped in values.yaml. We can't tell apart "user set
     `agenta.license: oss`" from "user kept the chart default `oss`",
     so anyone passing a legacy key signals "treat my legacy file as
     the source of truth for that key". */}}

{{/* ---- agenta.* (license, URLs, secrets) ---- */}}
{{- $agenta := default dict $v.agenta -}}
{{- if $legacyGlobal.agentaLicense -}}
  {{- $_ := set $agenta "license" $legacyGlobal.agentaLicense -}}
{{- end -}}
{{- if $legacyGlobal.webUrl -}}
  {{- $_ := set $agenta "webUrl" $legacyGlobal.webUrl -}}
{{- end -}}
{{- if $legacyGlobal.apiUrl -}}
  {{- $_ := set $agenta "apiUrl" $legacyGlobal.apiUrl -}}
{{- end -}}
{{- if $legacyGlobal.servicesUrl -}}
  {{- $_ := set $agenta "servicesUrl" $legacyGlobal.servicesUrl -}}
{{- end -}}
{{- if $legacySecrets.agentaAuthKey -}}
  {{- $_ := set $agenta "authKey" $legacySecrets.agentaAuthKey -}}
{{- end -}}
{{- if $legacySecrets.agentaCryptKey -}}
  {{- $_ := set $agenta "cryptKey" $legacySecrets.agentaCryptKey -}}
{{- end -}}

{{/* ---- agenta.access.* ---- */}}
{{- $access := default dict $agenta.access -}}
{{- range $k := list "allowedDomains" "blockedDomains" "blockedEmails" "plans" "roles" "rolesOverlay" "defaultPlan" "defaultPlanOverlay" "emailDisabled" -}}
  {{- $legacyVal := index $legacyAccess $k -}}
  {{- if $legacyVal -}}
    {{- $_ := set $access $k $legacyVal -}}
  {{- end -}}
{{- end -}}
{{- /* legacy: orgCreationAllowlist -> allowedOwnerEmails */ -}}
{{- if $legacyAccess.orgCreationAllowlist -}}
  {{- $_ := set $access "allowedOwnerEmails" $legacyAccess.orgCreationAllowlist -}}
{{- end -}}
{{- if $access -}}
  {{- $_ := set $agenta "access" $access -}}
{{- end -}}

{{- if $agenta -}}
  {{- $_ := set $v "agenta" $agenta -}}
{{- end -}}

{{/* ---- posthog.apiKey from global.posthogApiKey ---- */}}
{{- $posthog := default dict $v.posthog -}}
{{- if $legacyGlobal.posthogApiKey -}}
  {{- $_ := set $posthog "apiKey" $legacyGlobal.posthogApiKey -}}
  {{- $_ := set $v "posthog" $posthog -}}
{{- end -}}

{{/* ---- postgres.password from secrets.postgresPassword ---- */}}
{{- $postgres := default dict $v.postgres -}}
{{- if $legacySecrets.postgresPassword -}}
  {{- $_ := set $postgres "password" $legacySecrets.postgresPassword -}}
  {{- $_ := set $v "postgres" $postgres -}}
{{- end -}}

{{/* ---- supertokens.apiKey from secrets.supertokensApiKey ---- */}}
{{- $supertokens := default dict $v.supertokens -}}
{{- if $legacySecrets.supertokensApiKey -}}
  {{- $_ := set $supertokens "apiKey" $legacySecrets.supertokensApiKey -}}
  {{- $_ := set $v "supertokens" $supertokens -}}
{{- end -}}

{{/* ---- sendgrid.* from email.sendgrid.* ---- */}}
{{- $sendgrid := default dict $v.sendgrid -}}
{{- if $legacyEmail.apiKey -}}
  {{- $_ := set $sendgrid "apiKey" $legacyEmail.apiKey -}}
{{- end -}}
{{- if $legacyEmail.fromAddress -}}
  {{- $_ := set $sendgrid "fromAddress" $legacyEmail.fromAddress -}}
{{- end -}}
{{- if $sendgrid -}}
  {{- $_ := set $v "sendgrid" $sendgrid -}}
{{- end -}}

{{/* ---- composio.* from integrations.composio.* ---- */}}
{{- $composio := default dict $v.composio -}}
{{- if $legacyComposio.apiKey -}}
  {{- $_ := set $composio "apiKey" $legacyComposio.apiKey -}}
{{- end -}}
{{- if $legacyComposio.apiUrl -}}
  {{- $_ := set $composio "apiUrl" $legacyComposio.apiUrl -}}
{{- end -}}
{{- if $composio -}}
  {{- $_ := set $v "composio" $composio -}}
{{- end -}}

{{/* ---- newrelic.licenseKey from observability.newRelic.licenseKey ---- */}}
{{- $newrelic := default dict $v.newrelic -}}
{{- if $legacyNewRelic.licenseKey -}}
  {{- $_ := set $newrelic "licenseKey" $legacyNewRelic.licenseKey -}}
  {{- $_ := set $v "newrelic" $newrelic -}}
{{- end -}}

{{/* ---- cloudflare.turnstile.* from captcha.turnstile.* ---- */}}
{{- $cloudflare := default dict $v.cloudflare -}}
{{- $turnstile := default dict $cloudflare.turnstile -}}
{{- if $legacyTurnstile.siteKey -}}
  {{- $_ := set $turnstile "siteKey" $legacyTurnstile.siteKey -}}
{{- end -}}
{{- if $legacyTurnstile.secretKey -}}
  {{- $_ := set $turnstile "secretKey" $legacyTurnstile.secretKey -}}
{{- end -}}
{{- if $turnstile -}}
  {{- $_ := set $cloudflare "turnstile" $turnstile -}}
  {{- $_ := set $v "cloudflare" $cloudflare -}}
{{- end -}}

{{- $v | toYaml -}}
{{- end -}}
