/**
 * Moved to `@agenta/observability` so the trace-drawer state layer (which `/m` needs) can reach
 * it without importing the app. Re-exported here so the app's existing callers keep working;
 * point new code at the package directly.
 */
export * from "@agenta/observability/dto"
