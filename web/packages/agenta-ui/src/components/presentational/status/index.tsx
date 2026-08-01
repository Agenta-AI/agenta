/**
 * Status types + environment color record.
 *
 * The status/environment TAGS now live in `Tag` (`<Tag status=… />` / `<Tag env=… />`, ../tag).
 * This module keeps the status types, `EnvironmentName`, and the `environmentColors` record
 * (read by non-tag consumers, e.g. skeletons).
 */

// ============================================================================
// TYPES
// ============================================================================

export type QueryStatus = "loading" | "error" | "ready"
export type ExecutionStatus = "idle" | "pending" | "running" | "success" | "error"

// ============================================================================
// ENVIRONMENT — the env TAG now lives in `Tag` (`<Tag env="production" />`, ../tag);
// this keeps the env name type + the color record (read by non-tag consumers).
// ============================================================================

export type EnvironmentName = "production" | "staging" | "development"

// Values are theme CSS vars (not raw hex) so any consumer reading them — e.g. the
// DeploymentCard skeleton — adapts in dark mode instead of pinning a light-mode hex.
export const environmentColors: Record<
    EnvironmentName,
    {bgColor: string; textColor: string; label: string}
> = {
    production: {
        bgColor: "var(--ag-env-production-bg)",
        textColor: "var(--ag-env-production-text)",
        label: "Production",
    },
    staging: {
        bgColor: "var(--ag-env-staging-bg)",
        textColor: "var(--ag-env-staging-text)",
        label: "Staging",
    },
    development: {
        bgColor: "var(--ag-env-development-bg)",
        textColor: "var(--ag-env-development-text)",
        label: "Development",
    },
}
