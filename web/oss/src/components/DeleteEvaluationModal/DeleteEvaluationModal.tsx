import {useCallback, useRef, useState} from "react"
import type {MouseEvent} from "react"

import EnhancedModal from "@agenta/oss/src/components/EnhancedUIs/Modal"
import {DeleteOutlined} from "@ant-design/icons"

import DeleteEvaluationModalContent from "./DeleteEvaluationModalContent"
import {DeleteEvaluationModalProps} from "./types"

const DeleteEvaluationModal = ({
    evaluationType,
    isMultiple = false,
    deletionConfig,
    confirmLoading,
    onOk,
    ...props
}: DeleteEvaluationModalProps) => {
    const [internalLoading, setInternalLoading] = useState(false)
    const mergedConfirmLoading = confirmLoading ?? internalLoading

    const contentOkHandlerRef = useRef<(() => Promise<void> | void) | null>(null)

    const handleOk = useCallback(
        async (event: MouseEvent<HTMLButtonElement>) => {
            if (onOk) {
                await onOk(event)
                return
            }

            if (contentOkHandlerRef.current) {
                await contentOkHandlerRef.current()
            }
        },
        [onOk],
    )

    return (
        <EnhancedModal
            {...props}
            onOk={handleOk}
            okText={"Delete"}
            okType="danger"
            okButtonProps={{icon: <DeleteOutlined />, type: "primary"}}
            centered
            zIndex={2000}
            confirmLoading={mergedConfirmLoading}
        >
            <DeleteEvaluationModalContent
                evaluationType={evaluationType}
                isMultiple={isMultiple}
                deletionConfig={deletionConfig}
                onLoadingChange={setInternalLoading}
                registerOkHandler={(handler) => {
                    contentOkHandlerRef.current = handler
                }}
            />
        </EnhancedModal>
    )
}

export default DeleteEvaluationModal

export {default as DeleteEvaluationModalButton} from "./DeleteEvaluationModalButton"
