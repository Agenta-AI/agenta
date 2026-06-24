/**
 * Trace-input display helpers — relocated to `@agenta/evaluations/state`.
 *
 * These pure helpers (no jotai / queue / session deps) now live in the generic
 * evaluations list-column tier. Re-exported here so existing consumers of
 * `@agenta/annotation`'s `getTraceInputDisplay*` keep resolving unchanged.
 */
export {getTraceInputDisplayKeys, getTraceInputDisplayValue} from "@agenta/evaluations/state"
