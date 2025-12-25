import {ModalProps} from "antd"

import {Testset} from "@/oss/lib/Types"

export interface LoadTestsetModalProps extends ModalProps {
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
}

export interface LoadTestsetModalContentProps {
    modalProps: ModalProps
    testsetCsvData: Testset["csvdata"]
    selectedRowKeys: React.Key[]
    setSelectedRowKeys: React.Dispatch<React.SetStateAction<React.Key[]>>
    isLoadingTestset: boolean
}

export interface LoadTestsetModalFooterProps {
    onClose: () => void
    isLoadingTestset: boolean
    selectedRowKeys: React.Key[]
    testsetCsvData: Testset["csvdata"]
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
}
