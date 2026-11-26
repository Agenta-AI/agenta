// Alias target for modules /m must not load — see `turbopack.resolveAlias` in next.config.ts:
// the AI SDK's optional adapters, and the antd add-to-queue popover (the trace drawer slot gets
// the shadcn picker instead, so the default is never rendered). Importing this resolves to nothing, which is what the AI SDK's
// try/catch around its effect/valibot/arktype adapters already expects.
export {}
