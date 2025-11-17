export type RunMetricKind = "generic" | "evaluator" | "invocation"

export interface RunMetricDescriptor {
    id: string
    label: string
    metricKey: string
    metricPath: string
    stepKey?: string
    stepKeysByRunId?: Record<string, string>
    metricPathsByRunId?: Record<string, string>
    kind: RunMetricKind
    width?: number
    evaluatorRef?: {
        id?: string | null
        slug?: string | null
        variantId?: string | null
        variantSlug?: string | null
        revisionId?: string | null
        revisionSlug?: string | null
        projectId?: string | null
    }
}
