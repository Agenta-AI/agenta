import {memo, useMemo} from "react"

import {
    evaluatorTemplatesDataAtom,
    getWorkflowTypeColor,
    getWorkflowTypeLabel,
    type WorkflowTypeColor,
    type WorkflowType,
} from "@agenta/entities/workflow"
import {cn} from "@agenta/ui"
import {
    Badge,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    type BadgeProps,
} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

export interface WorkflowTypeTagProps {
    /** Whether this workflow is an evaluator. Determines the render path. */
    isEvaluator: boolean
    /**
     * Evaluator template key parsed from the URI (e.g. `auto_exact_match`) or
     * slug. Used when `isEvaluator` is true to look up the template name and
     * category-backed static color.
     */
    workflowKey?: string | null
    /** Evaluator category/subtype (`ai_llm`/`match`/`code`/...). */
    evaluatorTypeKey?: string | null
    /**
     * App workflow type (`chat`/`completion`/`custom`/…). Used when
     * `isEvaluator` is false to pick the app-type preset color.
     */
    workflowType?: WorkflowType | string | null
    className?: string
}

// All 13 antd preset hues now exist as Badge variants (palette `presetTag`).
const BADGE_PRESET: Partial<Record<string, BadgeProps["variant"]>> = {
    blue: "blue",
    green: "green",
    orange: "orange",
    red: "red",
    purple: "purple",
    cyan: "cyan",
    magenta: "magenta",
    gold: "gold",
    pink: "pink",
    yellow: "yellow",
    volcano: "volcano",
    geekblue: "geekblue",
    lime: "lime",
}

/**
 * Shared preset-pill tag used for both app and evaluator type badges.
 * Taking a resolved `{label, color}` lets both branches produce visually
 * identical pills — the only difference is how label/color are computed.
 */
const TypePill = ({
    label,
    color,
    className,
}: {
    label: string
    color: WorkflowTypeColor | null
    className?: string
}) => {
    // Use the preset color name (e.g. "blue", "gold") rather than the resolved
    // hex so the pill adapts to light/dark via the theme-flipping tokens.
    const variant = color?.name ? BADGE_PRESET[color.name] : undefined
    return (
        // Tooltip surfaces the full label when truncated — user-deployed
        // evaluators have URI keys like `__main__.MyEvaluator` that exceed
        // any column width we'd want to give a type column.
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Badge variant={variant} className={cn("max-w-[160px]", className)}>
                        <span className="truncate">{label}</span>
                    </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                    {label}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

const EvaluatorTag = ({
    workflowKey,
    evaluatorTypeKey,
    className,
}: {
    workflowKey?: string | null
    evaluatorTypeKey?: string | null
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

    if (!workflowKey && !evaluatorTypeKey) return null

    const typeKey = workflowKey ?? evaluatorTypeKey ?? template?.categories?.[0]
    const label =
        template?.name ??
        workflowKey ??
        getWorkflowTypeLabel(evaluatorTypeKey) ??
        evaluatorTypeKey ??
        null

    if (!label) return null

    return <TypePill label={label} color={getWorkflowTypeColor(typeKey)} className={className} />
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
            label={getWorkflowTypeLabel(workflowType) ?? workflowType}
            color={getWorkflowTypeColor(workflowType)}
            className={className}
        />
    )
}

/**
 * Unified "Type" tag for workflow rows (apps + evaluators). Both branches
 * render the same bordered-pill shape via `TypePill` — only the label/color
 * source differs:
 *
 * - Evaluators: template `name` + key preset color via `getWorkflowTypeColor(key)`.
 * - Apps: humanized app type + preset color via `getWorkflowTypeColor(type)`.
 *
 * Use this anywhere a workflow row needs a type badge instead of reinventing
 * the Tag styling or duplicating `EvaluatorTypeCell`/`AppTypeCell`.
 */
const WorkflowTypeTag = memo(
    ({
        isEvaluator,
        workflowKey,
        evaluatorTypeKey,
        workflowType,
        className,
    }: WorkflowTypeTagProps) => {
        if (isEvaluator) {
            return (
                <EvaluatorTag
                    workflowKey={workflowKey}
                    evaluatorTypeKey={evaluatorTypeKey}
                    className={className}
                />
            )
        }
        return <AppTag workflowType={workflowType} className={className} />
    },
)

WorkflowTypeTag.displayName = "WorkflowTypeTag"

export default WorkflowTypeTag
