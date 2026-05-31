import {Tag, Typography} from "antd"

import {deriveEvaluationKind} from "@/oss/lib/evaluations/utils/evaluationKind"

import {EVALUATION_KIND_LABELS} from "../../constants"
import type {EvaluationRunTableRow} from "../../types"

const CELL_CLASS = "flex h-full w-full min-w-0 items-center gap-2 px-2"

// Use the antd preset palette explicitly (bg = -1, text = -7, border = -3) — the
// same recipe as the entity reference chips — so the kind chip stays legible and
// color-coded in dark mode instead of antd's heavy filled-preset block.
const KIND_TONES: Record<string, {bg: string; text: string; border: string}> = {
    auto: {bg: "var(--ant-blue-1)", text: "var(--ant-blue-7)", border: "var(--ant-blue-3)"},
    human: {
        bg: "var(--ant-purple-1)",
        text: "var(--ant-purple-7)",
        border: "var(--ant-purple-3)",
    },
    online: {bg: "var(--ant-green-1)", text: "var(--ant-green-7)", border: "var(--ant-green-3)"},
    custom: {
        bg: "var(--ant-magenta-1)",
        text: "var(--ant-magenta-7)",
        border: "var(--ant-magenta-3)",
    },
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
    const tone = KIND_TONES[kind]
    return (
        <div className={CELL_CLASS}>
            <Tag
                style={
                    tone
                        ? {
                              backgroundColor: tone.bg,
                              color: tone.text,
                              borderColor: tone.border,
                          }
                        : undefined
                }
            >
                {label}
            </Tag>
        </div>
    )
}

export default PreviewKindCell
