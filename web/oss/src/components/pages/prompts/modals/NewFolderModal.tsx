import {Input, Modal} from "antd"
import React, {Dispatch, SetStateAction} from "react"

interface NewFolderModalProps {
    open: boolean
    folderName: string
    setFolderName: Dispatch<SetStateAction<string>>
    onCreate: () => Promise<void>
    onCancel: () => void
    confirmLoading?: boolean
}

const NewFolderModal = ({
    open,
    folderName,
    setFolderName,
    onCreate,
    onCancel,
    confirmLoading,
}: NewFolderModalProps) => {
    return (
        <Modal
            title="New folder"
            open={open}
            onCancel={onCancel}
            onOk={onCreate}
            okText="Create"
            okButtonProps={{loading: confirmLoading}}
            destroyOnClose
        >
            <div className="flex flex-col gap-3">
                <div className="text-gray-500">Choose a folder name.</div>
                <Input
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    placeholder="Untitled folder"
                    autoFocus
                />
            </div>
        </Modal>
    )
}

export default NewFolderModal
