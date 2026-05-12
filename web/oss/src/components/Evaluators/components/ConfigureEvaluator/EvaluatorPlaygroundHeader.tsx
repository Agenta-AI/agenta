/**
 * EvaluatorPlaygroundHeader
 *
 * Simplified playground header for the evaluator configuration page.
 * Shows evaluator name, app workflow selector, and testset dropdown.
 * Reads evaluator info from playground nodes (URL-driven, no props needed).
 */

import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import type {
    EntitySelectionAdapter,
    WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {selectedAppLabelAtom} from "./atoms"

const TestsetDropdown = dynamic(
    () => import("@/oss/components/Playground/Components/TestsetDropdown"),
    {ssr: false},
)

interface EvaluatorPlaygroundHeaderProps {
    appWorkflowAdapter: EntitySelectionAdapter<WorkflowRevisionSelectionResult>
    onAppSelect: (selection: WorkflowRevisionSelectionResult) => void
}

const EvaluatorPlaygroundHeader: React.FC<EvaluatorPlaygroundHeaderProps> = ({
    appWorkflowAdapter,
    onAppSelect,
}) => {
    // Read evaluator node from playground nodes
    // Phase 1: evaluator is at depth 0 (primary)
    // Phase 2: evaluator is at depth 1 (downstream)
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const evaluatorNode = useMemo(() => {
        const downstream = nodes.find((n) => n.depth > 0)
        if (downstream) return downstream
        return nodes[0] ?? null
    }, [nodes])

    const evaluatorEntityId = evaluatorNode?.entityId ?? ""

    // Evaluator revision data (to get workflow_id)
    const evaluatorData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(evaluatorEntityId), [evaluatorEntityId]),
    )

    // Read the workflow-level name (not the revision name, which may be a variant name).
    // The workflow entity is seeded by the evaluator list page. For direct URL navigation
    // where the workflow entity may not be seeded, fall back to the revision's own name.
    const workflowId = evaluatorData?.workflow_id ?? evaluatorEntityId
    const workflowName = useAtomValue(
        useMemo(() => workflowMolecule.selectors.name(workflowId), [workflowId]),
    )
    const workflowSlug = useAtomValue(
        useMemo(() => workflowMolecule.selectors.slug(workflowId), [workflowId]),
    )
    const evaluatorName =
        workflowName?.trim() ||
        workflowSlug?.trim() ||
        evaluatorData?.name?.trim() ||
        evaluatorData?.slug?.trim() ||
        "Evaluator"

    // Selected app label for display in the picker trigger
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)

    // Check if we have an app node (depth-0 with a different entity than evaluator)
    const hasAppSelected = nodes.some((n) => n.depth === 0 && n.entityId !== evaluatorEntityId)

    return (
        <div className="flex items-center justify-between gap-4 px-2.5 py-2 bg-[rgba(0,0,0,0.02)] border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <div className="flex shrink-0 items-center gap-2 pl-2">
                <Typography className="whitespace-nowrap text-[16px] leading-[18px] font-[600]">
                    {evaluatorName}
                </Typography>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <EntityPicker<WorkflowRevisionSelectionResult>
                    variant="popover-cascader"
                    adapter={appWorkflowAdapter}
                    onSelect={onAppSelect}
                    size="small"
                    placeholder={selectedAppLabel ?? "Select app"}
                />
                {hasAppSelected && <TestsetDropdown />}
            </div>
        </div>
    )
}

export default EvaluatorPlaygroundHeader
