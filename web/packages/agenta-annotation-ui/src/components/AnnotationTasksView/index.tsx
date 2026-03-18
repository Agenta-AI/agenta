import {useMemo, useCallback, useEffect, useState} from "react"

import {currentUserAtom} from "@agenta/entities/shared"
import {
    simpleQueuesListDataAtom,
    simpleQueueTasksPaginatedStore,
    taskQueueIdAtom,
    taskStatusFilterAtom,
    taskUserIdAtom,
    type SimpleQueueTaskRow,
} from "@agenta/entities/simpleQueue"
import type {EvaluationStatus, SimpleQueue} from "@agenta/entities/simpleQueue"
import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    createStandardColumns,
    FiltersPopoverTrigger,
} from "@agenta/ui/table"
import {ClipboardText} from "@phosphor-icons/react"
import {Button, Divider, Select, Tag, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context/AnnotationUIContext"
import AnnotationStatusFilterSelect from "../AnnotationStatusFilterSelect"

// ============================================================================
// CONSTANTS
// ============================================================================

const statusColorMap: Record<string, string> = {
    pending: "default",
    queued: "processing",
    running: "processing",
    success: "success",
    failure: "error",
    errors: "error",
    cancelled: "warning",
}

// ============================================================================
// EMPTY STATES
// ============================================================================

function TasksNoQueueEmptyState() {
    return (
        <div className="px-4 py-6">
            <div className="mx-auto flex min-h-[220px] max-w-2xl items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-8">
                <div className="flex max-w-lg flex-col items-center text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
                        <ClipboardText size={24} className="text-zinc-400" />
                    </div>
                    <Typography.Title
                        level={4}
                        className="!mb-2 !text-xl !font-semibold !text-zinc-900"
                    >
                        Select a queue
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !text-sm !leading-6 !text-zinc-500">
                        Choose a queue from the dropdown above to view your annotation tasks.
                    </Typography.Paragraph>
                </div>
            </div>
        </div>
    )
}

function TasksEmptyState() {
    return (
        <div className="px-4 py-6">
            <div className="mx-auto flex min-h-[220px] max-w-2xl items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-8">
                <div className="flex max-w-lg flex-col items-center text-center">
                    <Typography.Title
                        level={4}
                        className="!mb-2 !text-xl !font-semibold !text-zinc-900"
                    >
                        No tasks found
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-0 !text-sm !leading-6 !text-zinc-500">
                        No annotation tasks match the selected filters. Try changing the status
                        filter or selecting a different queue.
                    </Typography.Paragraph>
                </div>
            </div>
        </div>
    )
}

const TasksFiltersContent = ({onClose}: {onClose: () => void}) => {
    const [statusFilter, setStatusFilter] = useAtom(taskStatusFilterAtom)
    const [draftStatus, setDraftStatus] = useState<EvaluationStatus | null>(statusFilter)

    useEffect(() => {
        setDraftStatus(statusFilter)
    }, [statusFilter])

    const hasPendingChanges = draftStatus !== statusFilter

    const handleReset = useCallback(() => {
        setDraftStatus(null)
        setStatusFilter(null)
    }, [setStatusFilter])

    const handleApply = useCallback(() => {
        setStatusFilter(draftStatus)
        onClose()
    }, [draftStatus, setStatusFilter, onClose])

    return (
        <div className="flex flex-col gap-4 p-4 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[240px]">
            <div className="flex flex-col gap-2">
                <Typography.Text strong className="text-gray-700">
                    Status
                </Typography.Text>
                <AnnotationStatusFilterSelect
                    value={draftStatus}
                    onChange={setDraftStatus}
                    className="w-full"
                />
            </div>
            <Divider className="!my-0" />
            <div className="flex justify-end gap-2">
                <Button type="link" onClick={handleReset}>
                    Reset
                </Button>
                <Button type="primary" onClick={handleApply} disabled={!hasPendingChanges}>
                    Apply
                </Button>
            </div>
        </div>
    )
}

const TasksHeaderFilters = ({
    queues,
    selectedQueueId,
    onQueueChange,
}: {
    queues: SimpleQueue[]
    selectedQueueId: string | null
    onQueueChange: (queueId: string | null) => void
}) => {
    const statusFilter = useAtomValue(taskStatusFilterAtom)
    const filterCount = statusFilter ? 1 : 0

    const queueOptions = useMemo(
        () => [
            {value: "", label: "Select a queue..."},
            ...queues.map((q) => ({
                value: q.id,
                label: q.name || "Untitled",
            })),
        ],
        [queues],
    )

    return (
        <div className="flex gap-2 flex-1 items-center min-w-[320px] shrink">
            <Select
                value={selectedQueueId ?? ""}
                onChange={(val) => onQueueChange(val === "" ? null : val)}
                options={queueOptions}
                className="min-w-[200px] max-w-[320px]"
                placeholder="Select a queue..."
            />
            <FiltersPopoverTrigger
                filterCount={filterCount}
                popoverProps={{
                    overlayStyle: {
                        backgroundColor: "transparent",
                        boxShadow: "none",
                        padding: 0,
                    },
                    arrow: false,
                }}
                renderContent={(close) => <TasksFiltersContent onClose={close} />}
            />
        </div>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const AnnotationTasksView = () => {
    const navigation = useAnnotationNavigation()
    const currentUser = useAtomValue(currentUserAtom)
    const allQueues = useAtomValue(simpleQueuesListDataAtom)
    const [selectedQueueId, setSelectedQueueId] = useAtom(taskQueueIdAtom)
    const statusFilter = useAtomValue(taskStatusFilterAtom)
    const setUserId = useSetAtom(taskUserIdAtom)

    // Set the current user ID for task filtering
    useEffect(() => {
        setUserId(currentUser?.id ?? null)
    }, [currentUser?.id, setUserId])

    // Filter queues assigned to the current user
    const assignedQueues = useMemo(() => {
        if (!currentUser?.id) return allQueues
        return allQueues.filter((q) => {
            const assignments = q.data?.assignments
            if (!assignments) return true // show queues without specific assignments
            return assignments.some((group) => group.includes(currentUser.id))
        })
    }, [allQueues, currentUser?.id])

    // Build queue name lookup for enrichment
    const queueNameMap = useMemo(() => {
        const map = new Map<string, string | null>()
        for (const q of allQueues) {
            map.set(q.id, q.name ?? null)
        }
        return map
    }, [allQueues])

    const handleRowClick = useCallback(
        (record: SimpleQueueTaskRow) => {
            if (record.__isSkeleton) return
            const queueId = selectedQueueId
            if (queueId) {
                navigation.navigateToQueue(queueId)
            }
        },
        [navigation, selectedQueueId],
    )

    const handleQueueChange = useCallback(
        (queueId: string | null) => {
            setSelectedQueueId(queueId)
        },
        [setSelectedQueueId],
    )

    const table = useTableManager<SimpleQueueTaskRow>({
        datasetStore: simpleQueueTasksPaginatedStore.store as never,
        scopeId: "annotation-tasks",
        pageSize: 50,
        onRowClick: handleRowClick,
        searchDeps: [selectedQueueId, statusFilter],
    })

    const columns = useMemo(
        () =>
            createStandardColumns<SimpleQueueTaskRow>([
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 120,
                    columnVisibilityLocked: true,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        const status = record.status
                        if (!status) return <Tag>Unknown</Tag>
                        return (
                            <Tag color={statusColorMap[status] ?? "default"}>
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                            </Tag>
                        )
                    },
                },
                {
                    type: "text",
                    key: "queueName",
                    title: "Queue",
                    width: 200,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        const name = queueNameMap.get(selectedQueueId ?? "") ?? selectedQueueId
                        return <Typography.Text className="truncate">{name || "—"}</Typography.Text>
                    },
                },
                {
                    type: "date",
                    key: "created_at",
                    title: "Created",
                    width: 180,
                },
                {
                    type: "date",
                    key: "updated_at",
                    title: "Updated",
                    width: 180,
                },
                {
                    type: "actions",
                    width: 48,
                    maxWidth: 48,
                    items: [
                        {
                            key: "annotate",
                            label: "Annotate",
                            onClick: () => {
                                if (selectedQueueId) {
                                    navigation.navigateToQueue(selectedQueueId)
                                }
                            },
                        },
                    ],
                    getRecordId: (record) => record.id,
                },
            ]),
        [navigation, selectedQueueId, queueNameMap],
    )

    const filtersNode = useMemo(
        () => (
            <TasksHeaderFilters
                queues={assignedQueues}
                selectedQueueId={selectedQueueId}
                onQueueChange={handleQueueChange}
            />
        ),
        [assignedQueues, selectedQueueId, handleQueueChange],
    )

    const emptyStateNode = useMemo(
        () => (selectedQueueId ? <TasksEmptyState /> : <TasksNoQueueEmptyState />),
        [selectedQueueId],
    )

    const tableProps = useMemo(
        () => ({
            ...(table.tableProps ?? {}),
            locale: {
                ...(table.tableProps?.locale ?? {}),
                emptyText: emptyStateNode,
            },
        }),
        [table.tableProps, emptyStateNode],
    )

    return (
        <div className="flex flex-col h-full min-h-0 grow w-full">
            {selectedQueueId ? (
                <InfiniteVirtualTableFeatureShell<SimpleQueueTaskRow>
                    {...table.shellProps}
                    columns={columns}
                    filters={filtersNode}
                    tableProps={tableProps}
                    autoHeight
                />
            ) : (
                <>
                    <div className="shrink-0 px-4 pt-4">{filtersNode}</div>
                    <div className="flex-1 min-h-0 overflow-auto">
                        <TasksNoQueueEmptyState />
                    </div>
                </>
            )}
        </div>
    )
}

export default AnnotationTasksView
