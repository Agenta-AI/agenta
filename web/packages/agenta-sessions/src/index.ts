/**
 * @agenta/sessions — headless orchestration for session lists.
 *
 * `@agenta/entities/session` owns the schema, the query options, and the wire types; this
 * package owns the DECISIONS a session surface makes: filter semantics, the waiting pushdown,
 * pins, row derivation (title / status / preview / trigger). Rendering lives in
 * `@agenta/sessions-ui` (antd-free) or the app — this package imports no UI, enforced by
 * eslint (`eslint.config.mjs` here).
 */
export * from "./state"
export * from "./row"
