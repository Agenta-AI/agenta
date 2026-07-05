import {EnhancedModal, ModalFooter} from "@agenta/ui"
import {useAtomValue} from "jotai"

import SelectDeployVariantModalContent, {
    useSelectDeployVariant,
} from "./SelectDeployVariantModalContent"
import {selectDeployVariantStateAtom} from "./store/deploymentModalsStore"

const SelectDeployVariantModalWrapper = () => {
    const state = useAtomValue(selectDeployVariantStateAtom)
    const {
        close,
        isPending,
        isAlreadyDeployed,
        currentDeployment,
        selectedRowKeys,
        setSelectedRowKeys,
        selectedRowRef,
        note,
        setNote,
        handleDeploy,
    } = useSelectDeployVariant()

    return (
        <EnhancedModal
            open={state.open}
            onCancel={close}
            title={
                <span className="text-lg font-semibold leading-relaxed capitalize">
                    Deploy {state.envName}
                </span>
            }
            footer={
                <ModalFooter
                    onCancel={close}
                    onConfirm={handleDeploy}
                    confirmLabel="Deploy"
                    canConfirm={selectedRowKeys.length > 0 && !isAlreadyDeployed}
                    isLoading={isPending}
                />
            }
            width={1000}
            styles={{
                body: {
                    maxHeight: "calc(80vh - 110px)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                },
            }}
        >
            <SelectDeployVariantModalContent
                selectedRowKeys={selectedRowKeys}
                setSelectedRowKeys={setSelectedRowKeys}
                selectedRowRef={selectedRowRef}
                note={note}
                setNote={setNote}
                envName={state.envName}
                currentDeployment={currentDeployment}
            />
        </EnhancedModal>
    )
}

export default SelectDeployVariantModalWrapper
