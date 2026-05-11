import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useGroupedTreeData,
} from "@agenta/ui/table"
import {PlusOutlined} from "@ant-design/icons"
import {Button, Input, Space} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import router from "next/router"

import EvaluatorTemplateDropdown from "@/oss/components/Evaluators/components/EvaluatorTemplateDropdown"
import {
    evaluatorCategoryAtom,
    evaluatorSearchTermAtom,
} from "@/oss/components/Evaluators/store/evaluatorFilterAtoms"
import type {EvaluatorTableRow} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {evaluatorsPaginatedStore} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {
    createEvaluatorColumns,
    type EvaluatorColumnActions,
} from "@/oss/components/Evaluators/Table/assets/evaluatorColumns"
import useURL from "@/oss/hooks/useURL"

import type {SelectEvaluatorSectionProps} from "../../types"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {ssr: false},
)

const EMPTY_ACTIONS: EvaluatorColumnActions = {}

const getEvaluatorGroupKey = (row: EvaluatorTableRow) => row.workflowId
const getEvaluatorSelectableId = (row: EvaluatorTableRow) => row.revisionId

const SelectEvaluatorSection = <Preview extends boolean = false>({
    selectedEvalConfigs,
    setSelectedEvalConfigs,
    className,
    preview,
    selectedAppId,
    onSelectTemplate,
    onCreateHumanEvaluator,
    ...props
}: SelectEvaluatorSectionProps & {preview?: Preview}) => {
    const {projectURL} = useURL()
    const setCategory = useSetAtom(evaluatorCategoryAtom)
    const setStoreSearchTerm = useSetAtom(evaluatorSearchTermAtom)
    const [searchTerm, setSearchTerm] = useState("")
    const prevSelectedAppIdRef = useRef<string | undefined>()

    const category = preview ? "human" : "automatic"

    // Sync category with the evaluator store so it fetches the right type
    useEffect(() => {
        setCategory(category)
    }, [category, setCategory])

    const handleSearch = useCallback(
        (value: string) => {
            setSearchTerm(value)
            setStoreSearchTerm(value)
        },
        [setStoreSearchTerm],
    )

    // Refetch when app changes
    useEffect(() => {
        if (!selectedAppId) {
            prevSelectedAppIdRef.current = selectedAppId
            return
        }
        if (prevSelectedAppIdRef.current === selectedAppId) return
        prevSelectedAppIdRef.current = selectedAppId
        invalidateWorkflowsListCache()
    }, [selectedAppId])

    const evaluatorsRegistryUrl = useMemo(
        () => `${projectURL}/evaluators?tab=${preview ? "human" : "automatic"}`,
        [projectURL, preview],
    )

    const table = useTableManager<EvaluatorTableRow>({
        datasetStore: evaluatorsPaginatedStore.store as never,
        scopeId: "evaluation-evaluator-selector",
        pageSize: 50,
        searchDeps: [searchTerm, category],
        rowClassName: "variant-table-row",
    })

    const paginationRows = table.shellProps.pagination?.rows ?? []

    const {groupedDataSource, treeExpandable, resolveSelectableId, toDisplayKeys, expandState} =
        useGroupedTreeData({
            rows: paginationRows,
            getGroupKey: getEvaluatorGroupKey,
            getSelectableId: getEvaluatorSelectableId,
            groupKeyPrefix: "evaluator-group-",
        })

    const columns = useMemo(
        () => createEvaluatorColumns(EMPTY_ACTIONS, category, expandState),
        [category, expandState],
    )

    const onSelectEvalConfig = useCallback(
        (selectedRowKeys: React.Key[]) => {
            const revisionIds = (selectedRowKeys as string[]).map(resolveSelectableId)
            setSelectedEvalConfigs(revisionIds)
        },
        [setSelectedEvalConfigs, resolveSelectableId],
    )

    const displaySelectedKeys = useMemo(
        () => toDisplayKeys(selectedEvalConfigs),
        [selectedEvalConfigs, toDisplayKeys],
    )

    const rowSelection = useMemo(
        () => ({
            type: "checkbox" as const,
            selectedRowKeys: displaySelectedKeys,
            onChange: (keys: React.Key[]) => onSelectEvalConfig(keys),
            selectOnRowClick: true,
        }),
        [displaySelectedKeys, onSelectEvalConfig],
    )

    const hasRows = (table.shellProps.pagination?.rows?.length ?? 0) > 0

    return (
        <div className={clsx(className)} data-tour="evaluator-select" {...props}>
            <div className="flex items-center justify-between mb-2">
                <Input.Search
                    placeholder="Search"
                    className="w-[300px] [&_input]:!py-[3.1px]"
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                />
                <Space>
                    {!preview && onSelectTemplate ? (
                        <EvaluatorTemplateDropdown onSelect={onSelectTemplate} />
                    ) : (
                        <Button
                            icon={<PlusOutlined />}
                            onClick={
                                preview && onCreateHumanEvaluator
                                    ? onCreateHumanEvaluator
                                    : () => router.push(evaluatorsRegistryUrl)
                            }
                        >
                            Create new evaluator
                        </Button>
                    )}
                </Space>
            </div>

            <div className="h-[455px]">
                {!hasRows && !searchTerm ? (
                    <NoResultsFound
                        className="!py-20"
                        title="No evaluators yet"
                        description="Evaluators help you measure and analyze your model's responses."
                        primaryActionSlot={
                            !preview && onSelectTemplate ? (
                                <EvaluatorTemplateDropdown onSelect={onSelectTemplate} />
                            ) : (
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    onClick={
                                        preview && onCreateHumanEvaluator
                                            ? onCreateHumanEvaluator
                                            : () => router.push(evaluatorsRegistryUrl)
                                    }
                                >
                                    Create your first evaluator
                                </Button>
                            )
                        }
                    />
                ) : (
                    <InfiniteVirtualTableFeatureShell<EvaluatorTableRow>
                        {...table.shellProps}
                        columns={columns}
                        rowSelection={rowSelection}
                        enableExport={false}
                        autoHeight
                        dataSource={groupedDataSource}
                        tableProps={{
                            ...table.shellProps.tableProps,
                            expandable: treeExpandable,
                        }}
                        locale={{
                            emptyText: (
                                <NoResultsFound
                                    className="!py-10"
                                    description="No evaluators match your search"
                                />
                            ),
                        }}
                    />
                )}
            </div>
        </div>
    )
}

export default memo(SelectEvaluatorSection)
