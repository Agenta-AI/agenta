import type {ComponentType, ReactNode, SetStateAction} from "react"

import type {EvaluationStepSlot as CoreEvaluationStepSlot} from "@agenta/evaluations/core"

import type {NewEvaluationAppOption} from "../types"
import type {EvaluationConcurrencySettings} from "../types"

export type EvalStepKind = "application" | "revision" | "testset" | "evaluator" | "advanced"

export interface ApplicationStepValue {
    id: string
    label?: string
    isEvaluator?: boolean
}

export interface TestsetStepValue {
    id: string
    revisionId: string
    name: string
    version: number | null
}

export interface EvalStepValueMap {
    application: ApplicationStepValue
    revision: string[]
    testset: TestsetStepValue
    evaluator: string[]
    advanced: EvaluationConcurrencySettings
}

export interface EvalStepSlot extends CoreEvaluationStepSlot<EvalStepKind> {
    preset?: EvalStepValueMap[EvalStepKind]
}

export interface EvalStepContext {
    projectId?: string
    appId?: string
    evaluationType: "auto" | "human"
    preview: boolean
    getStepValue: <Kind extends EvalStepKind>(kind: Kind) => EvalStepValueMap[Kind]
    setStepValue: <Kind extends EvalStepKind>(
        kind: Kind,
        value: SetStateAction<EvalStepValueMap[Kind]>,
    ) => void
    advanceFrom: (kind: EvalStepKind) => void
}

export interface EvalStepRuntime {
    appOptions: NewEvaluationAppOption[]
    allowTestsetAutoAdvance: boolean
    onSelectApplication: (value: ApplicationStepValue) => void
    onEvaluatorCreated?: (configId?: string) => void
}

export type EvalStepTarget = string[] | Record<string, "custom" | "human" | "auto">

export interface SimpleEvaluationDataPayload {
    status?: string | null
    query_steps?: EvalStepTarget | null
    testset_steps?: EvalStepTarget | null
    application_steps?: EvalStepTarget | null
    evaluator_steps?: EvalStepTarget | null
    repeats?: number | null
    concurrency?: EvaluationConcurrencySettings | null
}

export interface EvalStepSectionProps<Value> {
    value: Value
    slot: EvalStepSlot
    context: EvalStepContext
    runtime: EvalStepRuntime
}

export interface EvalStepDescriptor<Value = unknown> {
    kind: EvalStepKind
    title: string
    Section: ComponentType<EvalStepSectionProps<Value>>
    defaultValue: Value
    isComplete: (value: Value, context: EvalStepContext) => boolean
    isVisible?: (context: EvalStepContext) => boolean
    renderSummary?: (value: Value, context: EvalStepContext, slot: EvalStepSlot) => ReactNode
    toPayload?: (
        value: Value,
        context: EvalStepContext,
    ) => Promise<Partial<SimpleEvaluationDataPayload>>
    incompleteMessage: string
}

export type EvalStepDescriptorRegistry = {
    [Kind in EvalStepKind]: EvalStepDescriptor<EvalStepValueMap[Kind]>
}
