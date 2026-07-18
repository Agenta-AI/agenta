import {experimental_createQueryPersister} from "@tanstack/query-persist-client-core"
import type {PersistedQuery} from "@tanstack/query-persist-client-core"

import {idbQueryStorage} from "./idbStorage"
import {PERSIST_SCHEMA_VERSION} from "./version"

const identity = (value: PersistedQuery) => value

const CATALOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Class A — immutable-by-key bodies (e.g. workflow revisions): restore from disk and
 * never refetch. Pair with `staleTime: Infinity` on the query so later observer mounts
 * don't revalidate either. Invalidation happens only via PERSIST_SCHEMA_VERSION bumps.
 */
export const immutablePersister = experimental_createQueryPersister<PersistedQuery>({
    storage: idbQueryStorage,
    buster: PERSIST_SCHEMA_VERSION,
    maxAge: Number.POSITIVE_INFINITY,
    serialize: identity,
    deserialize: identity,
    refetchOnRestore: false,
    prefix: "agenta-imm",
})

/**
 * Class B — catalogs/schemas that change on backend deploys: paint-from-disk, then one
 * background revalidate when stale (refetchOnRestore default). Keep a finite staleTime
 * on the query; restored entries are older than it, so exactly one refetch fires.
 */
export const catalogPersister = experimental_createQueryPersister<PersistedQuery>({
    storage: idbQueryStorage,
    buster: PERSIST_SCHEMA_VERSION,
    maxAge: CATALOG_MAX_AGE_MS,
    serialize: identity,
    deserialize: identity,
    prefix: "agenta-cat",
})

export type QueryPersister = typeof immutablePersister
