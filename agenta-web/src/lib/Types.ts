import { EvaluationType } from "./enums"

export interface Dataset {
    _id: string
    name: string
    created_at: string
}

export interface AppVariant {
    id: number
    name: string
    endpoint: string
}

export interface Variant {
    variantName: string
    templateVariantName: string | null // template name of the variant in case it has a precursor. Needed to compute the URI path
    persistent: boolean // whether the variant is persistent in the backend or not
    parameters: Record<string, string> | null // parameters of the variant. Only set in the case of forked variants
}

export interface AppEvaluation {
    id: string
    createdAt: string
    variants: Variant[]
    evaluationType: string
    dataset: {
        _id: string
        name: string
    }
    appName: string
}

export interface Parameter {
    name: string
    type: string
    input: boolean
    required: boolean
    default?: any
}

export interface AppEvaluationResponseType {
    id: string
    variants: string[]
    votes_data: {
        variants_votes_data: {
            number_of_votes: number
            percentage: number
        }
        flag_votes: {number_of_votes: number; percentage: number}
    }
    app_name: string
    status: string
    evaluation_type: string
    evaluation_type_settings: {
        similarity_threshold?: number
    }
    dataset: {
        _id: string
        name: string
    }
    created_at: string
}

export type LanguageItem = {displayName: string; languageKey: string}

export interface ResultsTableDataType {
    id: string
    variants: string[]
    votesData?: {
        variants_votes_data: {
            number_of_votes: number
            percentage: number
        }
        flag_votes: {number_of_votes: number; percentage: number}
    }
    scoresData?: any
    evaluationType: EvaluationType
    createdAt?: string
}