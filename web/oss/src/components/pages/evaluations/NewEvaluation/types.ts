import type {Dispatch, HTMLProps, SetStateAction} from "react"

import {ModalProps} from "antd"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {LLMRunRateLimit, Evaluator, EvaluatorConfig, testset} from "@/oss/lib/Types"

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
    evaluatorConfigs: EvaluatorConfig[]
    advanceSettings: LLMRunRateLimitWithCorrectAnswer
    setAdvanceSettings: Dispatch<SetStateAction<LLMRunRateLimitWithCorrectAnswer>>
    appOptions: NewEvaluationAppOption[]
    selectedAppId: string
    onSelectApp: (value: string) => void
    appSelectionDisabled?: boolean
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
}

export interface SelectEvaluatorSectionProps extends HTMLProps<HTMLDivElement> {
    evaluatorConfigs: EvaluatorConfig[]
    evaluators: Evaluator[]
    selectedEvalConfigs: string[]
    setSelectedEvalConfigs: Dispatch<SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    preview?: boolean
    selectedAppId?: string
}

export interface AdvancedSettingsProps {
    advanceSettings: LLMRunRateLimitWithCorrectAnswer
    setAdvanceSettings: Dispatch<SetStateAction<LLMRunRateLimitWithCorrectAnswer>>
    preview?: boolean
}

export interface NewEvaluationModalGenericProps<Preview extends boolean = true>
    extends Omit<NewEvaluationModalProps, "preview"> {
    preview?: Preview
}

export interface NewEvaluationModalInnerProps {
    onSuccess?: () => void
    preview?: boolean
    evaluationType: "auto" | "human"
    onSubmitStateChange?: (loading: boolean) => void
    isOpen?: boolean
}
