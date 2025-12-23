import {useCallback, useState} from "react"

import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {LoadTestsetModalProps} from "./assets/types"
import {useSelectedTestcasesData} from "./hooks/useSelectedTestcasesData"

const LoadTestsetModalFooter = dynamic(() => import("./assets/LoadTestsetModalFooter"), {
    ssr: false,
})
const LoadTestsetModalContent = dynamic(() => import("./assets/LoadTestsetModalContent"), {
    ssr: false,
})

const LoadTestsetModal: React.FC<LoadTestsetModalProps> = ({
    testsetData,
    setTestsetData,
    isChat = false,
    ...props
}) => {
    const {onCancel, afterClose, ...modalProps} = props
    const [selectedTestset, setSelectedTestset] = useState("")
    const [selectedRevisionId, setSelectedRevisionId] = useState("")
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    // Extract selected testcases from entity atoms in playground format
    const selectedTestcasesData = useSelectedTestcasesData(selectedRevisionId, selectedRowKeys)

    const isLoadingTestset = false

    const onClose = useCallback(() => {
        onCancel?.({} as any)
        setSelectedRowKeys([])
    }, [])

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
                selectedTestset={selectedTestset}
                setSelectedTestset={setSelectedTestset}
                selectedRevisionId={selectedRevisionId}
                setSelectedRevisionId={setSelectedRevisionId}
                testsetCsvData={selectedTestcasesData}
                selectedRowKeys={selectedRowKeys}
                setSelectedRowKeys={setSelectedRowKeys}
                isChat={isChat}
                isLoadingTestset={isLoadingTestset}
            />
        </EnhancedModal>
    )
}

export default LoadTestsetModal
