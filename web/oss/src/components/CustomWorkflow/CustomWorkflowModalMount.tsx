import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import CustomWorkflowModal from "@/oss/components/pages/app-management/modals/CustomWorkflowModal"
import {
    customWorkflowModalStateAtom,
    closeCustomWorkflowModalAtom,
} from "@/oss/state/customWorkflow/modalAtoms"

const CustomWorkflowModalMount = () => {
    const state = useAtomValue(customWorkflowModalStateAtom)
    const close = useSetAtom(closeCustomWorkflowModalAtom)
    const onCancel = useCallback(() => close(), [close])

    return (
        <CustomWorkflowModal
            open={state.open}
            appId={state.appId}
            onCancel={onCancel}
            onSuccess={state.onSuccess}
            onCreateApp={state.onCreateApp}
        />
    )
}

export default CustomWorkflowModalMount
