import type {Dispatch, HTMLProps, SetStateAction} from "react"

import {ModalProps} from "antd"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {LLMRunRateLimit, Evaluator, SimpleEvaluator, testset} from "@/oss/lib/Types"

export interface NewEvaluationAppOption {
    label: string
    value: string
    type?: string | null
    createdAt?: string | null
    updatedAt?: string | null
}

export interface LLMRunRateLimitWithCorrectAnswer extends LLMRunRateLimit {
    correct_answer_column: string
}

export interface NewEvaluationModalProps extends ModalProps {
    onSuccess?: () => void
    evaluationType: "auto" | "human"
    preview?: boolean
    /** Pre-selected variant revision IDs (e.g., from playground) */
    preSelectedVariantIds?: string[]
    /** Pre-selected app ID (e.g., from playground context) */
    preSelectedAppId?: string
}

export interface NewEvaluationModalContentProps extends HTMLProps<HTMLDivElement> {
    evaluationType: "auto" | "human"
    activePanel: string | null
    selectedTestsetId: string
    selectedTestsetRevisionId: string
    selectedTestsetName: string
    selectedTestsetVersion: number | null
    selectedVariantRevisionIds: string[]
    selectedEvalConfigs: string[]
    evaluationName: string
    preview?: boolean
    isLoading?: boolean
    setSelectedTestsetId: Dispatch<SetStateAction<string>>
    setSelectedTestsetRevisionId: Dispatch<SetStateAction<string>>
    setSelectedTestsetName: Dispatch<SetStateAction<string>>
    setSelectedTestsetVersion: Dispatch<SetStateAction<number | null>>
    onSuccess?: () => void
    handlePanelChange: (key: string | string[]) => void
    setSelectedVariantRevisionIds: Dispatch<SetStateAction<string[]>>
    setSelectedEvalConfigs: Dispatch<SetStateAction<string[]>>
    setEvaluationName: Dispatch<SetStateAction<string>>
    isOpen?: boolean
    testsets: testset[]
    variants?: EnhancedVariant[]
    variantsLoading?: boolean
    evaluators: Evaluator[] | EvaluatorDto<"response">[]
    evaluatorConfigs: SimpleEvaluator[]
    advanceSettings: LLMRunRateLimitWithCorrectAnswer
    setAdvanceSettings: Dispatch<SetStateAction<LLMRunRateLimitWithCorrectAnswer>>
    appOptions: NewEvaluationAppOption[]
    selectedAppId: string
    onSelectApp: (value: string) => void
    appSelectionDisabled?: boolean
    allowTestsetAutoAdvance?: boolean
    /** Callback when an evaluator template is selected from the dropdown (for inline creation) */
    onSelectTemplate?: (evaluator: Evaluator) => void
    /** Callback when a new evaluator config is created via the inline drawer. Used to refresh the list and auto-select. */
    onEvaluatorCreated?: (configId?: string) => void
}

export interface SelectVariantSectionProps extends HTMLProps<HTMLDivElement> {
    isVariantLoading?: boolean
    variants?: EnhancedVariant[]
    selectedVariantRevisionIds: string[]
    setSelectedVariantRevisionIds: Dispatch<SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    evaluationType: "auto" | "human"
    selectedTestsetId?: string
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
    selectedVariants?: EnhancedVariant[]
    allowAutoAdvance?: boolean
}

export interface SelectEvaluatorSectionProps extends HTMLProps<HTMLDivElement> {
    evaluatorConfigs: SimpleEvaluator[]
    evaluators: Evaluator[]
    selectedEvalConfigs: string[]
    setSelectedEvalConfigs: Dispatch<SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    preview?: boolean
    selectedAppId?: string
    /** Callback when an evaluator template is selected from the dropdown (for inline creation) */
    onSelectTemplate?: (evaluator: Evaluator) => void
    /** Callback when the "Create new" button is clicked in preview/human mode (for inline creation) */
    onCreateHumanEvaluator?: () => void
}

export interface AdvancedSettingsProps {
    advanceSettings: LLMRunRateLimitWithCorrectAnswer
    setAdvanceSettings: Dispatch<SetStateAction<LLMRunRateLimitWithCorrectAnswer>>
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
}
