import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {createStandardColumns} from "@agenta/ui/table"
import {GaugeIcon, RocketIcon} from "@phosphor-icons/react"
import {Input, Tabs, Tag} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    AppNameCell,
    AppTypeCell,
} from "@/oss/components/pages/app-management/components/appWorkflowColumns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import {
    appWorkflowSearchTermAtom,
    workflowInvokableOnlyAtom,
    workflowPaginatedStore,
    workflowTypeFilterAtom,
    type WorkflowTypeFilter,
} from "@/oss/components/pages/app-management/store"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {ssr: false},
)

interface SelectWorkflowSectionProps {
    selectedWorkflowId: string
    /**
     * Fires when the user selects a row. `label` is the row's display name so
     * callers can render the selection (e.g. in a tag) without an extra fetch;
     * fire with an empty id to clear the selection.
     */
    onSelectWorkflow: (value: string, meta?: {label?: string; isEvaluator?: boolean}) => void
    /** When true, locks the picker to apps-only (used on app-scoped evaluation page) */
    disabled?: boolean
    /** Initial tab selection — defaults to "all"; set to "app" for app-scoped pages. */
    initialTypeFilter?: WorkflowTypeFilter
    className?: string
}

const KindCell = ({isEvaluator}: {isEvaluator: boolean}) => (
    <Tag color={isEvaluator ? "purple" : "blue"}>{isEvaluator ? "Evaluator" : "App"}</Tag>
)

const createSelectWorkflowColumns = () =>
    createStandardColumns<AppWorkflowRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            render: (_, record) => (
                <AppNameCell workflowId={record.workflowId} name={record.name} />
            ),
        },
        {
            type: "text",
            key: "kind",
            title: "Kind",
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <KindCell isEvaluator={record.isEvaluator} />
                </div>
            ),
        },
        {
            type: "text",
            key: "appType",
            title: "Type",
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <AppTypeCell workflowId={record.workflowId} />
                </div>
            ),
        },
        {
            type: "date",
            key: "createdAt",
            title: "Created At",
        },
    ])

// Match the icon/color vocabulary used by the header tabs in EvaluationsView
// so the two surfaces feel like the same family.
const TAB_ITEMS: {key: WorkflowTypeFilter; label: string; icon: ReactNode}[] = [
    {key: "all", label: "All", icon: null},
    {key: "app", label: "Apps", icon: <RocketIcon />},
    {key: "evaluator", label: "Evaluators", icon: <GaugeIcon />},
]

const TAB_COLOR_MAP: Record<WorkflowTypeFilter, string> = {
    all: "#e0f2fe",
    app: "#dbeafe",
    evaluator: "#ede9fe",
}

const SelectWorkflowSection = ({
    selectedWorkflowId,
    onSelectWorkflow,
    disabled,
    initialTypeFilter = "all",
    className,
}: SelectWorkflowSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const setStoreSearchTerm = useSetAtom(appWorkflowSearchTermAtom)
    const setWorkflowTypeFilter = useSetAtom(workflowTypeFilterAtom)
    const setWorkflowInvokableOnly = useSetAtom(workflowInvokableOnlyAtom)
    const [activeTab, setActiveTab] = useState<WorkflowTypeFilter>(
        disabled ? "app" : initialTypeFilter,
    )

    // Keep the shared filter atom in sync with the active tab while the section is mounted.
    useEffect(() => {
        const effective: WorkflowTypeFilter = disabled ? "app" : activeTab
        setWorkflowTypeFilter(effective)
    }, [activeTab, disabled, setWorkflowTypeFilter])

    // The evaluation subject must be auto-invokable (has service URL, not a
    // human evaluator). App-management resets this to false on its own mount.
    useEffect(() => {
        setWorkflowInvokableOnly(true)
        return () => {
            setWorkflowInvokableOnly(false)
        }
    }, [setWorkflowInvokableOnly])

    const handleSearch = useCallback(
        (value: string) => {
            setSearchTerm(value)
            setStoreSearchTerm(value)
        },
        [setStoreSearchTerm],
    )

    const handleTabChange = useCallback((key: string) => {
        setActiveTab(key as WorkflowTypeFilter)
    }, [])

    const table = useTableManager<AppWorkflowRow>({
        datasetStore: workflowPaginatedStore.store as never,
        scopeId: "evaluation-workflow-selector",
        pageSize: 50,
        searchDeps: [searchTerm, activeTab],
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createSelectWorkflowColumns(), [])

    const tableRows = table.rows
    const onSelectRow = useCallback(
        (selectedRowKeys: React.Key[]) => {
            if (disabled) return
            const selectedId = selectedRowKeys[0] as string | undefined
            if (!selectedId) {
                onSelectWorkflow("")
                return
            }
            const row = tableRows.find((r) => r.workflowId === selectedId)
            onSelectWorkflow(selectedId, {
                label: row?.name,
                isEvaluator: row?.isEvaluator,
            })
        },
        [disabled, onSelectWorkflow, tableRows],
    )

    const rowSelection = useMemo(
        () => ({
            type: "checkbox" as const,
            selectedRowKeys: selectedWorkflowId ? [selectedWorkflowId] : [],
            onChange: (keys: React.Key[]) => onSelectRow(keys),
            getCheckboxProps: () => ({disabled}),
            selectOnRowClick: !disabled,
        }),
        [selectedWorkflowId, onSelectRow, disabled],
    )

    const tabItemsWithIcons = useMemo(
        () =>
            TAB_ITEMS.map((item) => ({
                key: item.key,
                label: (
                    <span className="inline-flex items-center gap-2">
                        {item.icon}
                        {item.label}
                    </span>
                ),
            })),
        [],
    )

    const tabIndicatorColor = TAB_COLOR_MAP[activeTab] ?? TAB_COLOR_MAP.all

    const emptyDescription = disabled
        ? "Application selection is locked in app scope"
        : activeTab === "evaluator"
          ? "No evaluators available"
          : activeTab === "app"
            ? "No applications available"
            : "No workflows available"

    return (
        <div className={clsx(className)}>
            <div className="flex items-center justify-between mb-2 gap-4">
                {disabled ? (
                    <span />
                ) : (
                    <div
                        // The outer modal's Tabs (tabPlacement="left") ships JSS rules
                        // via descendant selectors (.ant-tabs-ink-bar:none,
                        // .ant-tabs-tab-active:borderRight/bg, .ant-tabs-tab:hover:bg)
                        // that cascade into nested tabs. These !important overrides
                        // restore a standard horizontal, ink-bar-under style.
                        className={clsx(
                            "[&_.ant-tabs]:!block",
                            "[&_.ant-tabs]:!w-auto",
                            "[&_.ant-tabs]:!min-h-0",
                            "[&_.ant-tabs]:!grow-0",
                            "[&_.ant-tabs-nav]:!mb-0",
                            "[&_.ant-tabs-nav]:!w-auto",
                            "[&_.ant-tabs-ink-bar]:!block",
                            "[&_.ant-tabs-ink-bar]:!bg-[var(--tab-indicator-color)]",
                            "[&_.ant-tabs-content]:!hidden",
                            "[&_.ant-tabs-tab]:!p-0",
                            "[&_.ant-tabs-tab]:!mt-0",
                            "[&_.ant-tabs-tab]:!mr-6",
                            "[&_.ant-tabs-tab:hover]:!bg-transparent",
                            "[&_.ant-tabs-tab-active]:!bg-transparent",
                            "[&_.ant-tabs-tab-active]:!border-r-0",
                            "[&_.ant-tabs-tab-btn]:!py-2",
                            "[&_.ant-tabs-tab-btn]:!font-medium",
                            "[&_.ant-tabs-tab-btn]:!text-[14px]",
                            "[&_.ant-tabs-tab-btn]:!leading-[1.5714285714]",
                            "[&_.ant-tabs-tab-btn]:!inline-flex",
                            "[&_.ant-tabs-tab-btn]:!items-center",
                            "[&_.ant-tabs-tab-btn]:!gap-2",
                        )}
                        style={
                            {
                                "--tab-indicator-color": tabIndicatorColor,
                            } as CSSProperties
                        }
                    >
                        <Tabs
                            activeKey={activeTab}
                            onChange={handleTabChange}
                            items={tabItemsWithIcons}
                            destroyOnHidden
                        />
                    </div>
                )}
                <Input.Search
                    placeholder="Search"
                    className="w-[300px] [&_input]:!py-[3.1px]"
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                />
            </div>
            <div className="h-[455px]">
                <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
                    {...table.shellProps}
                    columns={columns}
                    rowSelection={rowSelection}
                    enableExport={false}
                    autoHeight
                    locale={{
                        emptyText: (
                            <NoResultsFound className="!py-10" description={emptyDescription} />
                        ),
                    }}
                />
            </div>
        </div>
    )
}

export default memo(SelectWorkflowSection)
