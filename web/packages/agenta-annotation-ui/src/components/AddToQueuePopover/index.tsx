import {useCallback, useMemo, useState} from "react"

import {
    simpleQueueMolecule,
    simpleQueuesListDataAtom,
    simpleQueuesListQueryAtom,
    type SimpleQueue,
} from "@agenta/entities/simpleQueue"
import {message} from "@agenta/ui/app-message"
import {MagnifyingGlass, PlusIcon} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Skeleton, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {
    createQueueDrawerOpenAtom,
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerSelectionAtom,
} from "../../state/atoms"
import CreateQueueDrawer from "../CreateQueueDrawer"

const statusColorMap: Record<string, string> = {
    pending: "default",
    queued: "processing",
    running: "processing",
    success: "success",
    failure: "error",
    errors: "error",
    cancelled: "warning",
}

interface AddToQueuePopoverProps {
    itemType: "traces" | "testcases"
    itemIds: string[]
    children: React.ReactNode
    disabled?: boolean
    onItemsAdded?: () => void
}

const QueueListContent = ({
    itemType,
    itemIds,
    onClose,
    onItemsAdded,
}: {
    itemType: "traces" | "testcases"
    itemIds: string[]
    onClose: () => void
    onItemsAdded?: () => void
}) => {
    const allQueues = useAtomValue(simpleQueuesListDataAtom)
    const listQuery = useAtomValue(simpleQueuesListQueryAtom)
    const addTraces = useSetAtom(simpleQueueMolecule.actions.addTraces)
    const addTestcases = useSetAtom(simpleQueueMolecule.actions.addTestcases)
    const setDrawerOpen = useSetAtom(createQueueDrawerOpenAtom)
    const setDefaultKind = useSetAtom(createQueueDrawerDefaultKindAtom)
    const setDrawerSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const [search, setSearch] = useState("")
    const [submittingId, setSubmittingId] = useState<string | null>(null)

    const isLoading = listQuery.isPending

    const filteredQueues = useMemo(() => {
        const byKind = allQueues.filter((q) => q.data?.kind === itemType)
        if (!search.trim()) return byKind
        const term = search.trim().toLowerCase()
        return byKind.filter((q) => (q.name || "").toLowerCase().includes(term))
    }, [allQueues, itemType, search])

    const handleSelect = useCallback(
        async (queue: SimpleQueue) => {
            if (itemIds.length === 0) return
            setSubmittingId(queue.id)
            try {
                const result =
                    itemType === "traces"
                        ? await addTraces(queue.id, itemIds)
                        : await addTestcases(queue.id, itemIds)

                if (result) {
                    message.success(
                        `Added ${itemIds.length} ${itemType === "traces" ? "trace" : "test case"}${itemIds.length > 1 ? "s" : ""} to "${queue.name || "Untitled"}"`,
                    )
                    onItemsAdded?.()
                    onClose()
                }
            } catch (error) {
                if (error instanceof Error) {
                    message.error(error.message)
                }
            } finally {
                setSubmittingId(null)
            }
        },
        [itemIds, itemType, addTraces, addTestcases, onClose, onItemsAdded],
    )

    return (
        <div className="flex flex-col w-[300px]">
            <div className="px-2 py-1 border-0 border-b border-solid border-gray-200">
                <Input
                    variant="borderless"
                    prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                    allowClear
                    placeholder="Search queues"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    autoFocus
                />
            </div>
            <div className="max-h-[240px] overflow-y-auto py-1">
                {isLoading ? (
                    <div className="flex flex-col gap-2 px-3 py-2">
                        {Array.from({length: 3}).map((_, i) => (
                            <Skeleton.Input key={i} active size="small" block />
                        ))}
                    </div>
                ) : filteredQueues.length === 0 ? (
                    <div className="py-4 text-center">
                        <Typography.Text type="secondary" className="text-xs">
                            {search.trim()
                                ? "No matching queues"
                                : `No ${itemType === "traces" ? "trace" : "test case"} queues`}
                        </Typography.Text>
                    </div>
                ) : (
                    filteredQueues.map((queue) => (
                        <button
                            key={queue.id}
                            type="button"
                            disabled={submittingId !== null}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left bg-transparent border-0 cursor-pointer hover:bg-gray-50 disabled:opacity-50 disabled:cursor-wait"
                            onClick={() => handleSelect(queue)}
                        >
                            <Typography.Text
                                className="truncate flex-1"
                                strong={submittingId === queue.id}
                            >
                                {queue.name || "Untitled"}
                            </Typography.Text>
                            {queue.status && (
                                <Tag
                                    color={statusColorMap[queue.status] ?? "default"}
                                    className="!mr-0 text-xs"
                                >
                                    {queue.status.charAt(0).toUpperCase() + queue.status.slice(1)}
                                </Tag>
                            )}
                        </button>
                    ))
                )}
            </div>
            <Divider className="!my-0" />
            <div className="p-2">
                <Button
                    type="dashed"
                    icon={<PlusIcon size={14} />}
                    size="small"
                    onClick={() => {
                        setDefaultKind(itemType)
                        setDrawerSelection({
                            itemType,
                            itemIds,
                        })
                        setDrawerOpen(true)
                        onClose()
                    }}
                    className="w-full"
                >
                    Create new queue
                </Button>
            </div>
            <CreateQueueDrawer onItemsAdded={onItemsAdded} />
        </div>
    )
}

const AddToQueuePopover = ({
    itemType,
    itemIds,
    children,
    disabled,
    onItemsAdded,
}: AddToQueuePopoverProps) => {
    const [open, setOpen] = useState(false)

    const handleClose = useCallback(() => setOpen(false), [])

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen) => {
                if (disabled && nextOpen) return
                setOpen(nextOpen)
            }}
            trigger="click"
            placement="bottomRight"
            arrow={false}
            content={
                open ? (
                    <QueueListContent
                        itemType={itemType}
                        itemIds={itemIds}
                        onClose={handleClose}
                        onItemsAdded={onItemsAdded}
                    />
                ) : null
            }
            overlayInnerStyle={{padding: 0}}
        >
            <span
                role="button"
                tabIndex={disabled ? -1 : 0}
                className={
                    disabled
                        ? "inline-flex pointer-events-none opacity-50"
                        : "inline-flex cursor-pointer"
                }
                onClick={() => {
                    if (!disabled) setOpen((prev) => !prev)
                }}
            >
                {children}
            </span>
        </Popover>
    )
}

export default AddToQueuePopover
