import {memo} from "react"

import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {DeleteEvaluatorsModalProps} from "./types"

const DeleteEvaluatorsModalContent = dynamic(
    () => import("./assets/DeleteEvaluatorsModalContent"),
    {ssr: false},
)

const DeleteEvaluatorsModal = ({
    selectedCount,
    revisionIds,
    confirmLoading = false,
    onConfirm,
    open,
    onCancel,
    okButtonProps,
    ...modalProps
}: DeleteEvaluatorsModalProps) => {
    return (
        <EnhancedModal
            centered
            open={open}
            onCancel={onCancel}
            okText="Delete"
            cancelText="Cancel"
            onOk={onConfirm}
            title={selectedCount === 1 ? "Delete evaluator" : "Delete evaluators"}
            width={480}
            okButtonProps={{
                ...okButtonProps,
                danger: true,
                loading: confirmLoading,
            }}
            {...modalProps}
        >
            <DeleteEvaluatorsModalContent selectedCount={selectedCount} revisionIds={revisionIds} />
        </EnhancedModal>
    )
}

export default memo(DeleteEvaluatorsModal)
