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

const RECORDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Class D-with-restore — live, append-only logs (session records): paint-from-disk, but disk
 * is NEVER authoritative. `refetchOnRestore: "always"` fires `query.fetch()` from the persister's
 * post-restore task even with zero observers, so both the observer path and bare
 * `fetchQuery` restores get exactly one revalidation (a stale-only policy would skip a
 * sub-staleTime restore). Shorter maxAge than catalogs: entries are big (~200KB+/session) and a
 * week-untouched session's log is cheap to refetch once.
 */
export const recordsPersister = experimental_createQueryPersister<PersistedQuery>({
    storage: idbQueryStorage,
    buster: PERSIST_SCHEMA_VERSION,
    maxAge: RECORDS_MAX_AGE_MS,
    serialize: identity,
    deserialize: identity,
    refetchOnRestore: "always",
    prefix: "agenta-rec",
})

export type QueryPersister = typeof immutablePersister
