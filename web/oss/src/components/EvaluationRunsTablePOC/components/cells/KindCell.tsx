import {Tag, Typography} from "antd"

import {deriveEvaluationKind} from "@/oss/lib/evaluations/utils/evaluationKind"

import {EVALUATION_KIND_LABELS} from "../../constants"
import type {EvaluationRunTableRow} from "../../types"

const CELL_CLASS = "flex h-full w-full min-w-0 items-center gap-2 px-2"

const KIND_TONES: Record<string, string> = {
    auto: "geekblue",
    human: "purple",
    online: "green",
    custom: "magenta",
}

/**
 * Resolve the evaluation kind for a table row.
 * Uses the centralized utility that derives kind from run.data.steps.
 * Falls back to explicit evaluationKind if already set on the row.
 */
const resolveKind = (record: EvaluationRunTableRow): keyof typeof EVALUATION_KIND_LABELS | null => {
    // First check if kind was already derived and set on the row
    const explicitKind = record.evaluationKind
    if (explicitKind && EVALUATION_KIND_LABELS[explicitKind]) {
        return explicitKind
    }

    // Derive kind from run data if available (via previewMeta.steps)
    // Note: previewMeta contains steps extracted from run.data.steps
    const steps = (record.previewMeta as any)?.steps
    if (steps) {
        const derivedKind = deriveEvaluationKind({data: {steps}})
        if (EVALUATION_KIND_LABELS[derivedKind]) {
            return derivedKind
        }
    }

    return null
}

export const PreviewKindCell = ({record}: {record: EvaluationRunTableRow}) => {
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <Typography.Text type="secondary">Loading…</Typography.Text>
            </div>
        )
    }
    const kind = resolveKind(record)
    if (!kind) {
        return (
            <div className={CELL_CLASS}>
                <Typography.Text type="secondary">—</Typography.Text>
            </div>
        )
    }
    const label = EVALUATION_KIND_LABELS[kind] ?? "—"
    const color = KIND_TONES[kind] ?? "#e5e7eb"
    return (
        <div className={CELL_CLASS}>
            <Tag color={color}>{label}</Tag>
        </div>
    )
}

export default PreviewKindCell
