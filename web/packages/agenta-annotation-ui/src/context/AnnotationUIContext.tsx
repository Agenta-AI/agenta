import {createContext, useContext, useMemo, type ReactNode} from "react"

export interface AnnotationUINavigation {
    /** Navigate to a specific queue's session view */
    navigateToQueue: (queueId: string) => void
    /** Navigate back to the queue list */
    navigateToQueueList: () => void
    /** Navigate to evaluation results */
    navigateToResults: (runId: string) => void
    /** Navigate to observability page */
    navigateToObservability?: () => void
    /** Open the trace detail drawer for a given trace/span */
    openTraceDetail?: (traceId: string, spanId?: string) => void
}

/**
 * Props for the trace content renderer slot.
 * Injected by the host app (OSS/EE) to provide rich trace rendering.
 */
export interface TraceContentRendererProps {
    traceId: string
    spanId?: string
}

/**
 * Props for the metric popover wrapper slot.
 * Injected by the host app to provide metric detail popovers on hover.
 */
export interface MetricPopoverWrapperProps {
    runId?: string
    metricKey?: string
    metricPath?: string
    metricLabel?: string
    stepKey?: string
    stepType?: string
    highlightValue?: unknown
    fallbackValue?: unknown
    evaluationType?: string
    prefetchedStats?: Record<string, unknown>
    children: ReactNode
}

export interface AnnotationUIContextValue {
    navigation: AnnotationUINavigation
    /** Optional rich trace content renderer injected by host app */
    TraceContentRenderer?: React.ComponentType<TraceContentRendererProps>
    /** Optional metric popover wrapper injected by host app */
    MetricPopoverWrapper?: React.ComponentType<MetricPopoverWrapperProps>
}

const AnnotationUIContext = createContext<AnnotationUIContextValue | null>(null)

export interface AnnotationUIProviderProps {
    navigation: AnnotationUINavigation
    /** Optional rich trace content renderer injected by host app */
    TraceContentRenderer?: React.ComponentType<TraceContentRendererProps>
    /** Optional metric popover wrapper injected by host app */
    MetricPopoverWrapper?: React.ComponentType<MetricPopoverWrapperProps>
    children: ReactNode
}

export function AnnotationUIProvider({
    navigation,
    TraceContentRenderer,
    MetricPopoverWrapper,
    children,
}: AnnotationUIProviderProps) {
    const value = useMemo(
        () => ({navigation, TraceContentRenderer, MetricPopoverWrapper}),
        [navigation, TraceContentRenderer, MetricPopoverWrapper],
    )
    return <AnnotationUIContext.Provider value={value}>{children}</AnnotationUIContext.Provider>
}

export function useAnnotationUI(): AnnotationUIContextValue {
    const ctx = useContext(AnnotationUIContext)
    if (!ctx) {
        throw new Error("useAnnotationUI must be used within AnnotationUIProvider")
    }
    return ctx
}

export function useAnnotationNavigation(): AnnotationUINavigation {
    return useAnnotationUI().navigation
}

export function useTraceContentRenderer(): React.ComponentType<TraceContentRendererProps> | null {
    const ctx = useContext(AnnotationUIContext)
    return ctx?.TraceContentRenderer ?? null
}

export function useMetricPopoverWrapper(): React.ComponentType<MetricPopoverWrapperProps> | null {
    const ctx = useContext(AnnotationUIContext)
    return ctx?.MetricPopoverWrapper ?? null
}
