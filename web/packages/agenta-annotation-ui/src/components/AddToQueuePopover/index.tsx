import {useCallback, useMemo, useState} from "react"

import {
    simpleQueueMolecule,
    simpleQueuePaginatedStore,
    simpleQueuesListDataAtom,
    simpleQueuesListQueryAtom,
    type SimpleQueue,
} from "@agenta/entities/simpleQueue"
import {dayjs} from "@agenta/shared/utils"
import "dayjs/plugin/relativeTime"
import {message} from "@agenta/ui/app-message"
import {Plus} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Skeleton, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigationSafe} from "../../context"
import {
    createQueueDrawerOpenAtom,
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerSelectionAtom,
} from "../../state/atoms"
import CreateQueueDrawer from "../CreateQueueDrawer"

const ANNOTATION_QUEUE_TABLE_PARAMS = {
    scopeId: "annotation-queues",
    pageSize: 50,
} as const

function mergeQueuesById(...queueLists: SimpleQueue[][]): SimpleQueue[] {
    const merged = new Map<string, SimpleQueue>()

    for (const queues of queueLists) {
        for (const queue of queues) {
            merged.set(queue.id, queue)
        }
    }

    return Array.from(merged.values())
}

interface AddToQueuePopoverProps {
    itemType: "traces" | "testcases"
    itemIds: string[]
    children: React.ReactNode
    disabled?: boolean
    onItemsAdded?: () => void
    open?: boolean
    onOpenChange?: (open: boolean) => void
    toggleOnTriggerClick?: boolean
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
    const navigation = useAnnotationNavigationSafe()
    const navigateToQueue = navigation?.navigateToQueue
    const listQueues = useAtomValue(simpleQueuesListDataAtom)
    const listQuery = useAtomValue(simpleQueuesListQueryAtom)
    const paginatedState = useAtomValue(
        simpleQueuePaginatedStore.selectors.state(ANNOTATION_QUEUE_TABLE_PARAMS),
    )
    const addTraces = useSetAtom(simpleQueueMolecule.actions.addTraces)
    const addTestcases = useSetAtom(simpleQueueMolecule.actions.addTestcases)
    const setDrawerOpen = useSetAtom(createQueueDrawerOpenAtom)
    const setDefaultKind = useSetAtom(createQueueDrawerDefaultKindAtom)
    const setDrawerSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const [search, setSearch] = useState("")
    const [submittingId, setSubmittingId] = useState<string | null>(null)

    const cachedQueues = useMemo(
        () =>
            paginatedState.rows.filter((row) => {
                return !row.__isSkeleton && typeof row.id === "string"
            }),
        [paginatedState.rows],
    )

    const filteredQueues = useMemo(() => {
        const allQueues = mergeQueuesById(cachedQueues, listQueues)
        const byKind = allQueues.filter((q) => q.data?.kind === itemType)
        if (!search.trim()) return byKind
        const term = search.trim().toLowerCase()
        return byKind.filter((q) => (q.name || "").toLowerCase().includes(term))
    }, [cachedQueues, listQueues, itemType, search])

    const hasImmediateQueues = cachedQueues.some((queue) => queue.data?.kind === itemType)
    const isLoading = filteredQueues.length === 0 && !hasImmediateQueues && listQuery.isPending

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
                    const count = itemIds.length
                    const entityLabel = `${itemType === "traces" ? "trace" : "test case"}${count > 1 ? "s" : ""}`
                    const queueName = queue.name || "Untitled"
                    const projectURL =
                        window.location.pathname.match(/^(\/w\/[^/]+\/p\/[^/]+)/)?.[1]
                    message.success({
                        content: `Added ${count} ${entityLabel} to "${queueName}".`,
                        onNavigate: navigateToQueue ? () => navigateToQueue(queue.id) : undefined,
                        url:
                            !navigateToQueue && projectURL
                                ? `${projectURL}/annotations/${queue.id}`
                                : undefined,
                        linkText: "View queue",
                        duration: 5,
                    })
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
        [itemIds, itemType, addTraces, addTestcases, onClose, onItemsAdded, navigateToQueue],
    )

    const handleNewQueue = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation()
            setDefaultKind(itemType)
            setDrawerSelection({itemType, itemIds})
            setDrawerOpen(true)
            onClose()
        },
        [setDefaultKind, setDrawerSelection, setDrawerOpen, onClose, itemType, itemIds],
    )

    return (
        <div
            className="flex flex-col gap-2 w-[300px] overflow-hidden py-2"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {/* Header */}
            <div className="flex flex-col gap-2 px-3">
                <div className="flex items-center justify-between">
                    <Typography.Text className="font-medium">
                        Select annotation queue
                    </Typography.Text>
                    <Button
                        type="primary"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={handleNewQueue}
                    >
                        New
                    </Button>
                </div>

                <Input
                    placeholder="Search queues..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    allowClear
                    autoFocus
                />
            </div>

            <Divider className="!my-0" />
            {/* Queue list */}
            <div className="max-h-[360px] overflow-y-auto">
                {isLoading ? (
                    <div className="flex flex-col gap-3 px-4 py-2">
                        {Array.from({length: 4}).map((_, i) => (
                            <Skeleton key={i} active paragraph={{rows: 1}} title={false} />
                        ))}
                    </div>
                ) : filteredQueues.length === 0 ? (
                    <div className="py-8 text-center">
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
                            className="w-full flex items-start gap-3 px-3 py-2 text-left bg-transparent border-0 cursor-pointer hover:bg-gray-50 disabled:opacity-50 disabled:cursor-wait"
                            onClick={(event) => {
                                event.stopPropagation()
                                void handleSelect(queue)
                            }}
                        >
                            <div className="flex flex-col min-w-0">
                                <Typography.Text
                                    className="truncate"
                                    strong={submittingId === queue.id}
                                >
                                    {queue.name || "Untitled"}
                                </Typography.Text>
                                <Typography.Text type="secondary" className="text-[10px]">
                                    Updated{" "}
                                    {queue.updated_at ? dayjs(queue.updated_at)?.fromNow() : "—"}
                                </Typography.Text>
                            </div>
                        </button>
                    ))
                )}
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
    open: controlledOpen,
    onOpenChange,
    toggleOnTriggerClick = true,
}: AddToQueuePopoverProps) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    const isControlled = controlledOpen !== undefined
    const open = controlledOpen ?? uncontrolledOpen

    const setOpen = useCallback(
        (nextOpen: boolean) => {
            if (!isControlled) {
                setUncontrolledOpen(nextOpen)
            }
            onOpenChange?.(nextOpen)
        },
        [isControlled, onOpenChange],
    )

    const handleClose = useCallback(() => setOpen(false), [setOpen])

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
            styles={{container: {padding: 0}}}
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
                    if (!disabled && toggleOnTriggerClick) {
                        setOpen(!open)
                    }
                }}
            >
                {children}
            </span>
        </Popover>
    )
}

export default AddToQueuePopover
