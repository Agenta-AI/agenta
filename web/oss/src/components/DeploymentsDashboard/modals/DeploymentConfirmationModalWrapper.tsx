import {useAtomValue, useSetAtom} from "jotai"

import DeploymentConfirmationModal from "@/oss/components/DeploymentsDashboard/components/Modal/DeploymentConfirmationModal"
import {
    closeDeploymentConfirmationModalAtom,
    confirmDeploymentAtom,
    deploymentConfirmationStateAtom,
    setDeploymentNoteAtom,
} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"

const DeploymentConfirmationModalWrapper = () => {
    const state = useAtomValue(deploymentConfirmationStateAtom)
    const close = useSetAtom(closeDeploymentConfirmationModalAtom)
    const confirm = useSetAtom(confirmDeploymentAtom)
    const setNote = useSetAtom(setDeploymentNoteAtom)

    return (
        <DeploymentConfirmationModal
            open={state.open}
            onCancel={() => close()}
            envName={state.envName}
            actionType={state.actionType}
            variant={state.variant}
            note={state.note}
            setNote={(n) => setNote(n)}
            okButtonProps={{loading: state.okLoading}}
            onOk={() => confirm()}
        />
    )
}

export default DeploymentConfirmationModalWrapper
