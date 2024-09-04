import {_Evaluation, EvaluationStatus, EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {
    ArrowsLeftRight,
    Database,
    Gauge,
    GearSix,
    Note,
    Plus,
    Rocket,
    Trash,
} from "@phosphor-icons/react"
import {Button, Dropdown, DropdownProps, message, Popover, Space, Table, Tag} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {ColumnsType} from "antd/es/table"
import {EditOutlined, InfoCircleOutlined, MoreOutlined} from "@ant-design/icons"
import EvaluatorsModal from "./EvaluatorsModal/EvaluatorsModal"
import {useQueryParam} from "@/hooks/useQuery"
import {formatDay} from "@/lib/helpers/dateTimeHelper"
import {calcEvalDuration, getTypedValue} from "@/lib/helpers/evaluate"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import NewEvaluationModal from "./NewEvaluationModel"
import {
    deleteEvaluations,
    fetchAllEvaluations,
    fetchAllEvaluatorConfigs,
    fetchAllEvaluators,
    fetchEvaluationStatus,
} from "@/services/evaluations/api"
import {useAppId} from "@/hooks/useAppId"
import {useAtom} from "jotai"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import DeleteEvaluationModal from "@/components/DeleteEvaluationModal/DeleteEvaluationModal"
import {useRouter} from "next/router"
import EditColumns, {generateEditItems} from "./EditColumns"
import StatusRenderer from "../../overview/automaticEvaluation/StatusRenderer"
import {runningStatuses} from "../../evaluations/cellRenderers/cellRenderers"
import {useUpdateEffect} from "usehooks-ts"
import {shortPoll} from "@/lib/helpers/utils"
import {getFilterParams} from "./SearchFilter"
import {uniqBy} from "lodash"
import NewEvaluatorModal from "../evaluators/NewEvaluatorModal"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    resultTag: {
        minWidth: 150,
        display: "flex",
        cursor: "pointer",
        alignItems: "stretch",
        borderRadius: theme.borderRadiusSM,
        border: `1px solid ${theme.colorBorder}`,
        textAlign: "center",
        "& > div:nth-child(1)": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
            lineHeight: theme.lineHeight,
            flex: 1,
            borderRight: `1px solid ${theme.colorBorder}`,
            padding: "0 7px",
        },
        "& > div:nth-child(2)": {
            padding: "0 7px",
        },
    },
    button: {
        display: "flex",
        alignItems: "center",
    },
}))

const AutoEvaluation = () => {
    const classes = useStyles()
    const appId = useAppId()
    const router = useRouter()

    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [evaluationList, setEvaluationList] = useState<_Evaluation[]>([])
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [isEvalLoading, setIsEvalLoading] = useState(false)
    const [evaluators, setEvaluators] = useAtom(evaluatorsAtom)
    const setEvaluatorConfigs = useAtom(evaluatorConfigsAtom)[1]
    const [selectedEvalRecord, setSelectedEvalRecord] = useState<_Evaluation>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [isDeleteEvalMultipleModalOpen, setIsDeleteEvalMultipleModalOpen] = useState(false)
    const [editColumns, setEditColumns] = useState<string[]>([])
    const [isFilterColsDropdownOpen, setIsFilterColsDropdownOpen] = useState(false)
    const [selectedConfigEdit, setSelectedConfigEdit] = useState<EvaluatorConfig>()
    const [isEditEvalConfigOpen, setIsEditEvalConfigOpen] = useState(false)
    const [isConfigEvaluatorModalOpen, setIsConfigEvaluatorModalOpen] = useQueryParam(
        "configureEvaluatorModal",
        "",
    )
    const stoppers = useRef<Function>()

    const fetchEvaluations = async () => {
        try {
            setIsEvalLoading(true)
            const [allEvaluations, allEvaluators, allEvaluatorConfigs] = await Promise.all([
                fetchAllEvaluations(appId),
                fetchAllEvaluators(),
                fetchAllEvaluatorConfigs(appId),
            ])
            const result = allEvaluations.sort(
                (a, b) =>
                    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
            )
            setEvaluationList(result)
            setEvaluators(allEvaluators)
            setEvaluatorConfigs(allEvaluatorConfigs)
        } catch (error) {
            console.error(error)
        } finally {
            setIsEvalLoading(false)
        }
    }

    const handleDeleteMultipleEvaluations = async () => {
        const evaluationsIds = selectedRowKeys.map((key) => key.toString())
        try {
            setIsEvalLoading(true)
            await deleteEvaluations(evaluationsIds)
            setEvaluationList((prevEvaluationsList) =>
                prevEvaluationsList.filter((evaluation) => !evaluationsIds.includes(evaluation.id)),
            )
            setSelectedRowKeys([])
            message.success("Evaluations Deleted")
        } catch (error) {
            console.error(error)
        } finally {
            setIsEvalLoading(false)
        }
    }

    const handleDeleteEvaluation = async (record: _Evaluation) => {
        try {
            setIsEvalLoading(true)
            await deleteEvaluations([record.id])
            setEvaluationList((prevEvaluationsList) =>
                prevEvaluationsList.filter((evaluation) => ![record.id].includes(evaluation.id)),
            )
            message.success("Evaluation Deleted")
        } catch (error) {
            console.error(error)
        } finally {
            setIsEvalLoading(false)
        }
    }

    const compareDisabled = useMemo(() => {
        const evalList = evaluationList.filter((e) => selectedRowKeys.includes(e.id))
        return (
            evalList.length < 2 ||
            evalList.some(
                (item) =>
                    item.status.value === EvaluationStatus.STARTED ||
                    item.status.value === EvaluationStatus.INITIALIZED ||
                    item.testset.id !== evalList[0].testset.id,
            )
        )
    }, [selectedRowKeys])

    const onToggleEvaluatorVisibility = (evalConfigId: string) => {
        if (!editColumns.includes(evalConfigId)) {
            setEditColumns([...editColumns, evalConfigId])
        } else {
            setEditColumns(editColumns.filter((item) => item !== evalConfigId))
        }
    }

    const handleOpenChangeEditCols: DropdownProps["onOpenChange"] = (nextOpen, info) => {
        if (info.source === "trigger" || nextOpen) {
            setIsFilterColsDropdownOpen(nextOpen)
        }
    }

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const evaluatorConfigs = useMemo(
        () =>
            uniqBy(
                evaluationList
                    .map((item) =>
                        item.aggregated_results.map((item) => ({
                            ...item.evaluator_config,
                            evaluator: evaluators.find(
                                (e) => e.key === item.evaluator_config.evaluator_key,
                            ),
                        })),
                    )
                    .flat(),
                "id",
            ),
        [evaluationList],
    )

    const columns: ColumnsType<_Evaluation> = [
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            fixed: "left",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                return (
                    <span>
                        {variantNameWithRev({
                            variant_name: value[0].variantName,
                            revision: record.revisions[0],
                        })}
                    </span>
                )
            },
            ...getFilterParams("variants", "text"),
        },
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return <span>{record.testset.name}</span>
            },
            ...getFilterParams("testset", "text"),
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            onHeaderCell: () => ({
                style: {minWidth: 240},
            }),
            render: (_, record) => {
                return <StatusRenderer {...record} />
            },
            ...getFilterParams("status", "text"),
        },
        {
            title: "Results",
            key: "results",
            onHeaderCell: () => ({style: {minWidth: 240}}),
            children: evaluatorConfigs.map((evaluator, idx) => ({
                title: evaluator.name,
                key: `results-${idx}`,
                onHeaderCell: () => ({style: {minWidth: 240}}),
                showSorterTooltip: false,
                sorter: {
                    compare: (a, b) => {
                        const getSortValue = (item: _Evaluation) => {
                            if (item.aggregated_results && item.aggregated_results.length > 0) {
                                const result = item.aggregated_results[0].result
                                if (result && typeof result.value === "number") {
                                    return result.value
                                }
                            }
                            return 0
                        }
                        return getSortValue(a) - getSortValue(b)
                    },
                },
                render: (_, record) => {
                    if (!evaluators?.length) return

                    const matchingResults = record.aggregated_results.filter(
                        (result) => result.evaluator_config.id === evaluator.id,
                    )

                    return (
                        <Space>
                            {matchingResults.map((result, index) =>
                                result.result.error ? (
                                    <Popover
                                        key={index}
                                        placement="bottom"
                                        trigger={"click"}
                                        arrow={false}
                                        content={
                                            <div className="w-[256px]">
                                                {result.result.error?.stacktrace}
                                            </div>
                                        }
                                        title={result.result.error?.message}
                                    >
                                        <Button
                                            onClick={(e) => e.stopPropagation()}
                                            icon={<InfoCircleOutlined />}
                                            type="link"
                                        >
                                            Read more
                                        </Button>
                                    </Popover>
                                ) : (
                                    <Popover
                                        key={index}
                                        placement="bottom"
                                        trigger={"hover"}
                                        arrow={false}
                                        content={
                                            <div
                                                className="w-[256px] flex flex-col gap-1"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="font-[500]">
                                                    {result.evaluator_config.name}
                                                </div>
                                                <div>{getTypedValue(result.result)}</div>
                                            </div>
                                        }
                                        title={
                                            <div
                                                className="flex items-center justify-between"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Tag color={evaluator?.evaluator?.color}>
                                                    {evaluator?.name}
                                                </Tag>
                                                <Button
                                                    icon={<EditOutlined />}
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setSelectedConfigEdit(
                                                            result.evaluator_config,
                                                        )
                                                        setIsEditEvalConfigOpen(true)
                                                    }}
                                                />
                                            </div>
                                        }
                                    >
                                        <div
                                            onClick={(e) => e.stopPropagation()}
                                            className={classes.resultTag}
                                        >
                                            <div>{result.evaluator_config.name}</div>
                                            <div>{getTypedValue(result.result)}</div>
                                        </div>
                                    </Popover>
                                ),
                            )}
                        </Space>
                    )
                },
            })),
        },
        {
            title: "Created on",
            dataIndex: "created_at",
            key: "createdAt",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return formatDay(record.created_at)
            },
            ...getFilterParams("created_at", "date"),
        },
        {
            title: "Avg. Latency",
            dataIndex: "average_latency",
            key: "average_latency",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return getTypedValue(record.average_latency)
            },
            ...getFilterParams("average_latency", "number"),
        },
        {
            title: "Total Cost",
            dataIndex: "average_cost",
            key: "average_cost",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return getTypedValue(record.average_cost)
            },
            ...getFilterParams("total_cost", "number"),
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "details",
                                    label: "Open details",
                                    icon: <Note size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(
                                            `/apps/${appId}/evaluations/results/${record.id}`,
                                        )
                                    },
                                },
                                {
                                    key: "variant",
                                    label: "View variant",
                                    icon: <Rocket size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleNavigation(
                                            record.variants[0].variantName,
                                            record.revisions[0],
                                        )
                                    },
                                },
                                {
                                    key: "view_testset",
                                    label: "View test set",
                                    icon: <Database size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/apps/${appId}/testsets/${record.testset.id}`)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "delete_eval",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedEvalRecord(record)
                                        setIsDeleteEvalModalOpen(true)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            onClick={(e) => e.stopPropagation()}
                            type="text"
                            icon={<MoreOutlined />}
                            size="small"
                        />
                    </Dropdown>
                )
            },
        },
    ]

    const runningEvaluationIds = useMemo(
        () =>
            evaluationList
                .filter((item) => runningStatuses.includes(item.status.value))
                .map((item) => item.id),
        [evaluationList],
    )

    useEffect(() => {
        if (!appId) return

        fetchEvaluations()
    }, [appId])

    useUpdateEffect(() => {
        stoppers.current?.()

        if (runningEvaluationIds.length) {
            stoppers.current = shortPoll(
                () =>
                    Promise.all(runningEvaluationIds.map((id) => fetchEvaluationStatus(id)))
                        .then((res) => {
                            setEvaluationList((prev) => {
                                const newEvals = [...prev]
                                runningEvaluationIds.forEach((id, ix) => {
                                    const index = newEvals.findIndex((e) => e.id === id)
                                    if (index !== -1) {
                                        newEvals[index].status = res[ix].status
                                        newEvals[index].duration = calcEvalDuration(newEvals[index])
                                    }
                                })
                                if (
                                    res.some((item) => !runningStatuses.includes(item.status.value))
                                )
                                    fetchEvaluations()
                                return newEvals
                            })
                        })
                        .catch(console.error),
                {delayMs: 2000, timeoutMs: Infinity},
            ).stopper
        }

        return () => {
            stoppers.current?.()
        }
    }, [JSON.stringify(runningEvaluationIds)])

    useEffect(() => {
        const defaultColumnNames = columns.map((item) => item.key as string)
        setEditColumns(defaultColumnNames)
    }, [])

    const editedColumns = columns.map((item) => ({
        ...item,
        hidden: !editColumns?.includes(item.key as string),
    }))

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <Space>
                    <Button
                        type="primary"
                        icon={<Plus size={14} />}
                        className={classes.button}
                        onClick={() => setNewEvalModalOpen(true)}
                    >
                        Start new evaluation
                    </Button>
                    <Button
                        icon={<Gauge size={14} />}
                        className={classes.button}
                        onClick={() => setIsConfigEvaluatorModalOpen("open")}
                    >
                        Configure evaluators
                    </Button>
                </Space>
                <Space>
                    <Button
                        danger
                        type="text"
                        icon={<Trash size={14} />}
                        className={classes.button}
                        onClick={() => setIsDeleteEvalMultipleModalOpen(true)}
                        disabled={selectedRowKeys.length == 0}
                    >
                        Delete
                    </Button>
                    <Button
                        type="text"
                        icon={<ArrowsLeftRight size={14} />}
                        className={classes.button}
                        disabled={compareDisabled}
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/evaluations/results/compare?evaluations=${selectedRowKeys.join(",")}`,
                            )
                        }
                    >
                        Compare
                    </Button>
                    <EditColumns
                        items={generateEditItems(columns as ColumnsType, editColumns)}
                        isOpen={isFilterColsDropdownOpen}
                        handleOpenChange={handleOpenChangeEditCols}
                        shownCols={editColumns}
                        onClick={({key}) => {
                            onToggleEvaluatorVisibility(key)
                            setIsFilterColsDropdownOpen(true)
                        }}
                    />
                </Space>
            </div>

            <Table
                loading={isEvalLoading}
                rowSelection={{
                    type: "checkbox",
                    columnWidth: 48,
                    onChange: (selectedRowKeys: React.Key[]) => {
                        setSelectedRowKeys(selectedRowKeys)
                    },
                }}
                className="ph-no-capture"
                columns={editedColumns}
                rowKey={"id"}
                dataSource={evaluationList}
                scroll={{x: true}}
                bordered
                pagination={false}
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    onClick: () => {},
                })}
            />

            <NewEvaluationModal
                open={newEvalModalOpen}
                onOpenEvaluatorModal={() => {
                    setIsConfigEvaluatorModalOpen("open")
                    setNewEvalModalOpen(false)
                }}
                onCancel={() => {
                    setNewEvalModalOpen(false)
                }}
                onSuccess={() => {
                    setNewEvalModalOpen(false)
                    fetchEvaluations()
                }}
            />

            {isConfigEvaluatorModalOpen === "open" && (
                <EvaluatorsModal
                    open={isConfigEvaluatorModalOpen === "open"}
                    onCancel={() => setIsConfigEvaluatorModalOpen("")}
                />
            )}

            <NewEvaluatorModal
                open={false}
                onSuccess={() => {
                    setIsEditEvalConfigOpen(false)
                    fetchEvaluations()
                }}
                newEvalModalConfigOpen={isEditEvalConfigOpen}
                setNewEvalModalConfigOpen={setIsEditEvalConfigOpen}
                setNewEvalModalOpen={() => {}}
                editMode={true}
                initialValues={selectedConfigEdit}
            />

            {selectedEvalRecord && (
                <DeleteEvaluationModal
                    open={isDeleteEvalModalOpen}
                    onCancel={() => setIsDeleteEvalModalOpen(false)}
                    onOk={async () => {
                        await handleDeleteEvaluation(selectedEvalRecord)
                        setIsDeleteEvalModalOpen(false)
                    }}
                    evaluationType={"automatic evaluation"}
                />
            )}
            {isDeleteEvalMultipleModalOpen && (
                <DeleteEvaluationModal
                    open={isDeleteEvalMultipleModalOpen}
                    onCancel={() => setIsDeleteEvalMultipleModalOpen(false)}
                    onOk={async () => {
                        await handleDeleteMultipleEvaluations()
                        setIsDeleteEvalMultipleModalOpen(false)
                    }}
                    evaluationType={"single model evaluation"}
                />
            )}
        </div>
    )
}

export default AutoEvaluation
