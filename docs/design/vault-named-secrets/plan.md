# Execution plan

Three phases: backend DTO + enum, DB migration, frontend. Backend and migration land
together. Frontend lands after the Fern client is regenerated.

## Phase 1 — Backend: new secret kind

### 1a. Add the enum member

`api/oss/src/core/secrets/enums.py`

```python
class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"
    CUSTOM_PROVIDER = "custom_provider"
    SSO_PROVIDER = "sso_provider"
    WEBHOOK_PROVIDER = "webhook_provider"
    CUSTOM_SECRET = "custom_secret"  # NEW: arbitrary name -> value
```

### 1b. Add the DTO and wire it into the union + validator

`api/oss/src/core/secrets/dtos.py` — mirror the webhook shape.

```python
class CustomSecretSettingsDTO(BaseModel):
    key: str  # the secret value; encrypted at rest by the data column

class CustomSecretDTO(BaseModel):
    secret: CustomSecretSettingsDTO
```

- Add `CustomSecretDTO` to `SecretDTO.data: Union[...]` (`dtos.py:70`). The members stay
  an untagged union; `{secret: {...}}` is distinct from the provider shapes
  (`{provider: {...}}` / `{kind, provider}`), so resolution is unambiguous.
- Add a branch to `validate_secret_data_based_on_kind` (`dtos.py:147`, before the final
  `else`):

```python
elif kind == SecretKind.CUSTOM_SECRET.value:
    if not isinstance(data, dict):
        raise ValueError("Invalid data for CustomSecretDTO")
    secret = data.get("secret")
    if not isinstance(secret, dict) or "key" not in secret:
        raise ValueError("CustomSecretDTO requires data.secret.key")
```

No changes to `CreateSecretDTO`, `UpdateSecretDTO`, `SecretResponseDTO`, mappings, DAO,
service, or router. They are all kind-agnostic.

### 1c. Format + lint

From `api/`: `ruff format` then `ruff check --fix`. Fix all errors.

## Phase 2 — DB migration (both trees)

Add one Alembic revision to **both** `api/oss/databases/postgres/migrations/core/versions/`
and `api/ee/databases/postgres/migrations/core/versions/`, chained from the current head
(`b3c4d5e6f7a9` at planning time — re-confirm first).

```python
def upgrade() -> None:
    op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CUSTOM_SECRET'")

def downgrade() -> None:
    # PG cannot drop an enum value; no-op (matches the webhook/SSO migrations).
    pass
```

Use the uppercase member NAME `CUSTOM_SECRET`, exactly like
`f0a1b2c3d4e5_add_webhooks.py:24`. Give the OSS and EE copies the same `revision` id so the
two trees stay in lockstep.

## Phase 3 — Regenerate the Fern client

After Phase 1 merges (OpenAPI now includes `custom_secret` + `CustomSecretDto`):

```
bash ./clients/scripts/generate.sh --language typescript
pnpm install   # rebuilds @agentaai/api-client dist/ so consumers see the new types
```

Confirm `SecretKind.CustomSecret` and a `CustomSecretDto` alias are available from
`@agentaai/api-client`.

## Phase 4 — Frontend: data layer + UI

### 4a. Types — `web/packages/agenta-entities/src/secret/core/types.ts`

Add an alias next to the others: `export type CustomSecretDto = AgentaApi.CustomSecretDto`.

### 4b. Transforms — `web/packages/agenta-entities/src/secret/core/transforms.ts`

Add a branch in `transformSecret` (after the `CustomProvider` branch):

```ts
} else if (secret.kind === SecretKind.CustomSecret) {
    const data = secret.data as CustomSecretDto
    acc.push({
        name: secret.header.name ?? "",
        key: data.secret.key,
        id: secret.id ?? undefined,
        type: secret.kind,
        created_at: secret.lifecycle?.created_at ?? undefined,
    })
}
```

Add a payload builder:

```ts
export const transformCustomSecretPayloadData = (values: LlmProvider): CreateSecretDto => ({
    header: {name: values.name, description: values.name},
    secret: {
        kind: SecretKind.CustomSecret,
        data: {secret: {key: values.key ?? ""}},
    },
})
```

### 4c. Atoms — `web/packages/agenta-entities/src/secret/state/atoms.ts`

- `customNamedSecretsAtom`: filter `vaultSecretsQueryAtom.data` by
  `secret.type === SecretKind.CustomSecret` (clone `customSecretsAtom` `:130`).
- `createCustomNamedSecretAtom`: clone `createCustomSecretAtom` (`:229`) but build the
  payload with `transformCustomSecretPayloadData` and match existing rows by `id`
  (create vs update via `updateMutation` / `createMutation`).
- Reuse `deleteSecretAtom` for delete.

### 4d. Hook — `web/packages/agenta-entities/src/secret/state/useVaultSecret.ts`

Expose `namedSecrets: customNamedSecretsAtom` and
`handleModifyNamedSecret(provider)` (calls the new action atom then `vaultQuery.refetch()`,
exactly like `handleModifyCustomVaultSecret` `:81`). Reuse `handleDeleteVaultSecret`.

### 4e. UI — new table + modal under `web/oss/src/components/pages/settings/Secrets/`

Do not overload `SecretProviderTable` (provider-specific). Add:

- `NamedSecretTable/index.tsx`: an antd `Table` with columns Name, Value (masked, reuse the
  `key.slice(0,3) + "..." + key.slice(-3)` masking from `SecretProviderTable` `:54`),
  Created at, and edit/delete actions. A "Create" button opens the modal. Reads
  `namedSecrets` + `loading` from `useVaultSecret`.
- `ConfigureSecretModal/index.tsx`: `EnhancedModal` (from `@agenta/ui`, per frontend
  conventions) with two `LabelInput`s — Name (text) and Value (password). On submit calls
  `handleModifyNamedSecret({name, key, id})`. Reuse `DeleteProviderModal` for delete (it is
  already generic over `LlmProvider.id`).

Mount it in `Secrets.tsx`:

```tsx
<SecretProviderTable type="standard" />
<SecretProviderTable type="custom" />
<NamedSecretTable />
```

### 4f. Lint

From `web/`: `pnpm lint-fix`.

## Out of scope (explicit)

No edits to `services/oss/src/agent/secrets.py`, `SessionConfig.secrets`, the wire
protocol, or `get_user_llm_providers_secrets`. Runtime injection is a separate follow-up.
