# Managed secrets

Managed secrets are vault rows provisioned and owned by a platform component. Their
management policy is separate from whether their value is write-only.

The internal contract stores a structured `management` object in the encrypted vault
JSON:

```json
{
  "management": {
    "manager": "starter-credits-bridge",
    "policy": "manager_only"
  }
}
```

This requires no database migration. There is deliberately no compatibility fallback for
the former flat `managed_by` experiment.

Public create and update payloads do not accept management fields. Trusted components use
`VaultService.create_managed_secret` and provide `SecretManagementDTO` separately. Public
responses expose only `management.policy`; the manager identity remains internal.

`manager_only` means public update and delete operations are rejected after the DAO locks
the current row. There is no owner bypass in the general vault service. A future manager
workflow that needs reconciliation should use a dedicated manager-specific operation.

Management and value visibility are independent. A managed secret may explicitly be
readable when its product flow requires that behavior, while write-only managed secrets
continue to use the normal runtime grant and redaction rules.
