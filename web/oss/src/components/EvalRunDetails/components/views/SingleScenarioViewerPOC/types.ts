import type {EvaluationTableColumn} from "../../../atoms/table"

export interface ScenarioStep {
    id?: string
    stepKey?: string
    step_key?: string
    key?: string
    status?: string
    traceId?: string
    trace_id?: string
    spanId?: string
    span_id?: string
    data?: Record<string, unknown>
    outputs?: unknown
    output?: unknown
    trace?: unknown
    traceData?: unknown
    trace_data?: unknown
    testcaseId?: string
    testcase_id?: string
    testsetId?: string
    testset_id?: string
    testcase?: {id?: string}
    testset?: {id?: string}
    annotation?: unknown
    annotations?: unknown
    [key: string]: unknown
}

export interface EvaluatorDto {
    id: string
    slug: string
    name?: string
    description?: string
    data?: {
        schemas?: {
            outputs?: {
                properties?: Record<string, unknown>
                required?: string[]
            }
        }
        service?: {
            format?: {
                properties?: {
                    outputs?: {
                        properties?: Record<string, unknown>
                        required?: string[]
                    }
                }
            }
        }
    }
    [key: string]: unknown
}

export interface AnnotationDto {
    id?: string
    trace_id?: string
    span_id?: string
    data?: {
        outputs?: Record<string, unknown>
    }
    references?: {
        evaluator?: {
            id?: string
            slug?: string
        }
    }
    meta?: {
        name?: string
        description?: string
    }
    links?: Record<string, unknown>
    [key: string]: unknown
}

export interface ScenarioHeaderProps {
    runId: string
    scenarioId: string
    status?: string
    onScenarioChange: (scenarioId: string) => void
}

export interface ScenarioInputsCardProps {
    columns: EvaluationTableColumn[]
    steps: ScenarioStep[]
    scenarioId: string
    runId: string
    isLoading?: boolean
}

export interface ScenarioOutputCardProps {
    columns: EvaluationTableColumn[]
    steps: ScenarioStep[]
    scenarioId: string
    runId: string
    primaryTrace: unknown
    isLoading?: boolean
}

export interface AnnotationMetricField {
    value: unknown
    type?: string
    minimum?: number
    maximum?: number
    items?: {
        type?: string
        enum?: string[]
    }
    [key: string]: unknown
}

export type AnnotationMetrics = Record<string, Record<string, AnnotationMetricField>>

export interface ScenarioAnnotationPanelProps {
    runId: string
    scenarioId: string
    evaluators: EvaluatorDto[]
    annotations: AnnotationDto[]
    invocationSteps: ScenarioStep[]
    allSteps: ScenarioStep[]
    hasInvocationOutput: boolean
    allInvocationsSuccessful: boolean
    pendingInvocationStepKey: string | null
    isRunningInvocation: boolean
    onRunInvocation: () => void
    onAnnotationSaved?: () => void
}
