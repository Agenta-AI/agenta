import {useMemo, useCallback, useState, useEffect} from "react"

import {
    simpleQueuePaginatedStore,
    simpleQueueKindFilterAtom,
    simpleQueueSearchTermAtom,
    type SimpleQueueTableRow,
} from "@agenta/entities/simpleQueue"
import type {SimpleQueueKind} from "@agenta/entities/simpleQueue"
import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    createStandardColumns,
    FiltersPopoverTrigger,
} from "@agenta/ui/table"
import {ArrowRight, PlusIcon} from "@phosphor-icons/react"
import {Button, Divider, Input, Select, Tag, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context/AnnotationUIContext"
import {
    createQueueDrawerOpenAtom,
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerSelectionAtom,
} from "../../state/atoms"
import CreateQueueDrawer from "../CreateQueueDrawer"

import AssignmentsCell from "./cells/AssignmentsCell"
import CreatedByCell from "./cells/CreatedByCell"
import QueueProgressCell from "./cells/QueueProgressCell"

const kindColorMap: Record<string, string> = {
    traces: "blue",
    testcases: "green",
}

const ANNOTATION_QUEUES_DOCS_URL = "https://docs.agenta.ai"

function AnnotationQueuesEmptyState({onCreate}: {onCreate: () => void}) {
    return (
        <div className="px-4 py-6">
            <div className="mx-auto flex min-h-[300px] max-w-3xl items-center justify-center">
                <div className="flex max-w-xl flex-col items-center text-center gap-3">
                    <Typography.Text className="text-lg font-semibold">
                        Create your first annotation queue
                    </Typography.Text>
                    <Typography.Text>
                        Route trace and test case reviews into a shared queue, assign work, and keep
                        annotation progress visible in one place.
                    </Typography.Text>
                    <div className="flex gap-2 mt-5">
                        <Button type="primary" icon={<PlusIcon size={16} />} onClick={onCreate}>
                            New Queue
                        </Button>
                        <Button href={ANNOTATION_QUEUES_DOCS_URL} target="_blank" rel="noreferrer">
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
            <div className="mx-auto flex min-h-[220px] max-w-2xl items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-8">
                <div className="flex max-w-lg flex-col items-center text-center">
                    <Typography.Title
                        level={4}
                        className="!mb-2 !text-xl !font-semibold !text-zinc-900 md:!text-2xl"
                    >
                        No queues match your search
                    </Typography.Title>
                    <Typography.Paragraph className="!mb-5 !text-sm !leading-6 !text-zinc-500 md:!text-base">
                        No annotation queues matched "{searchTerm}". Try a different name or clear
                        the search.
                    </Typography.Paragraph>
                    <Button onClick={onClearSearch}>Clear search</Button>
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
        <div className="flex flex-col gap-4 p-4 bg-white rounded-lg shadow-lg border border-gray-200 min-w-[240px]">
            <div className="flex flex-col gap-2">
                <Typography.Text strong className="text-gray-700">
                    Type
                </Typography.Text>
                <Select
                    value={draftKind ?? ""}
                    onChange={(val) => setDraftKind(val === "" ? null : (val as SimpleQueueKind))}
                    options={KIND_OPTIONS}
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

const AnnotationQueuesView = () => {
    const navigation = useAnnotationNavigation()
    const searchTerm = useAtomValue(simpleQueueSearchTermAtom)
    const kindFilter = useAtomValue(simpleQueueKindFilterAtom)
    const setDrawerOpen = useSetAtom(createQueueDrawerOpenAtom)
    const setDrawerDefaultKind = useSetAtom(createQueueDrawerDefaultKindAtom)
    const setDrawerSelection = useSetAtom(createQueueDrawerSelectionAtom)
    const setSearchTerm = useSetAtom(simpleQueueSearchTermAtom)
    const normalizedSearchTerm = searchTerm.trim()
    const hasSearchQuery = normalizedSearchTerm.length > 0

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
    })

    const columns = useMemo(
        () =>
            createStandardColumns<SimpleQueueTableRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 220,
                    columnVisibilityLocked: true,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        return (
                            <div className="h-full flex items-center">
                                <Typography.Text strong>
                                    {record.name || "Untitled"}
                                </Typography.Text>
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
                                    {kind === "traces" ? "Traces" : "Test cases"}
                                </Tag>
                            </div>
                        )
                    },
                },
                {
                    type: "text",
                    key: "reviewed",
                    title: "Reviewed",
                    width: 160,
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
                    key: "description",
                    title: "Description",
                    width: 280,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        if (!record.description) {
                            return (
                                <div className="h-full flex items-center">
                                    <Typography.Text type="secondary">—</Typography.Text>
                                </div>
                            )
                        }

                        return (
                            <div className="h-full flex items-center min-w-0">
                                <Typography.Text type="secondary" className="block truncate">
                                    {record.description}
                                </Typography.Text>
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
                    type: "text",
                    key: "assignments",
                    title: "Assignees",
                    width: 180,
                    render: (_value, record) => {
                        if (record.__isSkeleton) return null
                        return (
                            <div className="h-full flex items-center">
                                <AssignmentsCell assignments={record.data?.assignments} />
                            </div>
                        )
                    },
                },
                {
                    type: "actions",
                    width: 48,
                    maxWidth: 48,
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
                                    navigation.navigateToResults(record.run_id)
                                }
                            },
                        },
                    ],
                    getRecordId: (record) => record.id,
                },
            ]),
        [navigation],
    )

    const filtersNode = useMemo(() => <QueuesHeaderFilters />, [])

    const createButton = useMemo(
        () => (
            <Button type="primary" icon={<PlusIcon size={14} />} onClick={openCreateQueueDrawer}>
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

    return (
        <div className="flex flex-col h-full min-h-0 grow w-full">
            <InfiniteVirtualTableFeatureShell<SimpleQueueTableRow>
                {...table.shellProps}
                columns={columns}
                filters={filtersNode}
                primaryActions={createButton}
                tableProps={tableProps}
                autoHeight
            />
            <CreateQueueDrawer />
        </div>
    )
}

export default AnnotationQueuesView
