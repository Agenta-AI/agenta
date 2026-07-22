/**
 * Buster for persisted query entries. Bump whenever the client-side shape of any
 * persisted payload changes (e.g. a Zod schema evolves) — entries with a stale
 * version are discarded on read and swept by GC.
 */
export const PERSIST_SCHEMA_VERSION = "v1"
