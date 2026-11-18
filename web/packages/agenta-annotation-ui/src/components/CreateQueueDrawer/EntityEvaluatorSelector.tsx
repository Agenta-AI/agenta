import {useCallback} from "react"

import {
    formatHumanMetricLabel,
    getHumanMetrics,
    type HumanMetric,
    type WorkflowRevisionLike,
} from "@agenta/annotation"
import {
    EntityPicker,
    useEnrichedHumanEvaluatorAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {createT, useT} from "@agenta/i18n"
import queuesCatalog from "@agenta/i18n/catalogs/annotation.queues"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {textColors} from "@agenta/ui/styles"
import {Plus} from "@phosphor-icons/react"

export interface EntityEvaluatorSelectorProps {
    onSelect: (selection: WorkflowRevisionSelectionResult) => void
    instanceId: string
    buttonLabel?: string
    onCreate?: () => void
    createLabel?: string
    panelMinWidth?: number
    panelWidth?: number
    childPanelWidth?: number
    disabled?: boolean
    selectedRevisionIds: Set<string>
    selectedRevisionsByEvaluator: Map<string, {id: string; label: string}[]>
    totalRevisionsByEvaluator: Map<string, number>
    onDeselectRevision: (revisionId: string) => void
    onClearAll: () => void
    openVersionOnHover?: boolean
    defaultOpenVersionPanel?: boolean
}

function formatMetricSummary(metrics: HumanMetric[]): string {
    const labels = metrics.map(formatHumanMetricLabel)

    if (labels.length <= 3) return labels.join(", ")

    const visibleMetricNames = labels.slice(0, 3).join(", ")
    return `${visibleMetricNames} +${labels.length - 3}`
}

const tNow = createT(queuesCatalog)

export function EntityEvaluatorSelector({
    onSelect,
    instanceId,
    buttonLabel,
    onCreate,
    createLabel,
    panelMinWidth = 280,
    panelWidth,
    childPanelWidth,
    disabled = false,
    selectedRevisionIds,
    selectedRevisionsByEvaluator,
    totalRevisionsByEvaluator,
    onDeselectRevision,
    onClearAll,
    openVersionOnHover = true,
    defaultOpenVersionPanel = false,
}: EntityEvaluatorSelectorProps) {
    const t = useT(queuesCatalog)
    const renderRevisionLabel = useCallback((entity: unknown) => {
        const revision = entity as WorkflowRevisionLike
        const isHuman = Boolean(revision.flags?.is_feedback)
        const metrics = isHuman ? getHumanMetrics(revision) : []
        const metricSummary = metrics.length > 0 ? formatMetricSummary(metrics) : null

        return (
            <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate max-w-[180px]" title={revision.name ?? undefined}>
                        {revision.name ?? tNow("annotation.queues.unnamed")}
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

    const evaluatorAdapter = useEnrichedHumanEvaluatorAdapter(renderRevisionLabel, {
        showWorkflowMeta: true,
    })

    return (
        <div className="min-w-0 w-full">
            <EntityPicker<WorkflowRevisionSelectionResult>
                variant="popover-cascader"
                adapter={evaluatorAdapter}
                onSelect={onSelect}
                instanceId={instanceId}
                className="!w-full !justify-start"
                placeholder={buttonLabel ?? t("annotation.queues.addEvaluator")}
                icon={<Plus size={14} />}
                showDropdownIcon={false}
                panelMinWidth={panelMinWidth}
                panelWidth={panelWidth}
                childPanelWidth={childPanelWidth}
                disabled={disabled}
                openChildOnHover={openVersionOnHover}
                defaultOpenChildPanel={defaultOpenVersionPanel}
                multiSelect
                selectedChildIds={selectedRevisionIds}
                selectionSummary
                showParentCheckboxes
                selectedChildrenByParent={selectedRevisionsByEvaluator}
                totalChildrenByParent={totalRevisionsByEvaluator}
                onDeselectChild={onDeselectRevision}
                showParentDescription
                showChildSelectAll
                onClearAll={onClearAll}
                size="middle"
                onCreateNew={onCreate}
                createNewLabel={createLabel ?? t("annotation.queues.createEvaluator")}
            />
        </div>
    )
}
