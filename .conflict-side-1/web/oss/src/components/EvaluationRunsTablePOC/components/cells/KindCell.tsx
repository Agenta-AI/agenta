import {Tag, Typography} from "antd"

import {deriveEvaluationKind} from "@/oss/lib/evaluations/utils/evaluationKind"

import {EVALUATION_KIND_LABELS} from "../../constants"
import type {EvaluationRunTableRow} from "../../types"

const CELL_CLASS = "flex h-full w-full min-w-0 items-center gap-2 px-2"

// Light keeps antd's preset filled tag (unchanged). Only dark mode overrides the
// colors — antd's filled-preset block reads as a muddy, low-contrast block on a
// dark surface, so in dark we render the tag with the antd preset palette
// explicitly (bg = -1, text = -7, border = -3), the same recipe as the entity
// reference chips. `dark:!` so the overrides only apply in dark and beat antd's
// own preset classes.
const KIND_TONES: Record<string, {preset: string; darkClass: string}> = {
    auto: {
        preset: "geekblue",
        darkClass:
            "dark:!bg-[var(--ant-blue-1)] dark:!text-[var(--ant-blue-7)] dark:!border-[var(--ant-blue-3)]",
    },
    human: {
        preset: "purple",
        darkClass:
            "dark:!bg-[var(--ant-purple-1)] dark:!text-[var(--ant-purple-7)] dark:!border-[var(--ant-purple-3)]",
    },
    online: {
        preset: "green",
        darkClass:
            "dark:!bg-[var(--ant-green-1)] dark:!text-[var(--ant-green-7)] dark:!border-[var(--ant-green-3)]",
    },
    custom: {
        preset: "magenta",
        darkClass:
            "dark:!bg-[var(--ant-magenta-1)] dark:!text-[var(--ant-magenta-7)] dark:!border-[var(--ant-magenta-3)]",
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
            <Tag color={tone?.preset} className={tone?.darkClass}>
                {label}
            </Tag>
        </div>
    )
}

export default PreviewKindCell
