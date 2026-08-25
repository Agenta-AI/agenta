// Alias target for optional dependencies we never use — see `turbopack.resolveAlias`
// in next.config.ts. Importing this resolves to nothing, which is what the AI SDK's
// try/catch around its effect/valibot/arktype adapters already expects.
export {}
