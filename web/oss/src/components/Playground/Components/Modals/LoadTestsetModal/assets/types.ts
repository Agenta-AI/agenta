import {TestSet} from "@/oss/lib/Types"
import {ModalProps} from "antd"

export interface LoadTestsetModalProps extends ModalProps {
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
    testsetData: Record<string, any> | null
    isChat?: boolean
}

export interface LoadTestsetModalContentProps {
    modalProps: LoadTestsetModalProps
    selectedTestset: string
    setSelectedTestset: React.Dispatch<React.SetStateAction<string>>
    testsetCsvData: TestSet["csvdata"]
    selectedRowKeys: React.Key[]
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
    isLoadingTestset: boolean
    isChat: boolean
}

export interface LoadTestsetModalFooterProps {
    onClose: () => void
    isLoadingTestset: boolean
    selectedRowKeys: React.Key[]
    testsetCsvData: TestSet["csvdata"]
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
}
