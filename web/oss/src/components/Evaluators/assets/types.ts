import {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"

export type EvaluatorCategory = "automatic" | "human"

export type EvaluatorPreview = EvaluatorPreviewDto & {
    flags?: Record<string, any>
    meta?: Record<string, any>
    createdAt?: string
    createdBy?: string
    createdById?: string
    updated_at?: string
    updatedAt?: string
    updated_by?: string
    metrics?: Record<string, unknown>
}

export type EvaluatorConfigRow = SimpleEvaluator & {
    evaluator?: Evaluator | null
    kind?: "config"
}

export type EvaluatorRegistryRaw = (EvaluatorPreview & {kind?: "preview"}) | EvaluatorConfigRow

export interface EvaluatorTypeBadge {
    label: string
    variant: EvaluatorCategory
    colorHex?: string
}

export interface EvaluatorRegistryRow {
    key: string
    id: string
    name: string
    slug?: string
    typeBadge: EvaluatorTypeBadge
    versionLabel: string
    tags: string[]
    dateCreated: string
    lastModified: string
    modifiedBy: string
    avatarName: string
    raw: EvaluatorRegistryRaw
}

export interface GetColumnsParams {
    category: EvaluatorCategory
    onEdit?: (record: EvaluatorRegistryRow) => void
    onConfigure?: (record: EvaluatorRegistryRow) => void
    onDelete: (record: EvaluatorRegistryRow) => void
}
