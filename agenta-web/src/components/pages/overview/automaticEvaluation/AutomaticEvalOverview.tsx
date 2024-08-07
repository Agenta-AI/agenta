import {formatDay} from "@/lib/helpers/dateTimeHelper"
import {getTypedValue} from "@/lib/helpers/evaluate"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {_Evaluation, EvaluationStatus, Evaluator, JSSTheme} from "@/lib/Types"
import {fetchAllEvaluations, fetchAllEvaluators} from "@/services/evaluations/api"
import {
    EditOutlined,
    InfoCircleOutlined,
    MoreOutlined,
    PlusOutlined,
    SwapOutlined,
} from "@ant-design/icons"
import {ArrowsClockwise, Database, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import StatusRenderer from "./StatusRenderer"

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
            minWidth: 100,
            borderRight: `1px solid ${theme.colorBorder}`,
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
    const [evaluators, setEvaluators] = useState<Evaluator[]>()
    const [isEvalLoading, setIsEvalLoading] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

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

    useEffect(() => {
        const fetchEvaluations = async () => {
            try {
                setIsEvalLoading(true)
                const [allEvaluations, allEvaluators] = await Promise.all([
                    fetchAllEvaluations(appId),
                    fetchAllEvaluators(),
                ])
                const result = allEvaluations.reverse().slice(0, 5)
                setEvaluationList(result)
                setEvaluators(allEvaluators)
            } catch (error) {
                console.error(error)
            } finally {
                setIsEvalLoading(false)
            }
        }

        fetchEvaluations()
    }, [appId])

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const handleDeleteEvaluation = async (record: _Evaluation) => {}

    const columns: ColumnsType<_Evaluation> = [
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
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
                style: {minWidth: 160},
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
                                <Popover
                                    placement="bottom"
                                    arrow={false}
                                    key={index}
                                    content={
                                        <div className="w-[256px]">
                                            {result.result.error.stacktrace}
                                        </div>
                                    }
                                    title={result.result.error.message}
                                >
                                    <Button icon={<InfoCircleOutlined />} type="link">
                                        Read more
                                    </Button>
                                </Popover>
                            ) : (
                                <Popover
                                    placement="bottom"
                                    arrow={false}
                                    key={index}
                                    content={
                                        <div className="w-[256px] flex flex-col gap-1">
                                            <div className="font-[500]">
                                                {result.evaluator_config.name}
                                            </div>
                                            <div>{getTypedValue(result.result)}</div>
                                        </div>
                                    }
                                    title={
                                        <div className="flex items-center justify-between">
                                            <Tag color={evaluator?.color}>{evaluator?.name}</Tag>

                                            <Button icon={<EditOutlined />} size="small" />
                                        </div>
                                    }
                                >
                                    <div className={classes.resultTag}>
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
                return formatDay(record.created_at)
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
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "details",
                                    label: "Open details",
                                    icon: <Note size={16} />,
                                    onClick: () =>
                                        router.push(
                                            `/apps/${appId}/evaluations/results/${record.id}`,
                                        ),
                                },
                                {
                                    key: "variant",
                                    label: "View variant",
                                    icon: <Rocket size={16} />,
                                    onClick: () =>
                                        handleNavigation(
                                            record.variants[0].variantName,
                                            record.revisions[0],
                                        ),
                                },
                                {
                                    key: "view_testset",
                                    label: "View test set",
                                    icon: <Database size={16} />,
                                    onClick: () =>
                                        router.push(`/apps/${appId}/testsets/${record.testset.id}`),
                                },
                                {type: "divider"},
                                {
                                    key: "rerun_eval",
                                    label: "Re-run evaluation",
                                    icon: <ArrowsClockwise size={16} />,
                                },
                                {
                                    key: "delete_eval",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: () => handleDeleteEvaluation(record),
                                },
                            ],
                        }}
                    >
                        <Button type="text" icon={<MoreOutlined />} size="small" />
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
                    <Button size="small" href={`/apps/${appId}/evaluations/results`}>
                        View all
                    </Button>
                </Space>

                <Space>
                    <Button
                        disabled={compareDisabled}
                        size="small"
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
                    <Button
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/evaluations/results?openNewEvaluationModal=open`,
                            )
                        }
                    >
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
                />
            </Spin>
        </div>
    )
}

export default AutomaticEvalOverview
