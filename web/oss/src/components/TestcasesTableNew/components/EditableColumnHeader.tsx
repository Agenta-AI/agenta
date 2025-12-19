import {memo, useCallback, useEffect, useRef, useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Modal, Tooltip, Typography} from "antd"

interface EditableColumnHeaderProps {
    columnKey: string
    columnName: string
    onRename: (oldName: string, newName: string) => boolean
    onDelete: (columnKey: string) => void
    disabled?: boolean
    /** Minimum width (in px) to show inline actions. Below this, show dropdown. Default: 120 */
    inlineActionsMinWidth?: number
}

const EditableColumnHeader = ({
    columnKey,
    columnName,
    onRename,
    onDelete,
    disabled = false,
    inlineActionsMinWidth = 120,
}: EditableColumnHeaderProps) => {
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
    const [newName, setNewName] = useState(columnName)
    const [useDropdown, setUseDropdown] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Check container width and decide whether to use dropdown or inline actions
    useEffect(() => {
        const checkWidth = () => {
            if (containerRef.current) {
                const width = containerRef.current.offsetWidth
                setUseDropdown(width < inlineActionsMinWidth)
            }
        }

        checkWidth()

        // Use ResizeObserver to detect width changes
        const resizeObserver = new ResizeObserver(checkWidth)
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current)
        }

        return () => resizeObserver.disconnect()
    }, [inlineActionsMinWidth])

    const openRenameModal = useCallback(() => {
        setNewName(columnName)
        setIsRenameModalOpen(true)
    }, [columnName])

    const handleRename = useCallback(() => {
        if (newName.trim() && newName !== columnName) {
            const success = onRename(columnName, newName.trim())
            if (success) {
                setIsRenameModalOpen(false)
            }
        } else {
            setIsRenameModalOpen(false)
        }
    }, [newName, columnName, onRename])

    const handleDelete = useCallback(() => {
        Modal.confirm({
            title: "Delete Column",
            content: `Are you sure you want to delete the column "${columnName}"? This will remove the column from all testcases.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            onOk: () => {
                onDelete(columnKey)
            },
        })
    }, [columnKey, columnName, onDelete])

    const menuItems = [
        {
            key: "rename",
            label: "Rename column",
            icon: <PencilSimple size={16} />,
            onClick: openRenameModal,
        },
        {type: "divider" as const},
        {
            key: "delete",
            label: "Delete column",
            icon: <Trash size={16} />,
            danger: true,
            onClick: handleDelete,
        },
    ]

    if (disabled) {
        return <span>{columnName}</span>
    }

    return (
        <>
            <div ref={containerRef} className="flex items-center justify-between w-full group">
                <Typography.Text ellipsis className="flex-1 min-w-0">
                    {columnName}
                </Typography.Text>

                {useDropdown ? (
                    // Dropdown menu for narrow columns
                    <Dropdown menu={{items: menuItems}} trigger={["click"]} placement="bottomRight">
                        <Button
                            type="text"
                            size="small"
                            icon={<MoreOutlined />}
                            className="flex-shrink-0 ml-1"
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Dropdown>
                ) : (
                    // Inline action buttons for wider columns
                    <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                        <Tooltip title="Rename column">
                            <Button
                                type="text"
                                size="small"
                                icon={<PencilSimple size={14} />}
                                className="!w-6 !h-6 !min-w-0"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    openRenameModal()
                                }}
                            />
                        </Tooltip>
                        <Tooltip title="Delete column">
                            <Button
                                type="text"
                                size="small"
                                danger
                                icon={<Trash size={14} />}
                                className="!w-6 !h-6 !min-w-0"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleDelete()
                                }}
                            />
                        </Tooltip>
                    </div>
                )}
            </div>

            <Modal
                title="Rename Column"
                open={isRenameModalOpen}
                onOk={handleRename}
                onCancel={() => setIsRenameModalOpen(false)}
                okText="Rename"
                destroyOnHidden
                afterOpenChange={(open) => {
                    if (open) {
                        // Focus input after modal animation completes
                        const input = document.querySelector(
                            ".rename-column-modal-input input",
                        ) as HTMLInputElement
                        input?.focus()
                        input?.select()
                    }
                }}
            >
                <div className="py-2">
                    <Typography.Text className="block mb-2">Column name:</Typography.Text>
                    <Input
                        className="rename-column-modal-input"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Enter column name"
                        onPressEnter={handleRename}
                    />
                </div>
            </Modal>
        </>
    )
}

export default memo(EditableColumnHeader)
