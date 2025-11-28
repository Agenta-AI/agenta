import {Tag, Typography} from "antd"

import {EVALUATION_KIND_LABELS} from "../../constants"
import type {EvaluationRunTableRow} from "../../types"

const CELL_CLASS = "flex h-full w-full min-w-0 items-center gap-2 px-2"

const KIND_TONES: Record<string, string> = {
    auto: "geekblue",
    human: "purple",
    online: "green",
    custom: "magenta",
}

const resolveKind = (record: EvaluationRunTableRow): keyof typeof EVALUATION_KIND_LABELS | null => {
    const explicitKind = record.evaluationKind
    if (explicitKind && EVALUATION_KIND_LABELS[explicitKind]) {
        return explicitKind
    }
    const metaKind = (record.previewMeta as any)?.evaluation_kind as string | undefined
    if (metaKind && EVALUATION_KIND_LABELS[metaKind as keyof typeof EVALUATION_KIND_LABELS]) {
        return metaKind as keyof typeof EVALUATION_KIND_LABELS
    }
    const sourceKind = (record as any)?.source_kind as string | undefined
    if (sourceKind && EVALUATION_KIND_LABELS[sourceKind as keyof typeof EVALUATION_KIND_LABELS]) {
        return sourceKind as keyof typeof EVALUATION_KIND_LABELS
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
