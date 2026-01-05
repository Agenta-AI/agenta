import {ModalProps} from "antd"

import {Testset} from "@/oss/lib/Types"

export interface LoadTestsetSelectionPayload {
    testcases: Record<string, any>[]
    revisionId?: string
}

export interface LoadTestsetModalProps extends ModalProps {
    setTestsetData: (payload: LoadTestsetSelectionPayload | null) => void
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
    setTestsetData: (payload: LoadTestsetSelectionPayload | null) => void
    selectedRevisionId: string
    isCreatingNew: boolean
    newTestsetName: string
}
