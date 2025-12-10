import {Modal, Tree} from "antd"
import {DataNode} from "antd/es/tree"
import React from "react"

interface MoveItemModalProps {
    itemName?: string | null
    itemLabel?: string
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

const MoveItemModal = ({
    itemName,
    itemLabel = "item",
    open,
    onCancel,
    onMove,
    moveDestinationName,
    treeData,
    moveSelection,
    setMoveSelection,
    isMoving,
    disabledConfirm,
}: MoveItemModalProps) => {
    return (
        <Modal
            title={`Move ${itemLabel}`}
            open={open}
            onOk={onMove}
            onCancel={onCancel}
            okText={moveDestinationName ? `Move to ${moveDestinationName}` : `Move ${itemLabel}`}
            okButtonProps={{disabled: disabledConfirm, loading: isMoving}}
            destroyOnHidden
        >
            <div className="flex flex-col gap-2">
                <div className="text-gray-500">
                    Moving <span className="font-medium">{itemName || itemLabel}</span>
                </div>

                <div className="text-gray-500">Select folder</div>

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

export default MoveItemModal
