/**
 * Agent HTML apps — shared contracts (lane 0). Protocol types and constants, the tolerant
 * `app.json` parser, and the in-memory mock host every other lane codes against.
 * Lane A adds the real bridge: the injected stub, the parent-side host and its parts.
 */
export * from "./etags"
export * from "./fsClient"
export * from "./grants"
export * from "./host"
export * from "./manifest"
export * from "./mockHost"
export * from "./protocol"
export * from "./scope"
export * from "./stub"
