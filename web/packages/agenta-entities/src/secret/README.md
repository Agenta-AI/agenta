# @agenta/entities/secret

Vault-backed secret storage for LLM provider keys, scoped per project and gated by user authentication.

This is a **reference implementation** of the entities/molecule pattern using its smallest viable shape — query + mutation only. Use it as the template when migrating other vault-like state into entity packages.

---

## Folder shape

```text
secret/
├── api/
│   ├── api.ts            # Fern-backed wrappers around the /secrets/ resource
│   └── index.ts
├── core/
│   ├── types.ts          # DTOs, enums, provider labels/kinds
│   ├── transforms.ts     # transformSecret, transformCustomProviderPayloadData, getEnvNameMap
│   └── index.ts
├── state/
│   ├── atoms.ts          # query/mutation atoms + migration atom + action atoms
│   ├── useVaultSecret.ts # React hook (preserved name and return shape from OSS)
│   └── index.ts
├── README.md             # this file
└── index.ts              # public surface
```

## Why no full molecule API

Other entity packages (`testcase`, `trace`, `workflow`) expose a full molecule with:

- `molecule.atoms.{data, draft, serverData, isDirty, isNew, ...}`
- `molecule.actions.{update, discard, save, ...}`
- `molecule.get.*` / `molecule.set.*` imperative API
- `molecule.useController(id)` returning `[state, dispatch]`

Secret deliberately does **not** expose any of that surface. Vault is:

- A **list-bearing query** (`["vault", "secrets", user?.id, projectId]`) plus three mutations (create/update/delete) — there is no entity-by-id concept.
- **Not revisioned.** No commit/history semantics; the wire DTO has no lineage.
- **Not draft-edited.** Each create/update is sent immediately as a mutation; there is no local draft layer to merge against the server snapshot.
- **Not addressable per-row.** Consumers always work with the full `LlmProvider[]` slice, never with `secretMolecule.atoms.data(id)`.

Bolting on `draft`, `isDirty`, `discard`, or `useController` here would produce dead methods. The molecule pattern is composable: use the slots your entity actually exercises, document the absent slots, move on.

## Where the canonical shapes live

| Concern | Canonical home | Re-exported by |
|---|---|---|
| `User` (auth identity) | `@agenta/shared/types/user` | `@/oss/lib/Types` |
| `LlmProvider` (form/UI shape) | `@agenta/shared/types/llmProvider` | — |
| `llmAvailableProviders`, `llmAvailableProvidersToken` | `@agenta/shared/utils/llmProviders` | — |
| `removeEmptyFromObjects` | `@agenta/shared/utils/objectUtils` | `@/oss/lib/helpers/utils` |
| `userAtom` (primitive, package-readable) | `@agenta/shared/state/user` | populated by OSS `UserListener` |
| `projectIdAtom` (primitive) | `@agenta/shared/state/project` | populated by OSS app-state wiring |
| `SecretDTO*`, enums, `PROVIDER_KINDS`, `PROVIDER_LABELS` | `@agenta/entities/secret/core/types` | `@/oss/lib/Types` (transitional re-export) |
| `transformSecret`, `transformCustomProviderPayloadData`, `getEnvNameMap` | `@agenta/entities/secret/core/transforms` | — |

## Invariants (preserve these on any future change)

1. **Query key identity.** `["vault", "secrets", user?.id, projectId]` — exact tuple. Adding/removing/reordering elements invalidates existing cache entries and risks cache double-up if any transitional shim exists.

2. **Migration atom idempotency.**
   - `migrateVaultKeysAtom` (the setter) early-returns if `migrating || migrated`. This guarantees that calling it from multiple subscribers does not double-fire the localStorage migration.
   - The hook's `useEffect` triggers `migrateKeys()` when `user && !migrating && !migrated` — fires exactly once after authentication.
   - On `!user` (logout), the hook resets the atom to `{migrating: false, migrated: false}` — re-arms migration for the next sign-in in the same session.
   - Success path: `{migrating: false, migrated: true}`. Failure path: rollback to `{migrating: false, migrated: false}`.

3. **`useVaultSecret` return shape.** Preserved verbatim from OSS so that consumer migration is import-path-only:

   ```ts
   {
     loading: boolean
     secrets: LlmProvider[]
     customRowSecrets: LlmProvider[]
     mutate: () => void
     handleModifyVaultSecret(provider): Promise<void>
     handleDeleteVaultSecret(provider): Promise<void>
     handleModifyCustomVaultSecret(provider): Promise<void>
   }
   ```

   Renaming the hook or restructuring the return turns 9 mechanical edits into 9 small rewrites — exactly the regression risk that big-bang migration trades against.

4. **Failure-prone step.** The localStorage-to-vault migration runs once with side effects (writes to server, writes to localStorage backup, removes the legacy key). On a fresh profile with seeded `localStorage[llmAvailableProvidersToken]`, validate that:
   - It fires exactly once.
   - It does not re-fire after logout/login in the same session.
   - On failure, the migration status rolls back so the next mount can retry.
   - `localStorage[llmAvailableProvidersTokenBackup]` is set after success.

## Usage

```typescript
import {useVaultSecret} from "@agenta/entities/secret"

function MyProviderConfig() {
    const {
        secrets,
        customRowSecrets,
        loading,
        handleModifyVaultSecret,
    } = useVaultSecret()

    if (loading) return <Skeleton />

    return (
        <ProviderList
            standard={secrets}
            custom={customRowSecrets}
            onSave={handleModifyVaultSecret}
        />
    )
}
```

For direct atom access (e.g. selecting a derived view without subscribing the whole hook):

```typescript
import {useAtomValue} from "jotai"
import {standardSecretsAtom, customSecretsAtom} from "@agenta/entities/secret"

const standard = useAtomValue(standardSecretsAtom)
const custom = useAtomValue(customSecretsAtom)
```

## Migration history

This module replaces the OSS vault stack:

- `web/oss/src/services/vault/api/index.ts` — moved to `secret/api/api.ts`
- `web/oss/src/state/app/atoms/vault.ts` — moved to `secret/state/atoms.ts`
- `web/oss/src/state/app/hooks/useVaultSecret.ts` — moved to `secret/state/useVaultSecret.ts`
- `web/oss/src/hooks/useVaultSecret.ts` — deleted (was a re-export shim)
- `web/oss/src/lib/helpers/llmProviders.ts` — split: types/constants to `@agenta/shared`, transforms to `secret/core/transforms.ts`

Design doc: see `~/.gstack/projects/Agenta-AI-agenta/ardaerzin-claude-cool-davinci-1f9b59-design-20260508-014901-vault-to-entities-secret.md` (Status: APPROVED).
