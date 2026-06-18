import type {Dispatch, HTMLProps, SetStateAction} from "react"

import type {EvaluatorCatalogTemplate, Workflow} from "@agenta/entities/workflow"
import {ModalProps} from "antd"

import {testset} from "@/oss/lib/Types"

import type {
    EvalStepContext,
    EvalStepRuntime,
    EvalStepSlot,
    EvalStepValueMap,
} from "./evalSteps/types"

export interface NewEvaluationAppOption {
    label: string
    value: string
    type?: string | null
    createdAt?: string | null
    updatedAt?: string | null
}

export interface EvaluationConcurrencySettings {
    batch_size: number
    max_retries: number
    retry_delay: number
}

export interface NewEvaluationModalProps extends ModalProps {
    onSuccess?: () => void
    evaluationType: "auto" | "human"
    preview?: boolean
    /** Pre-selected variant revision IDs (e.g., from playground) */
    preSelectedVariantIds?: string[]
    /** Pre-selected app ID (e.g., from playground context) */
    preSelectedAppId?: string
    /** Declarative modal steps. Omit to use the existing application evaluation flow. */
    steps?: EvalStepSlot[]
    /** Builds the deterministic base used by automatic evaluation-name suggestions. */
    nameBuilder?: (values: Readonly<Partial<EvalStepValueMap>>) => string
}

export interface NewEvaluationModalContentProps {
    evaluationName: string
    setEvaluationName: Dispatch<SetStateAction<string>>
    steps: EvalStepSlot[]
    context: EvalStepContext
    runtime: EvalStepRuntime
}

export interface SelectVariantSectionProps extends HTMLProps<HTMLDivElement> {
    selectedVariantRevisionIds: string[]
    setSelectedVariantRevisionIds: Dispatch<SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    evaluationType: "auto" | "human"
}

export interface SelectTestsetSectionProps extends HTMLProps<HTMLDivElement> {
    testsets?: testset[]
    selectedTestsetId: string
    selectedTestsetRevisionId?: string
    setSelectedTestsetId: Dispatch<SetStateAction<string>>
    setSelectedTestsetRevisionId?: Dispatch<SetStateAction<string>>
    selectedTestsetName?: string
    setSelectedTestsetName?: Dispatch<SetStateAction<string>>
    selectedTestsetVersion?: number | null
    setSelectedTestsetVersion?: Dispatch<SetStateAction<number | null>>
    handlePanelChange: (key: string | string[]) => void
    preview?: boolean
    selectedVariantRevisionIds: string[]
    /** Selected variant objects - used to extract input variables for testset compatibility checks */
    selectedVariants?: Workflow[]
    allowAutoAdvance?: boolean
}

export interface SelectEvaluatorSectionProps extends HTMLProps<HTMLDivElement> {
    selectedEvalConfigs: string[]
    setSelectedEvalConfigs: Dispatch<SetStateAction<string[]>>
    preview?: boolean
    selectedAppId?: string
    /** Callback when an evaluator template is selected from the dropdown (for inline creation) */
    onSelectTemplate?: (evaluator: EvaluatorCatalogTemplate) => void
    /** Callback when the "Create new" button is clicked in preview/human mode (for inline creation) */
    onCreateHumanEvaluator?: () => void
}

export interface AdvancedSettingsProps {
    advanceSettings: EvaluationConcurrencySettings
    setAdvanceSettings: Dispatch<SetStateAction<EvaluationConcurrencySettings>>
    preview?: boolean
}

export interface NewEvaluationModalGenericProps<Preview extends boolean = true> extends Omit<
    NewEvaluationModalProps,
    "preview"
> {
    preview?: Preview
}

export interface NewEvaluationModalInnerProps {
    onSuccess?: () => void
    preview?: boolean
    evaluationType: "auto" | "human"
    onSubmitStateChange?: (loading: boolean) => void
    /** Pre-selected variant revision IDs (e.g., from playground) */
    preSelectedVariantIds?: string[]
    /** Pre-selected app ID (e.g., from playground context) */
    preSelectedAppId?: string
    steps?: EvalStepSlot[]
    nameBuilder?: (values: Readonly<Partial<EvalStepValueMap>>) => string
}
