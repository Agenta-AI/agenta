import {useMemo, useCallback, useEffect, useRef, useState} from "react"

import {userByIdFamily} from "@agenta/entities/shared"
import {
    simpleQueuePaginatedStore,
    simpleQueueMolecule,
    simpleQueueKindFilterAtom,
    simpleQueueSearchTermAtom,
    type SimpleQueueTableRow,
} from "@agenta/entities/simpleQueue"
import type {SimpleQueueKind} from "@agenta/entities/simpleQueue"
import {useEntityDelete} from "@agenta/entity-ui"
import {Button} from "@agenta/primitive-ui/components/button"
import {copyToClipboard} from "@agenta/ui"
import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    createStandardColumns,
    FiltersPopoverTrigger,
} from "@agenta/ui/table"
import {ArrowRight, Copy, PlusIcon, Trash} from "@phosphor-icons/react"
import {Divider, Input, Select, Tag} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {useAnnotationNavigation} from "../../context/AnnotationUIContext"
import {
    createQueueDrawerOpenAtom,
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerSelectionAtom,
} from "../../state/atoms"
import CreateQueueDrawer from "../CreateQueueDrawer"
import QueueStatusTag from "../QueueStatusTag"

import CreatedByCell from "./cells/CreatedByCell"
import QueueProgressCell from "./cells/QueueProgressCell"

const kindColorMap: Record<string, string> = {
    traces: "blue",
    testcases: "green",
    testsets: "purple",
    queries: "orange",
}

const kindLabelMap: Record<string, string> = {
    traces: "Traces",
    testcases: "Test cases",
    testsets: "Test set",
    queries: "Queries",
}

const statusLabelMap: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    running: "Running",
    success: "Completed",
    failure: "Failed",
    errors: "Errors",
    cancelled: "Cancelled",
}

const ANNOTATION_QUEUES_DOCS_URL = "https://docs.agenta.ai"

function formatQueueKind(kind: string | null | undefined) {
    if (!kind) return ""
    return kindLabelMap[kind] ?? ""
}

function resolveUserDisplayName(userId: string | null | undefined) {
    if (!userId) return "—"

    const user = getDefaultStore().get(userByIdFamily(userId))
    const candidate = user?.username ?? user?.name ?? user?.email

    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : "—"
}

function formatReviewed(queueId: string) {
    const progress = getDefaultStore().get(simpleQueueMolecule.selectors.scenarioProgress(queueId))
    if (!progress) return ""
    if (progress.total === 0) return "No items"
    return `${progress.completed} out of ${progress.total}`
}

function formatQueueStatus(queueId: string, fallbackStatus: string | null | undefined) {
    const resolvedStatus = getDefaultStore().get(simpleQueueMolecule.selectors.status(queueId))
    const statusKey = (resolvedStatus ?? fallbackStatus ?? "pending").toLowerCase()

    return statusLabelMap[statusKey] ?? statusKey.charAt(0).toUpperCase() + statusKey.slice(1)
}

function AnnotationQueuesEmptyState({onCreate}: {onCreate: () => void}) {
    return (
        <div className="px-4 py-6">
            <div className="mx-auto flex min-h-[300px] max-w-3xl items-center justify-center">
                <div className="flex max-w-xl flex-col items-center text-center gap-3">
                    <span className="text-lg font-semibold">
                        Create your first annotation queue
                    </span>
                    <span>
                        Route trace and test case reviews into a shared queue, assign work, and keep
                        annotation progress visible in one place.
                    </span>
                    <div className="flex gap-2 mt-5">
                        <Button onClick={onCreate}>
                            {<PlusIcon size={16} />}
                            New Queue
                        </Button>
                        <Button
                            variant="outline"
                            render={
                                <a
                                    href={ANNOTATION_QUEUES_DOCS_URL}
                                    target="_blank"
                                    rel="noreferrer"
                                />
                            }
                        >
                            <span className="flex items-center gap-2">
                                Learn More
                                <ArrowRight size={16} />
                            </span>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

function AnnotationQueuesSearchEmptyState({
    searchTerm,
    onClearSearch,
}: {
    searchTerm: string
    onClearSearch: () => void
}) {
    return (
        <div className="px-4 py-6">
            <div className="mx-auto flex min-h-[220px] max-w-2xl items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50/70 dark:border-[var(--ag-rgba-051729-06)] dark:bg-[var(--ag-rgba-051729-04)] px-6 py-8">
                <div className="flex max-w-lg flex-col items-center text-center">
                    <h4 className="!mb-2 !text-xl !font-semibold !text-zinc-900 md:!text-2xl text-base font-semibold leading-snug">
                        No queues match your search
                    </h4>
                    <p className="!mb-5 !text-sm !leading-6 !text-zinc-500 md:!text-base">
                        No annotation queues matched "{searchTerm}". Try a different name or clear
                        the search.
                    </p>
                    <Button onClick={onClearSearch} variant="outline">
                        Clear search
                    </Button>
                </div>
            </div>
        </div>
    )
}

const KIND_OPTIONS: {value: SimpleQueueKind | ""; label: string}[] = [
    {value: "", label: "All types"},
    {value: "traces", label: "Traces"},
    {value: "testcases", label: "Test cases"},
]

const QueuesFiltersContent = ({onClose}: {onClose: () => void}) => {
    const [kindFilter, setKindFilter] = useAtom(simpleQueueKindFilterAtom)
    const [draftKind, setDraftKind] = useState<SimpleQueueKind | null>(kindFilter)

    useEffect(() => {
        setDraftKind(kindFilter)
    }, [kindFilter])

    const hasPendingChanges = draftKind !== kindFilter

    const handleReset = useCallback(() => {
        setDraftKind(null)
        setKindFilter(null)
    }, [setKindFilter])

    const handleApply = useCallback(() => {
        setKindFilter(draftKind)
        onClose()
    }, [draftKind, setKindFilter, onClose])

    return (
        <div className="flex flex-col gap-4 min-w-[240px]">
            <div className="flex flex-col gap-2">
                <span className="text-gray-700 font-semibold">Type</span>
                <Select
                    value={draftKind ?? ""}
                    onChange={(val) => setDraftKind(val === "" ? null : (val as SimpleQueueKind))}
                    options={KIND_OPTIONS}
                    className="w-full"
                />
            </div>
            <Divider className="!my-0" />
            <div className="flex justify-end gap-2">
                <Button onClick={handleReset} variant="link">
                    Reset
                </Button>
                <Button onClick={handleApply} disabled={!hasPendingChanges}>
                    Apply
                </Button>
            </div>
        </div>
    )
}

const QueuesHeaderFilters = () => {
    const [searchTerm, setSearchTerm] = useAtom(simpleQueueSearchTermAtom)
    const kindFilter = useAtomValue(simpleQueueKindFilterAtom)
    const filterCount = kindFilter ? 1 : 0

    return (
        <div className="flex gap-2 flex-1 items-center min-w-[320px] shrink">
            <Input
                allowClear
                placeholder="Search queues"
                className="min-w-0 shrink max-w-[320px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{minWidth: 220}}
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
                renderContent={(close) => <QueuesFiltersContent onClose={close} />}
            />
        </div>
    )
}

export interface AnnotationQueuesViewProps {
    canExportData?: boolean
    feedbackOnCreate?: () => void
    feedbackCreateLabel?: string
}

const AnnotationQueuesView = ({
    canExportData = true,
    feedbackOnCreate,
    feedbackCreateLabel,
}: AnnotationQueuesViewProps) => {
    const navigation = useAnnotationNavigation()
    const searchTerm = useAtomValue(simpleQueueSearchTermAtom)
    const kindFilter = useAtomValue(simpleQueueKindFilterAtom)
    const setDrawerOpen = useSetAtom(createQueueDrawerOpenAtom)
    const setDrawerDefaultKind = useSetAtom(createQueueDrawerDefaultKindAtom)
    const setDrawerSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const setSearchTerm = useSetAtom(simpleQueueSearchTermAtom)
    const {deleteEntity, deleteEntities} = useEntityDelete()
    const normalizedSearchTerm = searchTerm.trim()
    const hasSearchQuery = normalizedSearchTerm.length > 0
    const clearSelectionRef = useRef<() => void>(() => {})

    const handleBulkDelete = useCallback(
        (records: SimpleQueueTableRow[]) => {
            deleteEntities(
                records.map((record) => ({
                    type: "simpleQueue",
                    id: record.id,
                    name: record.name ?? undefined,
                })),
                {
                    onSuccess: () => {
                        clearSelectionRef.current()
                    },
                },
            )
        },
        [deleteEntities],
    )

    const openCreateQueueDrawer = useCallback(() => {
        setDrawerSelection(null)
        setDrawerDefaultKind("traces")
        setDrawerOpen(true)
    }, [setDrawerDefaultKind, setDrawerOpen, setDrawerSelection])

    const handleRowClick = useCallback(
        (record: SimpleQueueTableRow) => {
            navigation.navigateToQueue(record.id)
        },
        [navigation],
    )

    const table = useTableManager<SimpleQueueTableRow>({
        datasetStore: simpleQueuePaginatedStore.store as never,
        scopeId: "annotation-queues",
        pageSize: 50,
        onRowClick: handleRowClick,
        searchDeps: [normalizedSearchTerm, kindFilter],
        onBulkDelete: handleBulkDelete,
    })
    clearSelectionRef.current = table.clearSelection

    const columns = useMemo(
        () =>
            createStandardColumns<SimpleQueueTableRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 280,
                    columnVisibilityLocked: true,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        return (
                            <div className="h-full flex items-center">
                                <span className="font-semibold">{record.name || "Untitled"}</span>
                            </div>
                        )
                    },
                },
                {
                    type: "text",
                    key: "kind",
                    title: "Type",
                    width: 110,
                    render: (_value, record) => {
                        const kind = record.data?.kind
                        if (!kind) return null
                        return (
                            <div className="h-full flex items-center">
                                <Tag color={kindColorMap[kind] ?? "default"}>
                                    {kindLabelMap[kind] ?? kind}
                                </Tag>
                            </div>
                        )
                    },
                },
                {
                    type: "text",
                    key: "reviewed",
                    title: "Reviewed",
                    width: 120,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        return (
                            <div className="h-full flex items-center">
                                <QueueProgressCell queueId={record.id} />
                            </div>
                        )
                    },
                },
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 140,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null

                        return (
                            <div className="h-full flex items-center">
                                <QueueStatusTag
                                    queueId={record.id}
                                    fallbackStatus={record.status ?? null}
                                />
                            </div>
                        )
                    },
                },
                {
                    type: "text",
                    key: "description",
                    title: "Description",
                    width: 200,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        if (!record.description) {
                            return (
                                <div className="h-full flex items-center">
                                    <span className="text-muted-foreground">—</span>
                                </div>
                            )
                        }

                        return (
                            <div className="h-full flex items-center min-w-0">
                                <span className="block truncate text-muted-foreground">
                                    {record.description}
                                </span>
                            </div>
                        )
                    },
                },
                {
                    type: "date",
                    key: "updated_at",
                    title: "Modified on",
                    width: 180,
                },
                {
                    type: "date",
                    key: "created_at",
                    title: "Created on",
                    width: 180,
                },
                {
                    type: "text",
                    key: "created_by",
                    title: "Created by",
                    width: 150,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        return (
                            <div className="h-full flex items-center">
                                <CreatedByCell createdById={record.created_by_id} />
                            </div>
                        )
                    },
                },
                {
                    type: "actions",
                    width: 48,
                    maxWidth: 48,
                    showCopyId: false,
                    items: [
                        {
                            key: "open",
                            label: "Open",
                            onClick: (record) => navigation.navigateToQueue(record.id),
                        },
                        {
                            key: "results",
                            label: "View Results",
                            onClick: (record) => {
                                if (record.run_id) {
                                    navigation.navigateToResults?.(record.run_id)
                                }
                            },
                        },
                        {
                            type: "divider",
                        },
                        {
                            key: "copy-id",
                            label: "Copy ID",
                            icon: <Copy size={16} />,
                            onClick: (record) => {
                                void copyToClipboard(record.id)
                            },
                        },
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record) => {
                                deleteEntity("simpleQueue", record.id, record.name ?? undefined)
                            },
                        },
                    ],
                    getRecordId: (record) => record.id,
                },
            ]),
        [deleteEntity, navigation],
    )

    const filtersNode = useMemo(() => <QueuesHeaderFilters />, [])

    const createButton = useMemo(
        () => (
            <Button onClick={openCreateQueueDrawer}>
                {<PlusIcon size={14} />}
                New Queue
            </Button>
        ),
        [openCreateQueueDrawer],
    )

    const emptyStateNode = useMemo(
        () =>
            hasSearchQuery ? (
                <AnnotationQueuesSearchEmptyState
                    searchTerm={normalizedSearchTerm}
                    onClearSearch={() => setSearchTerm("")}
                />
            ) : (
                <AnnotationQueuesEmptyState onCreate={openCreateQueueDrawer} />
            ),
        [hasSearchQuery, normalizedSearchTerm, openCreateQueueDrawer, setSearchTerm],
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

    const exportOptions = useMemo(
        () => ({
            filename: "annotation-queues.csv",
            isColumnExportable: ({column}: {column: {key?: React.Key}}) => column.key !== "actions",
            resolveValue: ({columnKey, row}: {columnKey: string; row: SimpleQueueTableRow}) => {
                switch (columnKey) {
                    case "kind":
                        return formatQueueKind(row.data?.kind ?? null)
                    case "reviewed":
                        return formatReviewed(row.id)
                    case "status":
                        return formatQueueStatus(row.id, row.status ?? null)
                    case "created_by":
                        return resolveUserDisplayName(row.created_by_id)
                    default:
                        return undefined
                }
            },
        }),
        [],
    )

    return (
        <div className="flex flex-col h-full min-h-0 grow w-full">
            <InfiniteVirtualTableFeatureShell<SimpleQueueTableRow>
                {...table.shellProps}
                columns={columns}
                filters={filtersNode}
                primaryActions={createButton}
                tableProps={tableProps}
                exportOptions={exportOptions}
                enableExport={canExportData}
                autoHeight
                // Fill the flex-column parent so the table's scroll container has a
                // definite height to measure on mount (matches the evaluators/
                // evaluations tables). Without it the shell sizes to content and the
                // table mounts at the ~360px fallback height before growing.
                className="flex-1 min-h-0"
                store={getDefaultStore()}
            />
            <CreateQueueDrawer
                feedbackOnCreate={feedbackOnCreate}
                feedbackCreateLabel={feedbackCreateLabel}
            />
        </div>
    )
}

export default AnnotationQueuesView
