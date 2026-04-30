import {memo, useMemo} from "react"

import {
    evaluatorTemplatesDataAtom,
    getAppTypeColor,
    getEvaluatorColor,
    type EvaluatorColor,
    type WorkflowType,
} from "@agenta/entities/workflow"
import {cn} from "@agenta/ui"
import {Tag, Tooltip} from "antd"
import {useAtomValue} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

export interface WorkflowTypeTagProps {
    /** Whether this workflow is an evaluator. Determines the render path. */
    isEvaluator: boolean
    /**
     * Evaluator template key parsed from the URI (e.g. `auto_exact_match`) or
     * slug. Required when `isEvaluator` is true — used to look up the template
     * name and compute the hashed color via `getEvaluatorColor`.
     */
    workflowKey?: string | null
    /**
     * App workflow type (`chat`/`completion`/`custom`/…). Used when
     * `isEvaluator` is false to pick the app-type preset color.
     */
    workflowType?: WorkflowType | string | null
    className?: string
}

/** Human-readable labels for app workflow types. */
const APP_TYPE_LABEL: Record<string, string> = {
    chat: "Chat",
    completion: "Completion",
    custom: "Custom",
}

/**
 * Shared bordered-pill tag used for both app and evaluator type badges.
 * Taking a resolved `{label, color}` lets both branches produce visually
 * identical Tags — the only difference is how label/color are computed.
 */
const TypePill = ({
    label,
    color,
    className,
}: {
    label: string
    color: EvaluatorColor | null
    className?: string
}) => (
    // Tooltip surfaces the full label when truncated — user-deployed
    // evaluators have URI keys like `__main__.MyEvaluator` that exceed
    // any column width we'd want to give a type column.
    <Tooltip title={label} placement="topLeft">
        <Tag
            bordered
            style={
                color
                    ? {backgroundColor: color.bg, color: color.text, borderColor: color.border}
                    : undefined
            }
            className={cn("!m-0 max-w-[160px] truncate", className)}
        >
            {label}
        </Tag>
    </Tooltip>
)

const EvaluatorTag = ({
    workflowKey,
    className,
}: {
    workflowKey?: string | null
    className?: string
}) => {
    // Table cells frequently render inside InfiniteVirtualTable's isolated
    // Jotai Provider where project-scoped atoms aren't populated. Read from
    // the default store so the template catalog resolves regardless.
    const templates = useAtomValue(evaluatorTemplatesDataAtom, {store: getDefaultStore()})
    const template = useMemo(
        () => (workflowKey ? templates.find((t) => t.key === workflowKey) : undefined),
        [templates, workflowKey],
    )

    if (!workflowKey) return null

    return (
        <TypePill
            label={template?.name ?? workflowKey}
            color={getEvaluatorColor(workflowKey)}
            className={className}
        />
    )
}

const AppTag = ({
    workflowType,
    className,
}: {
    workflowType?: WorkflowType | string | null
    className?: string
}) => {
    if (!workflowType) return null
    return (
        <TypePill
            label={APP_TYPE_LABEL[workflowType] ?? workflowType}
            color={getAppTypeColor(workflowType)}
            className={className}
        />
    )
}

/**
 * Unified "Type" tag for workflow rows (apps + evaluators). Both branches
 * render the same bordered-pill shape via `TypePill` — only the label/color
 * source differs:
 *
 * - Evaluators: template `name` + hashed color via `getEvaluatorColor(key)`.
 * - Apps: humanized app type + preset color via `getAppTypeColor(type)`.
 *
 * Use this anywhere a workflow row needs a type badge instead of reinventing
 * the Tag styling or duplicating `EvaluatorTypeCell`/`AppTypeCell`.
 */
const WorkflowTypeTag = memo(
    ({isEvaluator, workflowKey, workflowType, className}: WorkflowTypeTagProps) => {
        if (isEvaluator) {
            return <EvaluatorTag workflowKey={workflowKey} className={className} />
        }
        return <AppTag workflowType={workflowType} className={className} />
    },
)

WorkflowTypeTag.displayName = "WorkflowTypeTag"

export default WorkflowTypeTag
