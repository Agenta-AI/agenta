import {experimental_createQueryPersister} from "@tanstack/query-persist-client-core"
import type {PersistedQuery} from "@tanstack/query-persist-client-core"

import {idbQueryStorage} from "./idbStorage"
import {PERSIST_SCHEMA_VERSION} from "./version"

const identity = (value: PersistedQuery) => value

const CATALOG_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

type Persister = ReturnType<typeof experimental_createQueryPersister<PersistedQuery>>
type PersistedQueryHandle = Parameters<Persister["persisterFn"]>[2]

/** The same query, except that the promise of its `fetch()` always has a handler. */
const withHandledFetch = (query: PersistedQueryHandle): PersistedQueryHandle =>
    new Proxy(query, {
        get(target, property) {
            if (property === "fetch") {
                return (...args: Parameters<PersistedQueryHandle["fetch"]>) => {
                    const pending = target.fetch(...args)
                    pending.catch(() => undefined)
                    return pending
                }
            }
            const value = Reflect.get(target, property, target)
            return typeof value === "function" ? value.bind(target) : value
        },
    })

/**
 * After a restore the persister starts `query.fetch()` and drops the promise, so a revalidation
 * that failed became an unhandled rejection: in development, the Next.js error overlay over the
 * chat (QA5W-6). The query still records the error for its observers and keeps the restored data;
 * only that dropped promise gets a handler.
 */
const handleRestoreRefetch = (persister: Persister): Persister => ({
    ...persister,
    persisterFn: (queryFn, context, query) =>
        persister.persisterFn(queryFn, context, withHandledFetch(query)),
})

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
export const catalogPersister = handleRestoreRefetch(
    experimental_createQueryPersister<PersistedQuery>({
        storage: idbQueryStorage,
        buster: PERSIST_SCHEMA_VERSION,
        maxAge: CATALOG_MAX_AGE_MS,
        serialize: identity,
        deserialize: identity,
        prefix: "agenta-cat",
    }),
)

const RECORDS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Class D-with-restore — live, append-only logs (session records): paint-from-disk, but disk
 * is NEVER authoritative. `refetchOnRestore: "always"` fires `query.fetch()` from the persister's
 * post-restore task even with zero observers, so both the observer path and bare
 * `fetchQuery` restores get exactly one revalidation (a stale-only policy would skip a
 * sub-staleTime restore). Shorter maxAge than catalogs: entries are big (~200KB+/session) and a
 * week-untouched session's log is cheap to refetch once.
 */
export const recordsPersister = handleRestoreRefetch(
    experimental_createQueryPersister<PersistedQuery>({
        storage: idbQueryStorage,
        buster: PERSIST_SCHEMA_VERSION,
        maxAge: RECORDS_MAX_AGE_MS,
        serialize: identity,
        deserialize: identity,
        refetchOnRestore: "always",
        prefix: "agenta-rec",
    }),
)

export type QueryPersister = typeof immutablePersister
