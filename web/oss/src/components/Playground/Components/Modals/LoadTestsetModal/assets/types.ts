import {ModalProps} from "antd"

import {Testset} from "@/oss/lib/Types"

export interface LoadTestsetModalProps extends ModalProps {
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
    testsetData: Record<string, any> | null
    isChat?: boolean
}

export interface LoadTestsetModalContentProps {
    modalProps: LoadTestsetModalProps
    selectedTestset: string
    setSelectedTestset: React.Dispatch<React.SetStateAction<string>>
    selectedRevisionId: string
    setSelectedRevisionId: React.Dispatch<React.SetStateAction<string>>
    testsetCsvData: Testset["csvdata"]
    selectedRowKeys: React.Key[]
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
    isLoadingTestset: boolean
    isChat: boolean
}

export interface LoadTestsetModalFooterProps {
    onClose: () => void
    isLoadingTestset: boolean
    selectedRowKeys: React.Key[]
    testsetCsvData: Testset["csvdata"]
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
}
