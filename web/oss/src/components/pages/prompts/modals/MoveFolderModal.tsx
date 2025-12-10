import {Modal, Space, Tree} from "antd"
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
            width={600}
            open={open}
            onOk={onMove}
            onCancel={onCancel}
            okText={moveDestinationName ? `Move to ${moveDestinationName}` : "Move folder"}
            okButtonProps={{disabled: disabledConfirm, loading: isMoving}}
            destroyOnHidden
        >
            <div className="flex flex-col gap-4 pt-2 pb-4">
                <div className="font-medium">Moving {itemName || "folder"}</div>

                <Space direction="vertical" size={4}>
                    <div className="font-medium">Select folder</div>

                    <div className="p-2 border border-solid border-gray-200 rounded max-h-[60vh] overflow-auto">
                        <Tree
                            blockNode
                            selectable
                            treeData={treeData}
                            selectedKeys={moveSelection ? [moveSelection] : []}
                            onSelect={(keys) => setMoveSelection((keys[0] as string) || null)}
                            defaultExpandAll
                        />
                    </div>
                </Space>
            </div>
        </Modal>
    )
}

export default MoveFolderModal
