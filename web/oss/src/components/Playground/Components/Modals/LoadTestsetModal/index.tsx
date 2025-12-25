import {useCallback, useEffect, useState} from "react"

import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {resetSelectionAtom, selectedRevisionIdAtom} from "@/oss/state/testsetSelection"

import {LoadTestsetModalProps} from "./assets/types"
import {useSelectedTestcasesData} from "./hooks/useSelectedTestcasesData"

const LoadTestsetModalFooter = dynamic(() => import("./assets/LoadTestsetModalFooter"), {
    ssr: false,
})
const LoadTestsetModalContent = dynamic(() => import("./assets/LoadTestsetModalContent"), {
    ssr: false,
})

const LoadTestsetModal: React.FC<LoadTestsetModalProps> = ({setTestsetData, ...props}) => {
    const {onCancel, afterClose, ...modalProps} = props

    // Use shared atoms for testset/revision selection
    const selectedRevisionId = useAtomValue(selectedRevisionIdAtom)
    const resetSelection = useSetAtom(resetSelectionAtom)

    // Row selection is modal-specific (not shared)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    // Extract selected testcases from entity atoms in playground format
    const selectedTestcasesData = useSelectedTestcasesData(selectedRevisionId, selectedRowKeys)

    const isLoadingTestset = false

    // Reset selection state when modal opens
    useEffect(() => {
        if (modalProps.open) {
            // Reset row selection when modal opens
            setSelectedRowKeys([])
        }
    }, [modalProps.open])

    const onClose = useCallback(() => {
        onCancel?.({} as any)
        setSelectedRowKeys([])
    }, [onCancel])

    return (
        <EnhancedModal
            width={1150}
            styles={{
                body: {
                    flex: "0 0 auto",
                },
            }}
            afterClose={() => {
                setSelectedRowKeys([])
                resetSelection()
                afterClose?.()
            }}
            title="Load testset"
            footer={
                <LoadTestsetModalFooter
                    onClose={onClose}
                    isLoadingTestset={isLoadingTestset}
                    selectedRowKeys={selectedRowKeys}
                    testsetCsvData={selectedTestcasesData}
                    setTestsetData={setTestsetData}
                />
            }
            onCancel={onClose}
            classNames={{
                body: "h-[620px] overflow-hidden !flex-0 !flex",
            }}
            {...modalProps}
        >
            <LoadTestsetModalContent
                modalProps={modalProps}
                testsetCsvData={selectedTestcasesData}
                selectedRowKeys={selectedRowKeys}
                setSelectedRowKeys={setSelectedRowKeys}
                isLoadingTestset={isLoadingTestset}
            />
        </EnhancedModal>
    )
}

export default LoadTestsetModal
