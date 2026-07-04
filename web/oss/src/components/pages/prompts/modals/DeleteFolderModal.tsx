import React from "react"

import {EnhancedModal} from "@agenta/ui/components/modal"
import {FolderFilled} from "@ant-design/icons"
import {TrashIcon} from "@phosphor-icons/react"
import {Button} from "antd"

interface DeleteFolderModalProps {
    open: boolean
    folderName?: string | null
    onCancel: () => void
    onConfirm: () => void
    confirmLoading?: boolean
}

const DeleteFolderModal = ({
    open,
    folderName,
    onCancel,
    onConfirm,
    confirmLoading,
}: DeleteFolderModalProps) => {
    return (
        <EnhancedModal open={open} onCancel={onCancel} footer={null} destroyOnHidden centered>
            <div className="flex flex-col gap-4">
                <div className="text-xl font-semibold">Are you sure you want to delete?</div>

                <div className="text-gray-500">This action is not reversible.</div>

                <div className="text-gray-500">
                    <div>You are about to delete:</div>
                    <div className="mt-2 flex items-center gap-2">
                        <FolderFilled style={{fontSize: 16, color: "#BDC7D1"}} />
                        <span className="font-medium">{folderName || "this folder"}</span>
                    </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <Button onClick={onCancel}>Cancel</Button>
                    <Button
                        type="primary"
                        danger
                        icon={<TrashIcon size={16} />}
                        onClick={onConfirm}
                        loading={confirmLoading}
                    >
                        Delete
                    </Button>
                </div>
            </div>
        </EnhancedModal>
    )
}

export default DeleteFolderModal
