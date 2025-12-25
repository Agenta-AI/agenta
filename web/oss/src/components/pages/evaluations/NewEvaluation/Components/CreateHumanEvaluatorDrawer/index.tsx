/**
 * CreateHumanEvaluatorDrawer
 *
 * A drawer wrapper that uses the AnnotateDrawer component to allow inline
 * human evaluator creation within the NewEvaluation modal.
 *
 * This drawer is opened when a user clicks "Create new" in the evaluator
 * selection section when in preview/human evaluation mode.
 *
 * State is managed via Jotai atoms (see ./state.ts):
 * - humanEvaluatorDrawerOpenAtom: controls drawer visibility
 * - openHumanEvaluatorDrawerAtom: action to open drawer
 * - closeHumanEvaluatorDrawerAtom: action to close drawer
 */
import {memo, useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {AnnotateDrawerSteps} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/enum"

import {closeHumanEvaluatorDrawerAtom, humanEvaluatorDrawerOpenAtom} from "./state"

const AnnotateDrawer = dynamic(() => import("@/oss/components/SharedDrawers/AnnotateDrawer"), {
    ssr: false,
})

interface CreateHumanEvaluatorDrawerProps {
    /** Callback after successful evaluator creation. Called with the evaluator slug. */
    onEvaluatorCreated?: (slug?: string) => void
}

const CreateHumanEvaluatorDrawer = ({onEvaluatorCreated}: CreateHumanEvaluatorDrawerProps) => {
    const isOpen = useAtomValue(humanEvaluatorDrawerOpenAtom)
    const closeDrawer = useSetAtom(closeHumanEvaluatorDrawerAtom)

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    const handleSuccess = useCallback(
        async (slug?: string) => {
            // Close the drawer first
            closeDrawer()
            // Then notify the parent with the new evaluator slug
            onEvaluatorCreated?.(slug)
        },
        [closeDrawer, onEvaluatorCreated],
    )

    const createEvaluatorProps = useMemo(
        () => ({
            mode: "create" as const,
            onSuccess: handleSuccess,
            skipPostCreateStepChange: true,
        }),
        [handleSuccess],
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

export default memo(CreateHumanEvaluatorDrawer)
