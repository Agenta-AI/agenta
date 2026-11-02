// Span types live in @agenta/observability (annotated variant) and
// @agenta/entities/trace (base). Re-exported type-only for the app's callers.
import type {TraceSpanNode} from "@agenta/observability"

export type {TraceSpanNode}

// AGE-3788: the dashboard shape and the transform onto it moved to @agenta/observability
// (shared with mobile) — import `DashboardData` from there.
