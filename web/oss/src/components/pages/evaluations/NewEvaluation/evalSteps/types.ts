import type {ComponentType, ReactNode, SetStateAction} from "react"

import type {EvaluationStepSlot as CoreEvaluationStepSlot} from "@agenta/evaluations/core"
import type {getAgentaSdkClient} from "@agenta/sdk"

import type {EvaluationConcurrencySettings} from "../types"

export type EvalStepKind =
    | "invocation"
    | "revision"
    | "testset"
    | "evaluator"
    | "advanced"
    | "traces"
    | "query"

export interface InvocationStepValue {
    id: string
    label?: string
}

export interface TestsetStepValue {
    id: string
    revisionId: string
    name: string
    version: number | null
}

export interface QueryStepValue {
    queryId: string
    revisionId?: string
    name?: string
}

export interface EvalStepValueMap {
    invocation: InvocationStepValue
    revision: string[]
    testset: TestsetStepValue
    evaluator: string[]
    advanced: EvaluationConcurrencySettings
    traces: string[]
    query: QueryStepValue
}

export type EvalStepSlot<Kind extends EvalStepKind = EvalStepKind> = {
    [StepKind in Kind]: CoreEvaluationStepSlot<EvalStepKind, StepKind, EvalStepValueMap[StepKind]>
}[Kind]

export interface EvalStepContext {
    projectId?: string
    workflowId?: string
    evaluationType: "auto" | "human"
    preview: boolean
    liveCompatibleEvaluatorsOnly: boolean
    getEvaluationName: () => string
    getStepValue: <Kind extends EvalStepKind>(kind: Kind) => EvalStepValueMap[Kind]
    setStepValue: <Kind extends EvalStepKind>(
        kind: Kind,
        value: SetStateAction<EvalStepValueMap[Kind]>,
    ) => void
    advanceFrom: (kind: EvalStepKind) => void
}

export interface EvalStepRuntime {
    allowTestsetAutoAdvance: boolean
    onEvaluatorCreated?: (configId?: string) => void
}

type AgentaSdkClient = ReturnType<typeof getAgentaSdkClient>
type SimpleEvaluationCreateRequest = Parameters<
    AgentaSdkClient["evaluations"]["createSimpleEvaluation"]
>[0]
type SimpleEvaluationCreate = SimpleEvaluationCreateRequest["evaluation"]

export type SimpleEvaluationDataPayload = NonNullable<SimpleEvaluationCreate["data"]>

export interface EvalStepSectionProps<Value> {
    value: Value
    slot: EvalStepSlot
    context: EvalStepContext
    runtime: EvalStepRuntime
}

export interface EvalStepDescriptor<Kind extends EvalStepKind, Value> {
    kind: Kind
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
    [Kind in EvalStepKind]: EvalStepDescriptor<Kind, EvalStepValueMap[Kind]>
}
