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

import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {AnnotateDrawerSteps} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/enum"

import {
    closeHumanEvaluatorDrawerAtom,
    humanEvaluatorDrawerCallbackAtom,
    humanEvaluatorDrawerRevisionIdAtom,
    humanEvaluatorDrawerModeAtom,
    humanEvaluatorDrawerOpenAtom,
} from "./store"

const AnnotateDrawer = dynamic(() => import("@/oss/components/SharedDrawers/AnnotateDrawer"), {
    ssr: false,
})

const HumanEvaluatorDrawer = () => {
    const isOpen = useAtomValue(humanEvaluatorDrawerOpenAtom)
    const mode = useAtomValue(humanEvaluatorDrawerModeAtom)
    const revisionId = useAtomValue(humanEvaluatorDrawerRevisionIdAtom)

    // Read full entity data through the molecule using the revision ID
    // passed directly by the caller (table row). No extra fetch needed.
    const entityData = useAtomValue(workflowMolecule.selectors.data(revisionId ?? ""))
    const evaluatorWorkflow = mode === "edit" && revisionId ? entityData : null
    const onSuccessCallback = useAtomValue(humanEvaluatorDrawerCallbackAtom)
    const closeDrawer = useSetAtom(closeHumanEvaluatorDrawerAtom)

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    const handleSuccess = useCallback(
        async (slug?: string) => {
            closeDrawer()
            onSuccessCallback?.(slug)
        },
        [closeDrawer, onSuccessCallback],
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
