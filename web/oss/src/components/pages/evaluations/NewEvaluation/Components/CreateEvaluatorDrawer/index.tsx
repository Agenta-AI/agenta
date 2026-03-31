/**
 * CreateEvaluatorDrawer
 *
 * A drawer wrapper for the ConfigureEvaluator component that allows inline
 * evaluator creation within the NewEvaluation modal.
 *
 * This drawer is opened when a user selects an evaluator template from the
 * EvaluatorTemplateDropdown in the SelectEvaluatorSection.
 *
 * State is managed via Jotai atoms (see ConfigureEvaluator/state/atoms.ts):
 * - evaluatorDrawerOpenAtom: controls drawer visibility
 * - openEvaluatorDrawerAtom: action to open drawer with an evaluator
 * - closeEvaluatorDrawerAtom: action to close drawer and reset state
 */
import {memo, useCallback, useEffect, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"

import {
    closeEvaluatorDrawerAtom,
    evaluatorDrawerOpenAtom,
    playgroundEditValuesAtom,
} from "../../../autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms"

const ConfigureEvaluator = dynamic(
    () =>
        import("@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator"),
    {ssr: false},
)

interface CreateEvaluatorDrawerProps {
    /** Callback after successful evaluator creation. Called with the new config ID. */
    onEvaluatorCreated?: (configId?: string) => void
}

const CreateEvaluatorDrawer = ({onEvaluatorCreated}: CreateEvaluatorDrawerProps) => {
    const isOpen = useAtomValue(evaluatorDrawerOpenAtom)
    const editValues = useAtomValue(playgroundEditValuesAtom)
    const closeDrawer = useSetAtom(closeEvaluatorDrawerAtom)
    const [isTestPanelOpen, setIsTestPanelOpen] = useState(false)

    // Reset drawer-only UI state when opening/closing
    useEffect(() => {
        if (!isOpen) setIsTestPanelOpen(false)
    }, [isOpen])

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    const handleSuccess = useCallback(() => {
        // Get the config ID from the committed playground state
        const configId = editValues?.id
        // Close the drawer first
        closeDrawer()
        // Then notify the parent with the new config ID
        onEvaluatorCreated?.(configId)
    }, [editValues?.id, closeDrawer, onEvaluatorCreated])

    return (
        <EnhancedDrawer
            open={isOpen}
            onClose={handleClose}
            width={isTestPanelOpen ? "clamp(1155px, 92vw, 1600px)" : 800}
            destroyOnHidden
            title={null}
            closable={false}
            styles={{body: {padding: 0}}}
        >
            {isOpen && (
                <ConfigureEvaluator
                    onClose={handleClose}
                    onSuccess={handleSuccess}
                    containerClassName="flex flex-col w-full h-full"
                    uiVariant="drawer"
                    isTestPanelOpen={isTestPanelOpen}
                    onToggleTestPanel={() => setIsTestPanelOpen((v) => !v)}
                />
            )}
        </EnhancedDrawer>
    )
}

export default memo(CreateEvaluatorDrawer)
