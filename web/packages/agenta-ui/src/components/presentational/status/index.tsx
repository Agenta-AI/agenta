/**
 * Status types + environment color record.
 *
 * The status/environment TAGS now live in `Tag` (`<Tag status=… />` / `<Tag env=… />`, ../tag).
 * This module keeps the status types, `EnvironmentName`, and the `environmentColors` record
 * (read by non-tag consumers, e.g. skeletons).
 */

import {type ReactNode} from "react"

import {cn} from "../../../utils/styles"

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

// ============================================================================
// STATUS INDICATOR — borderless dot + same-tone label (● Connected), for the
// "Status" reading a row/entity is in. Distinct from `Tag` (a filled pill).
// ============================================================================

export type StatusTone = "success" | "warning" | "error" | "processing" | "default"

// Dot + label share one color via `bg-current`, so a tone sets both at once. Tokens
// resolve through the palette, so each flips light↔dark with the theme.
const STATUS_TONE_CLASS: Record<StatusTone, string> = {
    success: "text-colorSuccess",
    warning: "text-colorWarning",
    error: "text-colorError",
    processing: "text-colorInfo",
    default: "text-colorTextSecondary",
}

export interface StatusIndicatorProps {
    tone?: StatusTone
    label: ReactNode
    className?: string
}

export function StatusIndicator({tone = "default", label, className}: StatusIndicatorProps) {
    return (
        <span
            className={cn("inline-flex items-center gap-1.5", STATUS_TONE_CLASS[tone], className)}
        >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            <span className="truncate">{label}</span>
        </span>
    )
}
