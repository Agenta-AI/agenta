import {ModalProps} from "antd"

import {Testset} from "@/oss/lib/Types"

export interface LoadTestsetModalProps extends ModalProps {
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
}

/**
 * Simplified props for LoadTestsetModalContent
 * All state is now managed via atoms in atoms/modalState.ts
 */
export interface LoadTestsetModalContentProps {
    modalProps: ModalProps
}

export interface LoadTestsetModalFooterProps {
    onClose: () => void
    isLoadingTestset: boolean
    selectedRowKeys: React.Key[]
    testsetCsvData: Testset["csvdata"]
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any>[] | null>>
    isCreatingNew: boolean
    newTestsetName: string
}
