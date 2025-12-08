import {FolderSimpleIcon} from "@phosphor-icons/react"
import {Modal} from "antd"
import React, {Dispatch, SetStateAction} from "react"

interface DeleteFolderModalProps {
    deleteModalOpen: boolean
    setDeleteModalOpen: Dispatch<SetStateAction<boolean>>
    folderName?: string | null | undefined
}

const DeleteFolderModal = ({
    deleteModalOpen,
    setDeleteModalOpen,
    folderName,
}: DeleteFolderModalProps) => {
    return (
        <Modal
            title="Delete folder"
            open={deleteModalOpen}
            onOk={() => setDeleteModalOpen(false)}
            onCancel={() => setDeleteModalOpen(false)}
            okText="Delete"
            okButtonProps={{danger: true}}
            destroyOnClose
        >
            <div className="flex flex-col gap-3">
                <div className="text-gray-500">Are you sure you want to delete?</div>
                <div className="flex items-center gap-2">
                    <FolderSimpleIcon size={20} />
                    <span className="font-medium">{folderName ?? "Folder"}</span>
                </div>
                <div className="text-gray-500">This action is not reversible.</div>
            </div>
        </Modal>
    )
}

export default DeleteFolderModal
