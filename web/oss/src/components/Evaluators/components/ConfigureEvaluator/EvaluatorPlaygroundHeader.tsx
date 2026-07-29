/**
 * EvaluatorPlaygroundHeader
 *
 * Header for the evaluator configuration page: the evaluator name plus the
 * shared run controls. The controls (run-on selector, app picker, testset)
 * live in `EvaluatorRunControls` so the page and the creation drawer share one
 * implementation. Reads evaluator info from playground nodes (URL-driven).
 */

import {useMemo} from "react"

import {workflowDetailQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import EvaluatorRunControls from "./EvaluatorRunControls"

const EvaluatorPlaygroundHeader: React.FC = () => {
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

    // The entity display name lives on the workflow artifact; the revision's
    // own `name` carries the variant name ("default").
    const workflowId = evaluatorData?.workflow_id ?? null
    const artifactName = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.artifactName(evaluatorEntityId),
            [evaluatorEntityId],
        ),
    )
    // Workflow-keyed detail query (cache-shared) — the molecule's slug selector
    // is revision-keyed and fires a guaranteed-null /revisions/query for a workflow id.
    const workflowDetail = useAtomValue(workflowDetailQueryAtomFamily(workflowId))
    const workflowSlug = workflowDetail.data?.slug ?? null
    const evaluatorName =
        artifactName?.trim() || workflowSlug?.trim() || evaluatorData?.slug?.trim() || "Evaluator"

    return (
        <div className="flex items-center justify-between gap-4 px-2.5 py-2 bg-[var(--ag-rgba-000-02)] border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]">
            <div className="flex shrink-0 items-center gap-2 pl-2">
                <Typography className="whitespace-nowrap text-[16px] leading-[18px] font-[600]">
                    {evaluatorName}
                </Typography>
            </div>

            <EvaluatorRunControls />
        </div>
    )
}

export default EvaluatorPlaygroundHeader
