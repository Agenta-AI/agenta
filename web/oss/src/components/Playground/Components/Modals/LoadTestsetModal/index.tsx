import dynamic from "next/dynamic"
import {useCallback, useMemo, useState} from "react"

import {useAtomValue} from "jotai"

import {TestSet} from "@/oss/lib/Types"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {testsetCsvDataQueryAtomFamily} from "./assets/testsetCsvData"
import {LoadTestsetModalProps} from "./assets/types"

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
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    // Fetch testset CSV data via atomWithQuery
    const testsetCsvQuery = useAtomValue(
        useMemo(
            () =>
                testsetCsvDataQueryAtomFamily({
                    testsetId: selectedTestset,
                    enabled: modalProps.open && !!selectedTestset,
                }),
            [selectedTestset, modalProps.open],
        ),
    )

    const testsetCsvData: TestSet["csvdata"] = useMemo(
        () => ((testsetCsvQuery as any)?.data as TestSet["csvdata"]) || [],
        [testsetCsvQuery],
    )
    const isLoadingTestset = useMemo(
        () => !!(testsetCsvQuery as any)?.isLoading || !!(testsetCsvQuery as any)?.isPending,
        [testsetCsvQuery],
    )

    const onClose = useCallback(() => {
        onCancel?.({} as any)
        setSelectedRowKeys([])
    }, [])

    return (
        <EnhancedModal
            width={1150}
            className={"[&_.ant-modal-body]:h-[600px]"}
            afterClose={() => {
                setSelectedRowKeys([])
                afterClose?.()
            }}
            title="Load test set"
            footer={
                <LoadTestsetModalFooter
                    onClose={onClose}
                    isLoadingTestset={isLoadingTestset}
                    selectedRowKeys={selectedRowKeys}
                    testsetCsvData={testsetCsvData}
                    setTestsetData={setTestsetData}
                />
            }
            onCancel={onClose}
            {...modalProps}
        >
            <LoadTestsetModalContent
                modalProps={modalProps}
                selectedTestset={selectedTestset}
                setSelectedTestset={setSelectedTestset}
                testsetCsvData={testsetCsvData}
                selectedRowKeys={selectedRowKeys}
                setSelectedRowKeys={setSelectedRowKeys}
                isChat={isChat}
                isLoadingTestset={isLoadingTestset}
            />
        </EnhancedModal>
    )
}

export default LoadTestsetModal
