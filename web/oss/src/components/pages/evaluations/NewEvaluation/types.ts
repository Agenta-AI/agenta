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
    preview?: boolean
    open: boolean
    onSuccess?: () => void
    onRegisterSubmit: (handler: () => Promise<void> | void) => void
    onLoadingChange: (loading: boolean) => void
    onReset?: () => void
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
    testsets: testset[]
    selectedTestsetId: string
    setSelectedTestsetId: Dispatch<SetStateAction<string>>
    handlePanelChange: (key: string | string[]) => void
    preview?: boolean
    selectedVariantRevisionIds: string[]
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
