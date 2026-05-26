{{/*
================================================================
Backward-compatibility layer for pre-v0.100.3 values.yaml shapes.

v0.100.3 reshaped the chart's values keys (see
docs/docs/self-host/upgrades/v0.100.3-migration.mdx). To let
operators upgrade without rewriting their values file first, this
helper accepts the legacy paths and folds them into the canonical
v0.100.3 positions. The rest of the chart only ever reads the
canonical shape via `agenta.values` (defined in _helpers.tpl),
which delegates to this `agenta.deprecated` helper.

The helper is idempotent: passing a pure-v0.100.3 values dict
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
  1. Delete this file (`templates/_compatibility.tpl`).
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
     the source of truth for that key".

     Use `hasKey` (not truthy `if`) so an intentional `false`, `0`, or
     `""` from a legacy file isn't silently dropped. */}}

{{/* ---- agenta.* (license, URLs, secrets) ---- */}}
{{- $agenta := default dict $v.agenta -}}
{{- if hasKey $legacyGlobal "agentaLicense" -}}
  {{- $_ := set $agenta "license" $legacyGlobal.agentaLicense -}}
{{- end -}}
{{- if hasKey $legacyGlobal "webUrl" -}}
  {{- $_ := set $agenta "webUrl" $legacyGlobal.webUrl -}}
{{- end -}}
{{- if hasKey $legacyGlobal "apiUrl" -}}
  {{- $_ := set $agenta "apiUrl" $legacyGlobal.apiUrl -}}
{{- end -}}
{{- if hasKey $legacyGlobal "servicesUrl" -}}
  {{- $_ := set $agenta "servicesUrl" $legacyGlobal.servicesUrl -}}
{{- end -}}
{{- if hasKey $legacySecrets "agentaAuthKey" -}}
  {{- $_ := set $agenta "authKey" $legacySecrets.agentaAuthKey -}}
{{- end -}}
{{- if hasKey $legacySecrets "agentaCryptKey" -}}
  {{- $_ := set $agenta "cryptKey" $legacySecrets.agentaCryptKey -}}
{{- end -}}

{{/* ---- agenta.access.* ---- */}}
{{- $access := default dict $agenta.access -}}
{{- range $k := list "allowedDomains" "blockedDomains" "blockedEmails" "plans" "roles" "rolesOverlay" "defaultPlan" "defaultPlanOverlay" "emailDisabled" -}}
  {{- if hasKey $legacyAccess $k -}}
    {{- $_ := set $access $k (index $legacyAccess $k) -}}
  {{- end -}}
{{- end -}}
{{- /* legacy: orgCreationAllowlist -> allowedOwnerEmails */ -}}
{{- if hasKey $legacyAccess "orgCreationAllowlist" -}}
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
{{- if hasKey $legacyGlobal "posthogApiKey" -}}
  {{- $_ := set $posthog "apiKey" $legacyGlobal.posthogApiKey -}}
  {{- $_ := set $v "posthog" $posthog -}}
{{- end -}}

{{/* ---- postgres.password from secrets.postgresPassword ---- */}}
{{- $postgres := default dict $v.postgres -}}
{{- if hasKey $legacySecrets "postgresPassword" -}}
  {{- $_ := set $postgres "password" $legacySecrets.postgresPassword -}}
  {{- $_ := set $v "postgres" $postgres -}}
{{- end -}}

{{/* ---- supertokens.apiKey from secrets.supertokensApiKey ---- */}}
{{- $supertokens := default dict $v.supertokens -}}
{{- if hasKey $legacySecrets "supertokensApiKey" -}}
  {{- $_ := set $supertokens "apiKey" $legacySecrets.supertokensApiKey -}}
  {{- $_ := set $v "supertokens" $supertokens -}}
{{- end -}}

{{/* ---- sendgrid.* from email.sendgrid.* ---- */}}
{{- $sendgrid := default dict $v.sendgrid -}}
{{- if hasKey $legacyEmail "apiKey" -}}
  {{- $_ := set $sendgrid "apiKey" $legacyEmail.apiKey -}}
{{- end -}}
{{- if hasKey $legacyEmail "fromAddress" -}}
  {{- $_ := set $sendgrid "fromAddress" $legacyEmail.fromAddress -}}
{{- end -}}
{{- if $sendgrid -}}
  {{- $_ := set $v "sendgrid" $sendgrid -}}
{{- end -}}

{{/* ---- composio.* from integrations.composio.* ---- */}}
{{- $composio := default dict $v.composio -}}
{{- if hasKey $legacyComposio "apiKey" -}}
  {{- $_ := set $composio "apiKey" $legacyComposio.apiKey -}}
{{- end -}}
{{- if hasKey $legacyComposio "apiUrl" -}}
  {{- $_ := set $composio "apiUrl" $legacyComposio.apiUrl -}}
{{- end -}}
{{- if $composio -}}
  {{- $_ := set $v "composio" $composio -}}
{{- end -}}

{{/* ---- newrelic.licenseKey from observability.newRelic.licenseKey ---- */}}
{{- $newrelic := default dict $v.newrelic -}}
{{- if hasKey $legacyNewRelic "licenseKey" -}}
  {{- $_ := set $newrelic "licenseKey" $legacyNewRelic.licenseKey -}}
  {{- $_ := set $v "newrelic" $newrelic -}}
{{- end -}}

{{/* ---- cloudflare.turnstile.* from captcha.turnstile.* ---- */}}
{{- $cloudflare := default dict $v.cloudflare -}}
{{- $turnstile := default dict $cloudflare.turnstile -}}
{{- if hasKey $legacyTurnstile "siteKey" -}}
  {{- $_ := set $turnstile "siteKey" $legacyTurnstile.siteKey -}}
{{- end -}}
{{- if hasKey $legacyTurnstile "secretKey" -}}
  {{- $_ := set $turnstile "secretKey" $legacyTurnstile.secretKey -}}
{{- end -}}
{{- if $turnstile -}}
  {{- $_ := set $cloudflare "turnstile" $turnstile -}}
  {{- $_ := set $v "cloudflare" $cloudflare -}}
{{- end -}}

{{- $v | toYaml -}}
{{- end -}}
