/**
 * HumanEvaluatorDrawer
 *
 * A globally-mounted drawer that wraps the AnnotateDrawer component
 * for human evaluator creation and editing.
 *
 * Modes:
 * - "create": New human evaluator (via NewEvaluation modal or evaluators page)
 * - "edit": Edit existing human evaluator (via evaluators table row click)
 */
import {memo, useCallback, useMemo} from "react"

import {workflowArtifactQueryAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {getDefaultStore} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {AnnotateDrawerSteps} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/enum"

import {
    closeHumanEvaluatorDrawerAtom,
    humanEvaluatorDrawerCallbackAtom,
    humanEvaluatorDrawerRevisionIdAtom,
    humanEvaluatorDrawerWorkflowIdAtom,
    humanEvaluatorDrawerModeAtom,
    humanEvaluatorDrawerOpenAtom,
} from "./store"

const AnnotateDrawer = dynamic(() => import("@/oss/components/SharedDrawers/AnnotateDrawer"), {
    ssr: false,
})

const HumanEvaluatorDrawer = () => {
    const isOpen = useAtomValue(humanEvaluatorDrawerOpenAtom)
    const mode = useAtomValue(humanEvaluatorDrawerModeAtom)
    const workflowId = useAtomValue(humanEvaluatorDrawerWorkflowIdAtom)
    const revisionId = useAtomValue(humanEvaluatorDrawerRevisionIdAtom)

    // Read full entity data through the molecule using the revision ID
    // passed directly by the caller (table row). No extra fetch needed.
    const entityData = useAtomValue(workflowMolecule.selectors.data(revisionId ?? ""))
    // Identity fields must come from the ARTIFACT: the revision's `name` is
    // the variant name ("default"), and the form writes the prefilled name
    // back to the artifact via PUT /workflows/{id} on save — prefilling from
    // the revision would permanently rename the evaluator to "default".
    const artifactQuery = useAtomValue(
        workflowArtifactQueryAtomFamily(workflowId ?? entityData?.workflow_id ?? ""),
    )
    const artifact = artifactQuery.data
    // Override `id` with the workflow ID — the entity data is keyed by
    // revision ID, but CreateEvaluator uses `evaluator.id` for the
    // update API call which expects a workflow ID.
    const evaluatorWorkflow =
        mode === "edit" && revisionId && entityData
            ? {
                  ...entityData,
                  id: workflowId ?? entityData.workflow_id ?? entityData.id,
                  name: artifact?.name ?? entityData.name,
                  slug: artifact?.slug ?? entityData.slug,
                  description: artifact?.description ?? entityData.description,
              }
            : null
    const closeDrawer = useSetAtom(closeHumanEvaluatorDrawerAtom)

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    const handleSuccess = useCallback(
        async (slug?: string) => {
            // Read callback imperatively from the Jotai store to avoid stale
            // closures — the atom value can be lost when React re-renders
            // (e.g. due to HMR or unrelated state changes) between drawer
            // open and form submit.
            const cb = getDefaultStore().get(humanEvaluatorDrawerCallbackAtom)
            closeDrawer()
            cb?.(slug)
        },
        [closeDrawer],
    )

    const createEvaluatorProps = useMemo(
        () => ({
            mode,
            evaluator: mode === "edit" ? evaluatorWorkflow || undefined : undefined,
            onSuccess: handleSuccess,
            skipPostCreateStepChange: mode === "create",
        }),
        [mode, evaluatorWorkflow, handleSuccess],
    )

    return (
        <AnnotateDrawer
            open={isOpen}
            onClose={handleClose}
            showOnly={{createEvaluatorUi: true}}
            initialStep={AnnotateDrawerSteps.CREATE_EVALUATOR}
            createEvaluatorProps={createEvaluatorProps}
            closeOnLayoutClick={false}
        />
    )
}

export default memo(HumanEvaluatorDrawer)
