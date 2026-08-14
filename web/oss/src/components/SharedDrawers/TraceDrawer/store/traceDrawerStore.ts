/**
 * Moved to `@agenta/observability/traceDrawer` so `/m` can reach the trace-drawer state
 * without importing the app. Re-exported here for existing callers; new code imports the
 * package directly.
 */
export * from "@agenta/observability/traceDrawer"
