export interface MetricCellProps {
    scenarioId: string
    metricKey: string
    fullKey?: string
    value: any
    distInfo?: any
    metricType?: string
}

export interface MetricValueCellProps {
    scenarioId: string
    metricKey: string
    fullKey?: string
    distInfo?: any
    metricType?: string
    evalType?: "auto" | "human"
}

export interface AnnotationValueCellProps {
    scenarioId: string
    fieldPath: string // e.g. "data.outputs.isGood"
    metricKey: string
    fullKey?: string
    distInfo?: any
    metricType?: string
    stepKey?: string
    name?: string
}

export interface CollapsedAnnotationValueCellProps {
    scenarioId: string
    childrenDefs: any[]
}
