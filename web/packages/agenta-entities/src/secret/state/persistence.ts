/**
 * Vault Secrets — persistence (Class C: persist REDACTED + ALWAYS revalidate)
 *
 * `listSecrets` returns PLAINTEXT secret values (provider API keys, AWS
 * credentials, vertex service-account JSON, named-secret content). Those must
 * never reach IndexedDB, so this persister serializes a redacted projection:
 * every secret-value field is replaced with a truthy sentinel, metadata
 * (names, ids, kinds, models, timestamps) is kept verbatim.
 *
 * The sentinel keeps presence semantics (`!!secret.key`) intact so consumers
 * like the agent playground's model-key badges paint correctly from disk.
 * Because restored rows carry sentinels instead of real values,
 * `refetchOnRestore: "always"` is mandatory — exactly one background refetch
 * fires on restore regardless of age, replacing sentinels with live data.
 */

import {idbQueryStorage, PERSIST_SCHEMA_VERSION} from "@agenta/shared/api/persist"
import type {LlmProvider} from "@agenta/shared/types"
import {experimental_createQueryPersister} from "@tanstack/query-persist-client-core"
import type {PersistedQuery} from "@tanstack/query-persist-client-core"

import type {NamedSecretRow} from "../core/types"

/** Truthy, obviously-not-a-key sentinel written to disk in place of secret values. */
export const VAULT_PERSIST_REDACTED = "[redacted]"

const VAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/** Every `LlmProvider` field that can carry actual secret material. */
const SECRET_VALUE_FIELDS = [
    "key",
    "apiKey",
    "accessKeyId",
    "accessKey",
    "sessionToken",
    "bearerToken",
    "vertexCredentials",
] as const

/** Redact one vault row: sentinel for non-empty secret values, metadata kept. */
export const redactVaultSecretRow = (row: LlmProvider): LlmProvider => {
    const next: LlmProvider = {...row}
    for (const field of SECRET_VALUE_FIELDS) {
        if (next[field]) next[field] = VAULT_PERSIST_REDACTED
    }

    const named = next as NamedSecretRow
    if (named.content !== undefined) {
        if (typeof named.content === "string") {
            named.content = named.content ? VAULT_PERSIST_REDACTED : ""
        } else {
            // Keep keys (env-var-style names, comparable to routinely cached config); redact values.
            named.content = Object.fromEntries(
                Object.keys(named.content).map((key) => [key, VAULT_PERSIST_REDACTED]),
            )
        }
    }

    return next
}

/** Serialize hook: redact `state.data` without mutating the live query state. */
export const redactPersistedVaultQuery = (persisted: PersistedQuery): PersistedQuery => {
    const data = persisted.state.data
    if (!Array.isArray(data)) return persisted

    return {
        ...persisted,
        state: {
            ...persisted.state,
            data: (data as LlmProvider[]).map(redactVaultSecretRow),
        },
    }
}

const identity = (value: PersistedQuery) => value

/**
 * Dedicated vault persister. Differs from `catalogPersister` in two ways:
 * `serialize` strips secret values, and `refetchOnRestore: "always"` forces
 * one revalidation per restore even when the entry is younger than staleTime.
 */
export const vaultSecretsPersister = experimental_createQueryPersister<PersistedQuery>({
    storage: idbQueryStorage,
    buster: PERSIST_SCHEMA_VERSION,
    maxAge: VAULT_MAX_AGE_MS,
    serialize: redactPersistedVaultQuery,
    deserialize: identity,
    refetchOnRestore: "always",
    prefix: "agenta-vault",
})
