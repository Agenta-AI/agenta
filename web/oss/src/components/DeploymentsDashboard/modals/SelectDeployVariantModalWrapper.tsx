import {useAtomValue, useSetAtom} from "jotai"

import SelectDeployVariantModal from "@/oss/components/DeploymentsDashboard/components/Modal/SelectDeployVariantModal"
import {
    closeSelectDeployVariantModalAtom,
    selectDeployVariantStateAtom,
    setSelectedRowKeysAtom,
} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import {openDeploymentConfirmationModalAtom} from "@/oss/components/DeploymentsDashboard/modals/store/deploymentModalsStore"
import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

const SelectDeployVariantModalWrapper = () => {
    const state = useAtomValue(selectDeployVariantStateAtom)
    const close = useSetAtom(closeSelectDeployVariantModalAtom)
    const setKeys = useSetAtom(setSelectedRowKeysAtom)
    const openConfirm = useSetAtom(openDeploymentConfirmationModalAtom)
    const publishMutation = useAtomValue(publishMutationAtom)

    return (
        <SelectDeployVariantModal
            open={state.open}
            onCancel={() => close()}
            variants={state.variants}
            envRevisions={state.envRevisions}
            setIsDeployVariantModalOpen={() => {
                const selectedId = state.selectedRowKeys[0]
                const variant = state.variants.find((v: any) => v.id === selectedId)
                const envName = state.envRevisions?.name || ""
                // Close selector and open confirmation modal
                close()
                openConfirm({
                    variant,
                    envName,
                    actionType: "deploy",
                    onConfirm: async (noteValue) => {
                        const revisionId = selectedId as string
                        await publishMutation.mutateAsync({
                            type: "revision",
                            revision_id: revisionId,
                            environment_ref: envName,
                            note: noteValue,
                        })
                    },
                    onSuccess: () => {
                        // no-op for now; publish mutation invalidates queries globally
                    },
                    successMessage: `Deployment started for ${envName}`,
                })
            }}
            setSelectedRowKeys={(keys) => setKeys(keys as (string | number)[])}
            selectedRowKeys={state.selectedRowKeys}
        />
    )
}

export default SelectDeployVariantModalWrapper
