import {useCallback, useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {resetSelectionAtom, selectedRevisionIdAtom} from "@/oss/state/testsetSelection"

import {LoadTestsetModalProps} from "./assets/types"
import {
    isCreatingNewTestsetAtom,
    newTestsetNameAtom,
    resetModalStateAtom,
    selectedTestcaseRowKeysAtom,
} from "./atoms/modalState"
import {useSelectedTestcasesData} from "./hooks/useSelectedTestcasesData"

const LoadTestsetModalFooter = dynamic(() => import("./assets/LoadTestsetModalFooter"), {
    ssr: false,
})
const LoadTestsetModalContent = dynamic(() => import("./assets/LoadTestsetModalContent"), {
    ssr: false,
})

const LoadTestsetModal: React.FC<LoadTestsetModalProps> = ({setTestsetData, ...props}) => {
    const {onCancel, afterClose, ...modalProps} = props

    // Use atoms for all modal state
    const selectedRevisionId = useAtomValue(selectedRevisionIdAtom)
    const selectedRowKeys = useAtomValue(selectedTestcaseRowKeysAtom)
    const isCreatingNew = useAtomValue(isCreatingNewTestsetAtom)
    const newTestsetName = useAtomValue(newTestsetNameAtom)
    const resetSelection = useSetAtom(resetSelectionAtom)
    const resetModalState = useSetAtom(resetModalStateAtom)

    // Extract selected testcases from entity atoms in playground format
    const selectedTestcasesData = useSelectedTestcasesData(selectedRevisionId, selectedRowKeys)

    const isLoadingTestset = false

    // Reset state when modal opens
    useEffect(() => {
        if (modalProps.open) {
            resetModalState()
        }
    }, [modalProps.open, resetModalState])

    const onClose = useCallback(() => {
        onCancel?.({} as any)
        resetModalState()
    }, [onCancel, resetModalState])

    return (
        <EnhancedModal
            width={1150}
            styles={{
                body: {
                    flex: "1 1 auto",
                    height: 620,
                },
            }}
            afterClose={() => {
                resetModalState()
                resetSelection()
                afterClose?.()
            }}
            title={isCreatingNew ? "Create testset" : "Load testset"}
            footer={
                <LoadTestsetModalFooter
                    onClose={onClose}
                    isLoadingTestset={isLoadingTestset}
                    selectedRowKeys={selectedRowKeys}
                    testsetCsvData={selectedTestcasesData}
                    setTestsetData={setTestsetData}
                    selectedRevisionId={selectedRevisionId}
                    isCreatingNew={isCreatingNew}
                    newTestsetName={newTestsetName}
                />
            }
            onCancel={onClose}
            classNames={{
                body: "overflow-hidden !flex",
            }}
            {...modalProps}
        >
            <LoadTestsetModalContent modalProps={modalProps} />
        </EnhancedModal>
    )
}

export default LoadTestsetModal
