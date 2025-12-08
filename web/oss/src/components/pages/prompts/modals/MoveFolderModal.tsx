import {Modal, Tree} from "antd"
import {DataNode} from "antd/es/tree"
import React, {SetStateAction} from "react"

interface MoveFolderModalProps {
    foldername?: string | null | undefined
    moveModalOpen: boolean
    setMoveModalOpen: (value: SetStateAction<boolean>) => void
    moveDestinationName: string | null
    treeData: DataNode[]
    moveSelection: string | null
    setMoveSelection: (value: SetStateAction<string | null>) => void
}

const MoveFolderModal = ({
    foldername,
    moveModalOpen,
    setMoveModalOpen,
    moveDestinationName,
    treeData,
    moveSelection,
    setMoveSelection,
}: MoveFolderModalProps) => {
    return (
        <Modal
            title={`Move ${foldername || "folder"}`}
            open={moveModalOpen}
            onOk={() => setMoveModalOpen(false)}
            onCancel={() => setMoveModalOpen(false)}
            okText={moveDestinationName ? `Move to ${moveDestinationName}` : "Move"}
            destroyOnClose
        >
            <div className="flex flex-col gap-2">
                <div className="text-gray-500">Select the destination folder.</div>
                <Tree
                    selectable
                    treeData={treeData}
                    selectedKeys={moveSelection ? [moveSelection] : []}
                    onSelect={(keys) => setMoveSelection((keys[0] as string) || null)}
                    defaultExpandAll
                />
            </div>
        </Modal>
    )
}

export default MoveFolderModal
