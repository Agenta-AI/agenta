/**
 * EvaluatorPlaygroundHeader
 *
 * Simplified playground header for the evaluator configuration page.
 * Shows evaluator name, app workflow selector, and testset dropdown.
 * Reads evaluator info from playground nodes (URL-driven, no props needed).
 */

import {useCallback, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import type {
    EntitySelectionAdapter,
    WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

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
    const router = useRouter()
    const {projectURL} = useURL()

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

    // Evaluator name from molecule data
    const evaluatorData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(evaluatorEntityId), [evaluatorEntityId]),
    )
    const evaluatorName = evaluatorData?.name?.trim() || evaluatorData?.slug?.trim() || "Evaluator"

    // Selected app label for display in the picker trigger
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)

    // Check if we have an app node (depth-0 with a different entity than evaluator)
    const hasAppSelected = nodes.some((n) => n.depth === 0 && n.entityId !== evaluatorEntityId)

    const navigateBack = useCallback(() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back()
            return
        }
        router.push(`${projectURL}/evaluators`)
    }, [projectURL, router])

    return (
        <div className="flex items-center justify-between gap-4 px-2.5 py-2 bg-[rgba(0,0,0,0.02)] border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <div className="flex shrink-0 items-center gap-2">
                <Button
                    type="text"
                    size="small"
                    icon={<ArrowLeft size={16} />}
                    onClick={navigateBack}
                />
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
