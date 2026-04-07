import {useCallback} from "react"

import {
    EntityPicker,
    useEnrichedHumanEvaluatorAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VersionBadge} from "@agenta/ui"
import {textColors} from "@agenta/ui/styles"
import {Plus} from "@phosphor-icons/react"

export interface WorkflowRevisionLike {
    version?: number | null
    name?: string | null
    flags?: {is_feedback?: boolean} | null
    data?: Record<string, unknown> | null
}

interface OutputMetric {
    name: string
    type: string
}

export interface EntityEvaluatorSelectorProps {
    onSelect: (selection: WorkflowRevisionSelectionResult) => void
    instanceId: string
    buttonLabel?: string
    disabledRevisionIds?: Set<string>
    disabledRevisionTooltip?: string
    panelMinWidth?: number
    disabled?: boolean
    selectedEvaluatorId?: string | null
    selectedRevisionId?: string | null
    openVersionOnHover?: boolean
}

function getNestedValue(obj: unknown, ...keys: string[]): unknown {
    let current: unknown = obj
    for (const key of keys) {
        if (!current || typeof current !== "object") return undefined
        current = (current as Record<string, unknown>)[key]
    }
    return current
}

function parseOutputMetrics(schema: unknown): OutputMetric[] {
    if (!schema || typeof schema !== "object") return []

    const node = schema as Record<string, unknown>
    const properties = node.properties as Record<string, unknown> | undefined

    if (!properties || typeof properties !== "object") return []

    return Object.entries(properties)
        .map(([name, definition]) => {
            if (!definition || typeof definition !== "object") return null
            return {
                name,
                type: getOutputMetricType(definition),
            }
        })
        .filter(Boolean) as OutputMetric[]
}

function getOutputMetricType(definition: unknown): string {
    if (!definition || typeof definition !== "object") return "unknown"

    const node = definition as Record<string, unknown>
    const explicitType = node.type

    if (typeof explicitType === "string") {
        if (explicitType === "array") {
            const itemType = getOutputMetricType(node.items)
            return itemType === "unknown" ? "array" : `array<${itemType}>`
        }
        return explicitType
    }

    if (Array.isArray(explicitType) && explicitType.every((item) => typeof item === "string")) {
        return explicitType.join(" | ")
    }

    if (Array.isArray(node.enum)) return "enum"
    if (Array.isArray(node.oneOf)) return "union"
    if (Array.isArray(node.anyOf)) return "union"
    if (Array.isArray(node.allOf)) return "composed"

    return "unknown"
}

export function getHumanMetrics(revision: WorkflowRevisionLike): OutputMetric[] {
    const data = revision.data
    const candidates = [
        getNestedValue(data, "schemas", "outputs"),
        getNestedValue(data, "service", "format", "properties", "outputs"),
        getNestedValue(data, "service", "configuration", "outputs"),
        getNestedValue(data, "configuration", "outputs"),
        getNestedValue(data, "service", "configuration", "format", "properties", "outputs"),
        getNestedValue(data, "configuration", "format", "properties", "outputs"),
    ]

    for (const candidate of candidates) {
        const metrics = parseOutputMetrics(candidate)
        if (metrics.length > 0) return metrics
    }

    return []
}

export function formatHumanMetricLabel(metric: OutputMetric): string {
    return `${metric.name}: ${metric.type}`
}

function formatMetricSummary(metrics: OutputMetric[]): string {
    const labels = metrics.map(formatHumanMetricLabel)

    if (labels.length <= 3) return labels.join(", ")

    const visibleMetricNames = labels.slice(0, 3).join(", ")
    return `${visibleMetricNames} +${labels.length - 3}`
}

export function EntityEvaluatorSelector({
    onSelect,
    instanceId,
    buttonLabel = "Add evaluator",
    disabledRevisionIds,
    disabledRevisionTooltip = "Already added",
    panelMinWidth = 280,
    disabled = false,
    selectedEvaluatorId,
    selectedRevisionId,
    openVersionOnHover = false,
}: EntityEvaluatorSelectorProps) {
    const renderRevisionLabel = useCallback((entity: unknown) => {
        const revision = entity as WorkflowRevisionLike
        const isHuman = Boolean(revision.flags?.is_feedback)
        const metrics = isHuman ? getHumanMetrics(revision) : []
        const metricSummary = metrics.length > 0 ? formatMetricSummary(metrics) : null

        return (
            <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate max-w-[180px]" title={revision.name ?? undefined}>
                        {revision.name ?? "Unnamed"}
                    </span>
                    <VersionBadge version={revision.version ?? 0} variant="chip" size="small" />
                </div>
                {metricSummary ? (
                    <span
                        className={`truncate text-xs ${textColors.muted}`}
                        title={metrics.map(formatHumanMetricLabel).join(", ")}
                    >
                        {metricSummary}
                    </span>
                ) : null}
            </div>
        )
    }, [])

    const evaluatorAdapter = useEnrichedHumanEvaluatorAdapter(renderRevisionLabel)

    return (
        <div className="min-w-0 w-full">
            <EntityPicker<WorkflowRevisionSelectionResult>
                variant="popover-cascader"
                adapter={evaluatorAdapter}
                onSelect={onSelect}
                instanceId={instanceId}
                className="!w-full !justify-start"
                placeholder={buttonLabel}
                icon={<Plus size={14} />}
                showDropdownIcon={false}
                panelMinWidth={panelMinWidth}
                disabled={disabled}
                selectedParentId={selectedEvaluatorId}
                selectedChildId={selectedRevisionId}
                disabledChildIds={disabledRevisionIds}
                disabledChildTooltip={disabledRevisionTooltip}
                openChildOnHover={openVersionOnHover}
                size="middle"
            />
        </div>
    )
}
