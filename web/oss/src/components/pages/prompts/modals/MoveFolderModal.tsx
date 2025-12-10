import {Modal, Tree} from "antd"
import {DataNode} from "antd/es/tree"
import React from "react"

interface MoveFolderModalProps {
    itemName?: string | null
    open: boolean
    onCancel: () => void
    onMove: () => void
    moveDestinationName: string | null
    treeData: DataNode[]
    moveSelection: string | null
    setMoveSelection: (value: string | null) => void
    isMoving?: boolean
    disabledConfirm?: boolean
}

const MoveFolderModal = ({
    itemName,
    open,
    onCancel,
    onMove,
    moveDestinationName,
    treeData,
    moveSelection,
    setMoveSelection,
    isMoving,
    disabledConfirm,
}: MoveFolderModalProps) => {
    return (
        <Modal
            title="Move to folder"
            open={open}
            onOk={onMove}
            onCancel={onCancel}
            okText={moveDestinationName ? `Move to ${moveDestinationName}` : "Move folder"}
            okButtonProps={{disabled: disabledConfirm, loading: isMoving}}
            destroyOnHidden
        >
            <div className="flex flex-col gap-2">
                <div className="text-gray-500">
                    Moving <span className="font-medium">{itemName || "folder"}</span>
                </div>

                <div className="text-gray-500">Select folder</div>

                <Tree
                    selectable
                    showIcon
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
