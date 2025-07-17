// @ts-nocheck
import {useEffect, useMemo, useRef, useState} from "react"

import {EditOutlined, MoreOutlined, PlusOutlined, SwapOutlined} from "@ant-design/icons"
import {Database, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, message, Popover, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import DeleteEvaluationModal from "@/oss/components/DeleteEvaluationModal/DeleteEvaluationModal"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {calcEvalDuration, getTypedValue} from "@/oss/lib/helpers/evaluate"
import {shortPoll} from "@/oss/lib/helpers/utils"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {_Evaluation, EvaluationStatus, EvaluatorConfig, JSSTheme} from "@/oss/lib/Types"
import {
    deleteEvaluations,
    fetchAllEvaluations,
    fetchEvaluationStatus,
} from "@/oss/services/evaluations/api"

import {runningStatuses} from "../../evaluations/cellRenderers/cellRenderers"
import StatusRenderer from "../../evaluations/cellRenderers/StatusRenderer"
import EvaluationErrorPopover from "../../evaluations/EvaluationErrorProps/EvaluationErrorPopover"
import NewEvaluationModal from "../../evaluations/NewEvaluation"

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > div h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
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
}))

const AutomaticEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [evaluationList, setEvaluationList] = useState<_Evaluation[]>([])
    const [evaluators] = useAtom(evaluatorsAtom)
    const [isEvalLoading, setIsEvalLoading] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [newEvalModalOpen, setNewEvalModalOpen] = useState(false)
    const [_selectedConfigEdit, _setSelectedConfigEdit] = useState<EvaluatorConfig>()
    const [_isEditEvalConfigOpen, _setIsEditEvalConfigOpen] = useState(false)
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [selectedEvalRecord, setSelectedEvalRecord] = useState<_Evaluation>()
    const stoppers = useRef<Function>()

    const {refetchAll} = useFetchEvaluatorsData()

    const runningEvaluationIds = useMemo(
        () =>
            evaluationList
                .filter((item) => runningStatuses.includes(item.status.value))
                .map((item) => item.id),
        [evaluationList, runningStatuses],
    )

    useEffect(() => {
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
                {delayMs: 5000, timeoutMs: Infinity},
            ).stopper
        }

        return () => {
            stoppers.current?.()
        }
    }, [JSON.stringify(runningEvaluationIds)])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
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

    const fetchEvaluations = async () => {
        try {
            setIsEvalLoading(true)
            const [allEvaluations] = await Promise.all([fetchAllEvaluations(appId), refetchAll])
            const result = allEvaluations
                .sort(
                    (a, b) =>
                        new Date(b.created_at || 0).getTime() -
                        new Date(a.created_at || 0).getTime(),
                )
                .slice(0, 5)
            setEvaluationList(result)
        } catch (error) {
            console.error(error)
        } finally {
            setIsEvalLoading(false)
        }
    }

    useEffect(() => {
        if (!appId) return

        fetchEvaluations()
    }, [appId])

    const handleNavigation = (variantRevisionId: string) => {
        router.push({
            pathname: `/apps/${appId}/playground`,
            query: {
                revisions: JSON.stringify([variantRevisionId]),
            },
        })
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
                    <VariantDetailsWithStatus
                        variantName={value[0].variantName}
                        revision={record.revisions[0]}
                    />
                )
            },
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
        },
        {
            title: "Results",
            dataIndex: "aggregated_results",
            key: "results",
            onHeaderCell: () => ({
                style: {minWidth: 240},
            }),
            render: (_, record) => {
                if (!evaluators?.length) return
                return (
                    <Space>
                        {record.aggregated_results.map((result, index) => {
                            const evaluator = evaluators.find(
                                (item) => item.key === result.evaluator_config.evaluator_key,
                            )

                            return result.result.error ? (
                                <EvaluationErrorPopover key={index} result={result.result} />
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
                                            <Tag color={evaluator?.color}>{evaluator?.name}</Tag>

                                            <Button
                                                icon={<EditOutlined />}
                                                size="small"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    _setSelectedConfigEdit(result.evaluator_config)
                                                    _setIsEditEvalConfigOpen(true)
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
                            )
                        })}
                    </Space>
                )
            },
        },
        {
            title: "Created on",
            dataIndex: "created_at",
            key: "createdAt",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return formatDay({date: record.created_at})
            },
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
                                        handleNavigation(record.variant_revision_ids[0])
                                    },
                                },
                                {
                                    key: "view_testset",
                                    label: "View test set",
                                    icon: <Database size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/testsets/${record.testset.id}`)
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
                        />
                    </Dropdown>
                )
            },
        },
    ]

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Space>
                    <Title>Automatic Evaluations</Title>
                    <Button href={`/apps/${appId}/evaluations`}>View all</Button>
                </Space>

                <Space>
                    <Button
                        disabled={compareDisabled}
                        type="link"
                        icon={<SwapOutlined />}
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/evaluations/results/compare?evaluations=${selectedRowKeys.join(",")}`,
                            )
                        }
                    >
                        Compare evaluations
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={() => setNewEvalModalOpen(true)}>
                        Create new
                    </Button>
                </Space>
            </div>

            <Spin spinning={isEvalLoading}>
                <Table
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        ...rowSelection,
                    }}
                    className="ph-no-capture"
                    columns={columns}
                    rowKey={"id"}
                    dataSource={evaluationList}
                    scroll={{x: true}}
                    bordered
                    pagination={false}
                    onRow={(record) => ({
                        style: {cursor: "pointer"},
                        onClick: () =>
                            router.push(`/apps/${appId}/evaluations/results/${record.id}`),
                    })}
                />
            </Spin>

            <NewEvaluationModal
                open={newEvalModalOpen}
                onCancel={() => {
                    setNewEvalModalOpen(false)
                }}
                onSuccess={() => {
                    setNewEvalModalOpen(false)
                    fetchEvaluations()
                }}
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
        </div>
    )
}

export default AutomaticEvalOverview
