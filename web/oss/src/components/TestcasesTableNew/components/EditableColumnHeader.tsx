import {memo, useCallback, useEffect, useRef, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Input} from "@agenta/primitive-ui/components/input"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {DotsThreeVertical, PencilSimple, Trash} from "@phosphor-icons/react"

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
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [newName, setNewName] = useState(columnName)
    const [useDropdown, setUseDropdown] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Check container width and decide whether to use dropdown or inline actions
    useEffect(() => {
        const checkWidth = () => {
            if (containerRef.current) {
                const width = containerRef.current.offsetWidth
                const shouldUseDropdown = width < inlineActionsMinWidth
                // Only update state if the value actually changed
                // This prevents infinite loops during horizontal scroll
                setUseDropdown((prev) => (prev === shouldUseDropdown ? prev : shouldUseDropdown))
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
            const success = onRename(columnKey, newName.trim())
            if (success) {
                setIsRenameModalOpen(false)
            }
        } else {
            setIsRenameModalOpen(false)
        }
    }, [newName, columnKey, columnName, onRename])

    const openDeleteModal = useCallback(() => {
        setIsDeleteModalOpen(true)
    }, [])

    const handleDelete = useCallback(() => {
        onDelete(columnKey)
        setIsDeleteModalOpen(false)
    }, [columnKey, onDelete])

    if (disabled) {
        return <span className="truncate">{columnName}</span>
    }

    return (
        <>
            <div ref={containerRef} className="flex items-center justify-between w-full group">
                <span className="flex-1 min-w-0 truncate">{columnName}</span>

                {useDropdown ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <DotsThreeVertical size={16} weight="bold" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={openRenameModal}>
                                <PencilSimple size={16} />
                                Rename column
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={openDeleteModal}>
                                <Trash size={16} />
                                Delete column
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    // Inline action buttons for wider columns
                    <div className="flex items-center gap-0.5 flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        className="!w-6 !h-6 !min-w-0"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            openRenameModal()
                                        }}
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        {<PencilSimple size={14} />}
                                    </Button>
                                }
                            />
                            <TooltipContent>{"Rename column"}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        className="!w-6 !h-6 !min-w-0"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            openDeleteModal()
                                        }}
                                        variant="destructive"
                                        size="icon-sm"
                                    >
                                        {<Trash size={14} />}
                                    </Button>
                                }
                            />
                            <TooltipContent>{"Delete column"}</TooltipContent>
                        </Tooltip>
                    </div>
                )}
            </div>

            <EnhancedModal
                title="Rename Column"
                open={isRenameModalOpen}
                onOk={handleRename}
                onCancel={() => setIsRenameModalOpen(false)}
                okText="Rename"
                destroyOnHidden
                centered
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
                    <span className="block mb-2">Column name:</span>
                    <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Enter column name"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename()
                        }}
                        className="rename-column-modal-input"
                    />
                    <span className="text-xs mt-2 block text-muted-foreground">
                        Tip: Use dot notation to create nested columns. For example,{" "}
                        <code className="bg-gray-100 px-1 rounded">parent.child</code> creates a{" "}
                        <code className="bg-gray-100 px-1 rounded">child</code> column under the{" "}
                        <code className="bg-gray-100 px-1 rounded">parent</code> group.
                    </span>
                </div>
            </EnhancedModal>

            <EnhancedModal
                title="Delete Column"
                open={isDeleteModalOpen}
                onOk={handleDelete}
                onCancel={() => setIsDeleteModalOpen(false)}
                okText="Delete"
                okButtonProps={{danger: true}}
                destroyOnHidden
                centered
            >
                <span>
                    Are you sure you want to delete the column &quot;{columnName}&quot;? This will
                    remove the column from all testcases.
                </span>
            </EnhancedModal>
        </>
    )
}

export default memo(EditableColumnHeader)
