import {formatDay} from "@/lib/helpers/dateTimeHelper"
import {getTypedValue} from "@/lib/helpers/evaluate"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {_Evaluation, JSSTheme} from "@/lib/Types"
import {fetchAllEvaluations} from "@/services/evaluations/api"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {ArrowsClockwise, Database, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Space, Spin, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

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
}))

const AutomaticEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [evaluationList, setEvaluationList] = useState<_Evaluation[]>([])
    const [isEvalLoading, setIsEvalLoading] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    useEffect(() => {
        const fetchEvaluations = async () => {
            try {
                setIsEvalLoading(true)
                const data = await fetchAllEvaluations(appId)
                setEvaluationList(data)
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
                style: {minWidth: 160},
            }),
            render: (_, record) => {
                return getTypedValue(record.status as any)
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
                return (
                    <Space>
                        {record.aggregated_results.map((result, index) => (
                            <Input
                                key={index}
                                addonBefore={result.evaluator_config.name}
                                defaultValue={getTypedValue(result.result)}
                            />
                        ))}
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
                <Title>Automatic Evaluations</Title>

                <Space>
                    <Button
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/evaluations/results?openNewEvaluationModal=open`,
                            )
                        }
                    >
                        Start New
                    </Button>
                    <Button type="text" size="small" href={`/apps/${appId}/evaluations/results`}>
                        View All
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
                    dataSource={evaluationList}
                    scroll={{x: true}}
                />
            </Spin>
        </div>
    )
}

export default AutomaticEvalOverview
