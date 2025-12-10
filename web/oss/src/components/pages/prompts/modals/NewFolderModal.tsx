import {Input, Modal} from "antd"
import React, {Dispatch, SetStateAction} from "react"

export interface FolderModalState {
    name: string
    description: string
    modalOpen: boolean
    mode: "create" | "rename"
    folderId: string | null
}

interface NewFolderModalProps {
    open: boolean
    folderName: string
    folderSlug: string
    folderPath: string
    description: string
    setNewFolderState: Dispatch<SetStateAction<FolderModalState>>
    onCreate: () => Promise<void> | void
    onCancel: () => void
    confirmLoading?: boolean
    title?: string
    okText?: string
}

const {TextArea} = Input

const NewFolderModal = ({
    open,
    folderName,
    folderSlug,
    folderPath,
    description,
    setNewFolderState,
    onCreate,
    onCancel,
    confirmLoading,
    title = "New folder",
    okText = "Create",
}: NewFolderModalProps) => {
    return (
        <Modal
            title={title}
            open={open}
            onCancel={onCancel}
            onOk={onCreate}
            okText={okText}
            okButtonProps={{loading: confirmLoading, disabled: !folderName.trim()}}
            destroyOnHidden
        >
            <div className="flex flex-col gap-3">
                <div className="text-gray-500">Choose a folder name.</div>

                <Input
                    value={folderName}
                    onChange={(event) =>
                        setNewFolderState((state) => ({...state, name: event.target.value}))
                    }
                    placeholder="Untitled folder"
                    autoFocus
                />

                <div className="text-xs text-gray-400">
                    <span className="font-medium">Slug:</span> {folderSlug}
                </div>

                <div className="text-xs text-gray-400">
                    <span className="font-medium">Folder path:</span> {folderPath}
                </div>

                <div className="mt-2 text-gray-500">Description (optional)</div>
                <TextArea
                    value={description}
                    onChange={(event) =>
                        setNewFolderState((state) => ({...state, description: event.target.value}))
                    }
                    placeholder="Short description of this folder"
                    rows={3}
                />
            </div>
        </Modal>
    )
}

export default NewFolderModal
