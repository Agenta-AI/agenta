{{/* ================================================================
   Validate pgauth secret configuration.
   When a user provides secrets.existingSecret AND the bundled
   PostgreSQL is enabled, Bitnami must be pointed at the user's
   secret (since the chart-managed pgauth secret is not created).
   Bitnami reads global.postgresql.auth.existingSecret as a plain
   string — it cannot evaluate Helm template expressions — so the
   user must explicitly override it.
   ================================================================ */}}
{{- define "agenta.validatePgauthSecret" -}}
{{- if and .Values.postgresql.enabled .Values.secrets.existingSecret (eq .Values.global.postgresql.auth.existingSecret "agenta-pgauth") }}
{{- fail `

CONFIGURATION ERROR: secrets.existingSecret is set but global.postgresql.auth.existingSecret
still has its default value ("agenta-pgauth").

When using a pre-created Secret with the bundled PostgreSQL, you must also tell the Bitnami
PostgreSQL subchart which Secret to read the password from. Set:

  global.postgresql.auth.existingSecret: "<your-secret-name>"

For example:

  helm install agenta ./agenta-oss \
    --set secrets.existingSecret=my-secret \
    --set global.postgresql.auth.existingSecret=my-secret

The Secret must contain a key named POSTGRES_PASSWORD.
` }}
{{- end }}
{{- end }}
