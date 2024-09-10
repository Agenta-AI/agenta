import DeleteEvaluationModal from "@/components/DeleteEvaluationModal/DeleteEvaluationModal"
import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import HumanEvaluationModal from "@/components/HumanEvaluationModal/HumanEvaluationModal"
import {EvaluationType} from "@/lib/enums"
import {getColorFromStr} from "@/lib/helpers/colors"
import {getVotesPercentage} from "@/lib/helpers/evaluate"
import {getInitials, isDemo} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {abTestingEvaluationTransformer} from "@/lib/transformers"
import {JSSTheme} from "@/lib/Types"
import {
    deleteEvaluations,
    fetchAllLoadEvaluations,
    fetchEvaluationResults,
} from "@/services/human-evaluations/api"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Database, GearSix, Note, Rocket, Trash} from "@phosphor-icons/react"
import {Avatar, Button, Dropdown, message, Space, Spin, Statistic, Table, Typography} from "antd"
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
    statFlag: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorError,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorError,
        },
    },
    stat: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorPrimary,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorPrimary,
        },
    },
    statGood: {
        lineHeight: theme.lineHeight,
        "& .ant-statistic-content-value": {
            fontSize: theme.fontSize,
            color: theme.colorSuccess,
        },
        "& .ant-statistic-content-suffix": {
            fontSize: theme.fontSize,
            color: theme.colorSuccess,
        },
    },
}))

const AbTestingEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [evaluationsList, setEvaluationsList] = useState<HumanEvaluationListTableDataType[]>([])
    const [fetchingEvaluations, setFetchingEvaluations] = useState(false)
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)
    const [selectedEvalRecord, setSelectedEvalRecord] = useState<HumanEvaluationListTableDataType>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)

    useEffect(() => {
        if (!appId) return

        const fetchEvaluations = async () => {
            try {
                setFetchingEvaluations(true)
                const evals = await fetchAllLoadEvaluations(appId)

                const fetchPromises = evals.map(async (item: any) => {
                    return fetchEvaluationResults(item.id)
                        .then((results) => {
                            if (item.evaluation_type === EvaluationType.human_a_b_testing) {
                                if (Object.keys(results.votes_data).length > 0) {
                                    return abTestingEvaluationTransformer({item, results})
                                }
                            }
                        })
                        .catch((err) => console.error(err))
                })

                const results = (await Promise.all(fetchPromises))
                    .filter((evaluation) => evaluation !== undefined)
                    .sort(
                        (a, b) =>
                            new Date(b.createdAt || 0).getTime() -
                            new Date(a.createdAt || 0).getTime(),
                    )
                    .slice(0, 5)

                setEvaluationsList(results)
            } catch (error) {
                console.error(error)
            } finally {
                setFetchingEvaluations(false)
            }
        }

        fetchEvaluations()
    }, [appId])

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${appId}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const handleDeleteEvaluation = async (record: HumanEvaluationListTableDataType) => {
        try {
            setFetchingEvaluations(true)
            await deleteEvaluations([record.key])
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter((evaluation) => ![record.key].includes(evaluation.key)),
            )
            message.success("Evaluation Deleted")
        } catch (error) {
            console.error(error)
        } finally {
            setFetchingEvaluations(false)
        }
    }

    const columns: ColumnsType<HumanEvaluationListTableDataType> = [
        {
            title: "Variant 1",
            dataIndex: "variantNames",
            key: "variant1",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                return (
                    <div>
                        {variantNameWithRev({
                            variant_name: value[0],
                            revision: record.revisions[0],
                        })}
                    </div>
                )
            },
        },
        {
            title: "Variant 2",
            dataIndex: "variantNames",
            key: "variant2",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value, record) => {
                return (
                    <div>
                        {variantNameWithRev({
                            variant_name: value[1],
                            revision: record.revisions[1],
                        })}
                    </div>
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
            render: (_, record: HumanEvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Results",
            key: "results",
            onHeaderCell: () => ({
                style: {minWidth: 240},
            }),
            render: (_, record: HumanEvaluationListTableDataType) => {
                const stat1 = getVotesPercentage(record, 0)
                const stat2 = getVotesPercentage(record, 1)

                return (
                    <div className="flex items-center gap-2">
                        <Statistic
                            className={classes.stat}
                            value={stat1}
                            precision={stat1 <= 99 ? 2 : 1}
                            suffix="%"
                        />
                        |
                        <Statistic
                            className={classes.stat}
                            value={stat2}
                            precision={stat2 <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </div>
                )
            },
        },
        {
            title: "Both are good",
            dataIndex: "positive",
            key: "positive",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record: HumanEvaluationListTableDataType) => {
                let percentage = record.votesData.positive_votes.percentage
                return (
                    <span>
                        <Statistic
                            className={classes.statGood}
                            value={percentage}
                            precision={percentage <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </span>
                )
            },
        },
        {
            title: "Flag",
            dataIndex: "flag",
            key: "flag",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (value: any, record: HumanEvaluationListTableDataType) => {
                let percentage = record.votesData.flag_votes.percentage
                return (
                    <span>
                        <Statistic
                            className={classes.statFlag}
                            value={percentage}
                            precision={percentage <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </span>
                )
            },
        },
    ]

    if (isDemo()) {
        columns.push({
            title: "User",
            dataIndex: ["user", "username"],
            key: "username",
            onHeaderCell: () => ({
                style: {minWidth: 160},
            }),
            render: (_, record: any) => {
                return (
                    <Space>
                        <Avatar
                            size={"small"}
                            style={{
                                backgroundColor: getColorFromStr(record.user.id),
                                color: "#fff",
                            }}
                        >
                            {getInitials(record.user.username)}
                        </Avatar>
                        <Typography.Text>{record.user.username}</Typography.Text>
                    </Space>
                )
            },
        })
    }

    columns.push(
        ...([
            {
                title: "Created on",
                dataIndex: "createdAt",
                key: "createdAt",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
            },
            {
                title: <GearSix size={16} />,
                key: "key",
                width: 56,
                fixed: "right",
                align: "center",
                render: (_: any, record: HumanEvaluationListTableDataType) => {
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
                                                `/apps/${appId}/annotations/human_a_b_testing/${record.key}`,
                                            )
                                        },
                                    },
                                    {
                                        key: "variant1",
                                        label: "View variant 1",
                                        icon: <Rocket size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleNavigation(
                                                record.variantNames[0],
                                                record.revisions[0],
                                            )
                                        },
                                    },
                                    {
                                        key: "variant2",
                                        label: "View variant 2",
                                        icon: <Rocket size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleNavigation(
                                                record.variantNames[1],
                                                record.revisions[1],
                                            )
                                        },
                                    },
                                    {
                                        key: "view_testset",
                                        label: "View test set",
                                        icon: <Database size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            router.push(
                                                `/apps/${appId}/testsets/${record.testset._id}`,
                                            )
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
        ] as any),
    )

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Space>
                    <Title>A/B Testing Evaluations</Title>
                    <Button size="small" href={`/apps/${appId}/annotations/human_a_b_testing`}>
                        View all
                    </Button>
                </Space>

                <Button
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={() => setIsEvalModalOpen(true)}
                >
                    Create new
                </Button>
            </div>

            <Spin spinning={fetchingEvaluations}>
                <Table
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={evaluationsList}
                    scroll={{x: true}}
                    bordered
                    pagination={false}
                    onRow={(record) => ({
                        style: {cursor: "pointer"},
                        onClick: () =>
                            router.push(
                                `/apps/${appId}/annotations/human_a_b_testing/${record.key}`,
                            ),
                    })}
                />
            </Spin>

            <HumanEvaluationModal
                evaluationType={"human_a_b_testing"}
                isEvalModalOpen={isEvalModalOpen}
                setIsEvalModalOpen={setIsEvalModalOpen}
            />

            {selectedEvalRecord && (
                <DeleteEvaluationModal
                    open={isDeleteEvalModalOpen}
                    onCancel={() => setIsDeleteEvalModalOpen(false)}
                    onOk={async () => {
                        await handleDeleteEvaluation(selectedEvalRecord)
                        setIsDeleteEvalModalOpen(false)
                    }}
                    evaluationType={"a/b testing evaluation"}
                />
            )}
        </div>
    )
}

export default AbTestingEvalOverview
