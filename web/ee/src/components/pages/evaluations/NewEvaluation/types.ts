import type {Dispatch, HTMLProps, SetStateAction} from "react"

import {ModalProps} from "antd"

import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {LLMRunRateLimit, Evaluator, EvaluatorConfig, testset} from "@/oss/lib/Types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

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
    selectedVariantRevisionIds: string[]
    selectedEvalConfigs: string[]
    evaluationName: string
    preview?: boolean
    isLoading?: boolean
    setSelectedTestsetId: Dispatch<SetStateAction<string>>
    onSuccess?: () => void
    handlePanelChange: (key: string | string[]) => void
    setSelectedVariantRevisionIds: Dispatch<SetStateAction<string[]>>
    setSelectedEvalConfigs: Dispatch<SetStateAction<string[]>>
    setEvaluationName: Dispatch<SetStateAction<string>>
    isOpen?: boolean
    testSets: testset[]
    variants?: EnhancedVariant[]
    evaluators: Evaluator[] | EvaluatorDto<"response">[]
    evaluatorConfigs: EvaluatorConfig[]
    advanceSettings: LLMRunRateLimitWithCorrectAnswer
    setAdvanceSettings: Dispatch<SetStateAction<LLMRunRateLimitWithCorrectAnswer>>
}

export interface SelectVariantSectionProps extends HTMLProps<HTMLDivElement> {
    isVariantLoading: boolean
    variants?: EnhancedVariant[]
    selectedVariantRevisionIds: string[]
    setSelectedVariantRevisionIds: Dispatch<SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    evaluationType: "auto" | "human"
}

export interface SelectTestsetSectionProps extends HTMLProps<HTMLDivElement> {
    testSets: testset[]
    selectedTestsetId: string
    setSelectedTestsetId: Dispatch<SetStateAction<string>>
    handlePanelChange: (key: string | string[]) => void
    preview?: boolean
}

export interface SelectEvaluatorSectionProps extends HTMLProps<HTMLDivElement> {
    evaluatorConfigs: EvaluatorConfig[]
    evaluators: Evaluator[]
    selectedEvalConfigs: string[]
    setSelectedEvalConfigs: Dispatch<SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    preview?: boolean
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
