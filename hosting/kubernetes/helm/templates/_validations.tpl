{{/* ================================================================
   Validate pgauth secret configuration.
   When a user provides secrets.existingSecret AND the bundled
   PostgreSQL is enabled, Bitnami must be pointed at the user's
   secret (since the chart-managed pgauth secret is not created).
   We detect the chart default by checking whether the value still
   contains ".Release.Name" (the tpl expression from values.yaml).
   ================================================================ */}}
{{- define "agenta.validatePgauthSecret" -}}
{{- $secrets := default dict .Values.secrets -}}
{{- $global := default dict .Values.global -}}
{{- $pg := default dict $global.postgresql -}}
{{- $auth := default dict $pg.auth -}}
{{- $existing := default "" $auth.existingSecret -}}
{{- if and (eq (include "agenta.postgresql.enabled" .) "true") $secrets.existingSecret (contains ".Release.Name" $existing) }}
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
