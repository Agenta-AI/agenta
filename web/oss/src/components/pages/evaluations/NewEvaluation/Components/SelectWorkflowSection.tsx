import {memo, useCallback, useEffect, useMemo, useState} from "react"

import {WorkflowKindTag, WorkflowTypeTag} from "@agenta/entity-ui/workflow"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {createStandardColumns} from "@agenta/ui/table"
import {InfoCircleOutlined} from "@ant-design/icons"
import {Input, Select, Switch, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {AppNameCell} from "@/oss/components/pages/app-management/components/appWorkflowColumns"
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
    /** Whether evaluators are visible by default. Off (apps-only) is the right
     *  default everywhere except a context that explicitly wants both kinds. */
    initialShowEvaluators?: boolean
    className?: string
}

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
                    <WorkflowKindTag isEvaluator={record.isEvaluator} />
                </div>
            ),
        },
        {
            type: "text",
            key: "appType",
            title: "Type",
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <WorkflowTypeTag
                        isEvaluator={record.isEvaluator}
                        workflowKey={record.workflowKey}
                        workflowType={record.workflowType}
                    />
                </div>
            ),
        },
        {
            type: "date",
            key: "createdAt",
            title: "Created At",
        },
    ])

const EVALUATOR_TOOLTIP = "Run evaluations on evaluators"

// Subtypes the user can pick in the type filter. Maps 1:1 to the subset of
// `WorkflowTypeFilter` values that name a concrete workflow type. "all" is
// modelled separately so it doesn't have to live inside this list.
type WorkflowSubtype = "chat" | "completion" | "custom" | "llm" | "match" | "code" | "hook"

const APP_TYPE_OPTIONS: {label: string; value: WorkflowSubtype}[] = [
    {label: "Chat", value: "chat"},
    {label: "Completion", value: "completion"},
    {label: "Custom", value: "custom"},
]

const EVALUATOR_TYPE_OPTIONS: {label: string; value: WorkflowSubtype}[] = [
    {label: "LLM as judge", value: "llm"},
    {label: "Matchers", value: "match"},
    {label: "Custom code", value: "code"},
    {label: "Webhooks", value: "hook"},
]

const EVALUATOR_SUBTYPES: ReadonlySet<WorkflowSubtype> = new Set(["llm", "match", "code", "hook"])

const SelectWorkflowSection = ({
    selectedWorkflowId,
    onSelectWorkflow,
    disabled,
    initialShowEvaluators = false,
    className,
}: SelectWorkflowSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const setStoreSearchTerm = useSetAtom(appWorkflowSearchTermAtom)
    const setWorkflowTypeFilter = useSetAtom(workflowTypeFilterAtom)
    const setWorkflowInvokableOnly = useSetAtom(workflowInvokableOnlyAtom)

    const [showEvaluators, setShowEvaluators] = useState<boolean>(
        disabled ? false : initialShowEvaluators,
    )
    // "all" means no subtype filter — surfaced as an explicit first option in
    // the Select rather than relying on a placeholder + clear button so the
    // reset path is always visible.
    const [typeFilter, setTypeFilter] = useState<WorkflowSubtype | "all">("all")

    // Toggling evaluators off should drop any active evaluator-subtype filter
    // — otherwise the picker would silently render an empty list.
    useEffect(() => {
        if (!showEvaluators && typeFilter !== "all" && EVALUATOR_SUBTYPES.has(typeFilter)) {
            setTypeFilter("all")
        }
    }, [showEvaluators, typeFilter])

    // Effective filter pushed to the shared store atom. Subtype always wins
    // when set; otherwise fall back to the kind dictated by the toggle.
    const effectiveFilter: WorkflowTypeFilter = useMemo(() => {
        if (disabled) return "app"
        if (typeFilter !== "all") return typeFilter
        return showEvaluators ? "all" : "app"
    }, [disabled, showEvaluators, typeFilter])

    useEffect(() => {
        setWorkflowTypeFilter(effectiveFilter)
    }, [effectiveFilter, setWorkflowTypeFilter])

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

    const table = useTableManager<AppWorkflowRow>({
        datasetStore: workflowPaginatedStore.store as never,
        scopeId: "evaluation-workflow-selector",
        pageSize: 50,
        searchDeps: [searchTerm, effectiveFilter],
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createSelectWorkflowColumns(), [])

    const tableRows = table.rows
    const onSelectRow = useCallback(
        (selectedRowKeys: React.Key[]) => {
            if (disabled) return
            const selectedId = selectedRowKeys.at(-1) as string | undefined
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
            type: "radio" as const,
            selectedRowKeys: selectedWorkflowId ? [selectedWorkflowId] : [],
            onChange: (keys: React.Key[]) => onSelectRow(keys),
            getCheckboxProps: () => ({disabled}),
            selectOnRowClick: !disabled,
        }),
        [selectedWorkflowId, onSelectRow, disabled],
    )

    // "All types" sits ungrouped at the top so the reset path is always one
    // click away. App types are always present; evaluator types only appear
    // when the toggle is on.
    const typeOptions = useMemo(() => {
        const items: (
            | {label: string; value: WorkflowSubtype | "all"}
            | {label: string; options: {label: string; value: WorkflowSubtype}[]}
        )[] = [
            {label: "All types", value: "all"},
            {label: "Applications", options: APP_TYPE_OPTIONS},
        ]
        if (showEvaluators) {
            items.push({label: "Evaluators", options: EVALUATOR_TYPE_OPTIONS})
        }
        return items
    }, [showEvaluators])

    const emptyDescription = disabled
        ? "Application selection is locked in app scope"
        : showEvaluators
          ? "No applications or evaluators available"
          : "No applications available"

    return (
        <div className={clsx(className)}>
            <div className="flex items-center justify-between mb-2 gap-4">
                {disabled ? (
                    <span />
                ) : (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <Switch
                            size="small"
                            checked={showEvaluators}
                            onChange={setShowEvaluators}
                        />
                        <Typography.Text>Show evaluators</Typography.Text>
                        <Tooltip title={EVALUATOR_TOOLTIP}>
                            <InfoCircleOutlined className="text-gray-400" />
                        </Tooltip>
                    </label>
                )}
                <div className="flex items-center gap-2 shrink-0">
                    {!disabled && (
                        <Select<WorkflowSubtype | "all">
                            className="w-[180px]"
                            value={typeFilter}
                            onChange={(value) => setTypeFilter(value)}
                            options={typeOptions}
                            // Antd's grouped options ship an extra left
                            // indent (`.ant-select-item-option-grouped`) on
                            // top of the regular item padding. With only one
                            // or two groups visible the indent reads as
                            // accidental — flatten it so subitems align with
                            // the ungrouped "All types" entry.
                            popupClassName="[&_.ant-select-item-option-grouped]:!ps-3"
                        />
                    )}
                    <Input.Search
                        placeholder="Search"
                        className="w-[300px] [&_input]:!py-[3.1px]"
                        value={searchTerm}
                        onChange={(e) => handleSearch(e.target.value)}
                    />
                </div>
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
