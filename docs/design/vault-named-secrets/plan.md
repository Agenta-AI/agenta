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

`api/oss/src/core/secrets/dtos.py`. The value is `text` (a string) or `json` (a flat object
of primitives), discriminated by a `format` field inside the secret.

```python
class CustomSecretFormat(str, Enum):
    TEXT = "text"
    JSON = "json"

class CustomSecretSettingsDTO(BaseModel):
    format: CustomSecretFormat
    value: Union[str, Dict[str, Union[str, int, float, bool, None]]]
    # text -> value is a str; json -> value is a flat {str: primitive} map.
    # Encrypted at rest by the data column regardless of format.

class CustomSecretDTO(BaseModel):
    secret: CustomSecretSettingsDTO
```

- Add `CustomSecretDTO` to `SecretDTO.data: Union[...]` (`dtos.py:70`). The members stay
  an untagged union; `{secret: {...}}` is distinct from the provider shapes
  (`{provider: {...}}` / `{kind, provider}`), so resolution is unambiguous.
- Add a branch to `validate_secret_data_based_on_kind` (`dtos.py:147`, before the final
  `else`). The format is what makes validation strict — this is the whole point of the
  feature, so do **not** loosen it:

```python
elif kind == SecretKind.CUSTOM_SECRET.value:
    if not isinstance(data, dict):
        raise ValueError("Invalid data for CustomSecretDTO")
    secret = data.get("secret")
    if not isinstance(secret, dict) or "format" not in secret or "value" not in secret:
        raise ValueError("CustomSecretDTO requires data.secret.{format, value}")
    fmt, value = secret["format"], secret["value"]
    if fmt == "text":
        if not isinstance(value, str):
            raise ValueError("text custom_secret requires a string value")
        # Do NOT re-serialize a JSON-looking string; text is stored verbatim.
    elif fmt == "json":
        if not isinstance(value, dict):
            raise ValueError("json custom_secret requires an object value")
        for k, v in value.items():
            if isinstance(v, (dict, list)):
                raise ValueError(
                    "json custom_secret must be flat: values cannot be objects or arrays"
                )
    else:
        raise ValueError("custom_secret format must be 'text' or 'json'")
```

No changes to `CreateSecretDTO`, `UpdateSecretDTO`, `SecretResponseDTO`, mappings, DAO,
service, or router. They are all kind-agnostic.

### 1c. Format + lint

From `api/`: `ruff format` then `ruff check --fix`. Fix all errors.

## Phase 2 — DB migration (shared `core_oss` chain, NOT duplicated)

**Corrected at implementation time.** The earlier "add to both `core/versions` trees with
the same id" guidance was the pre-convergence layout. The `core` chain is now **parked** at
`park00000000` (the alignment point); new core migrations live in the post-alignment
**`core_oss`** chain (version table `alembic_version_oss`), which **EE ships and runs from
the OSS tree** — one copy, no EE duplicate. `secretkind_enum` is a shared/OSS object, so it
belongs here. See `docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`.

Implemented as a single revision
`api/oss/databases/postgres/migrations/core_oss/versions/oss000000005_add_custom_secret_kind.py`,
chained from the real `core_oss` head `oss000000004`:

```python
def upgrade() -> None:
    op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'CUSTOM_SECRET'")

def downgrade() -> None:
    # PG cannot drop an enum value; no-op (matches the webhook/SSO migrations).
    pass
```

Use the uppercase member NAME `CUSTOM_SECRET`, exactly like
`f0a1b2c3d4e5_add_webhooks.py:24`. No EE copy: the EE image runs this same `core_oss`
revision. The parked legacy chain still creates `secretkind_enum` first, so the type exists
before `core_oss` runs (fresh-OSS and OSS→EE-switch flows both covered by CI replay).

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

Add a branch in `transformSecret` (after the `CustomProvider` branch). Carry `format`
through into the row so the table/modal can pick the right editor:

```ts
} else if (secret.kind === SecretKind.CustomSecret) {
    const data = secret.data as CustomSecretDto
    acc.push({
        name: secret.header.name ?? "",
        format: data.secret.format,            // "text" | "json"
        value: data.secret.value,              // string | flat object
        id: secret.id ?? undefined,
        type: secret.kind,
        created_at: secret.lifecycle?.created_at ?? undefined,
    })
}
```

Add a payload builder. It just forwards the format + value the modal produced; the backend
validator (1b) is the source of truth for shape, so do not re-validate here:

```ts
export const transformCustomSecretPayloadData = (values: NamedSecretRow): CreateSecretDto => ({
    header: {name: values.name, description: values.name},
    secret: {
        kind: SecretKind.CustomSecret,
        data: {secret: {format: values.format, value: values.value}},
    },
})
```

`NamedSecretRow` extends the `LlmProvider` row with `format` and a `value` that is either a
string or a flat object — the existing `LlmProvider.key` (a plain string) is too narrow.

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

### 4e. UI — its own Vault section, not under Providers & Models

This does **not** belong under "Providers & Models" (LLM-scoped, and also holds internal
webhook/SSO secrets users never touch). Give named secrets their own **Vault** Settings
section. Add a `Vault/` page next to `Secrets/` under
`web/oss/src/components/pages/settings/` and register it as its own Settings tab.

Do not overload `SecretProviderTable` (provider-specific). Add under `Vault/`:

- `NamedSecretTable/index.tsx`: an antd `Table` with columns Name, Format (a `text`/`json`
  tag), Value (masked — reuse the `slice(0,3) + "..." + slice(-3)` masking from
  `SecretProviderTable` `:54`; for `json` mask a compact preview), Created at, and
  edit/delete actions. A "Create" button opens the modal. Reads `namedSecrets` + `loading`
  from `useVaultSecret`.
- `ConfigureSecretModal/index.tsx`: `EnhancedModal` (from `@agenta/ui`) with:
  - **Name** — text input.
  - **Format** — a `text` / `json` `Segmented` control.
  - **Value** — editor switches on format. `text`: a textarea. `json`: a **typed**
    key/value grid **or** a raw JSON editor, toggled by a Grid/JSON `Segmented`:
    - The grid models each row as `{key, value}` where `value` is the **native** JSON
      primitive (`string | number | boolean | null`), not a string. Each row has a type
      selector (rendered as a `TypeChip` badge from `@agenta/ui/type-chip`); picking a type
      re-coerces the value (`coerceToType`). Inferred via `inferLogicalType`
      (`@agenta/shared/utils`). This mirrors the playground's variable management so a
      number round-trips as a number, never `"2"`. Helpers live in
      `ConfigureSecretModal/assets/primitives.ts`.
    - The JSON editor is `SharedEditor` (`@agenta/ui/shared-editor`,
      `editorProps={codeOnly, language:"json"}`). Switching Grid→JSON serializes the native
      object; JSON→Grid parses and enforces the flat-primitive shape (`isFlatPrimitiveObject`
      rejects nesting/arrays client-side; the backend validator is the real gate).
    - Switching **format** (text↔json) does not silently coerce — warn instead.

  On submit calls `handleModifyNamedSecret({name, format, value, id})`. Reuse
  `DeleteProviderModal` for delete (generic over `id`).

Register the Vault tab in the Settings layout (wherever the "Providers & Models" tab is
declared) so it shows as a sibling section.

### 4f. Lint

From `web/`: `pnpm lint-fix`.

## Out of scope (explicit)

No edits to `services/oss/src/agent/secrets.py`, `SessionConfig.secrets`, the wire
protocol, or `get_user_llm_providers_secrets`. Runtime injection is a separate follow-up.
