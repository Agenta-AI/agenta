import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import {EvaluationType} from "@/lib/enums"
import {getVotesPercentage} from "@/lib/helpers/evaluate"
import {isDemo} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {abTestingEvaluationTransformer} from "@/lib/transformers"
import {JSSTheme} from "@/lib/Types"
import {fetchAllLoadEvaluations, fetchEvaluationResults} from "@/services/human-evaluations/api"
import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {GearSix} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Spin, Statistic, Table, Typography} from "antd"
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
        "& .ant-statistic-content-value": {
            fontSize: 20,
            color: "#cf1322",
        },
        "& .ant-statistic-content-suffix": {
            fontSize: 20,
            color: "#cf1322",
        },
    },
    stat: {
        "& .ant-statistic-content-value": {
            fontSize: 20,
            color: "#1677ff",
        },
        "& .ant-statistic-content-suffix": {
            fontSize: 20,
            color: "#1677ff",
        },
    },
    statGood: {
        "& .ant-statistic-content-value": {
            fontSize: 20,
            color: "#3f8600",
        },
        "& .ant-statistic-content-suffix": {
            fontSize: 20,
            color: "#3f8600",
        },
    },
}))

const AbTestingEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [evaluationsList, setEvaluationsList] = useState<HumanEvaluationListTableDataType[]>([])
    const [fetchingEvaluations, setFetchingEvaluations] = useState(false)

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

    const columns: ColumnsType<HumanEvaluationListTableDataType> = [
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            render: (_, record: HumanEvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Variant 1",
            dataIndex: "variantNames",
            key: "variant1",
            render: (value, record) => {
                const percentage = getVotesPercentage(record, 0)
                return (
                    <div>
                        <Statistic
                            className={classes.stat}
                            value={percentage}
                            precision={percentage <= 99 ? 2 : 1}
                            suffix="%"
                        />
                        <div
                            style={{cursor: "pointer"}}
                            onClick={() => handleNavigation(value[0], record.revisions[0])}
                        >
                            (
                            {variantNameWithRev({
                                variant_name: value[0],
                                revision: record.revisions[0],
                            })}
                            )
                        </div>
                    </div>
                )
            },
        },
        {
            title: "Variant 2",
            dataIndex: "variantNames",
            key: "variant2",
            render: (value, record) => {
                const percentage = getVotesPercentage(record, 1)
                return (
                    <div>
                        <Statistic
                            className={classes.stat}
                            value={percentage}
                            precision={percentage <= 99 ? 2 : 1}
                            suffix="%"
                        />
                        <div
                            style={{cursor: "pointer"}}
                            onClick={() => handleNavigation(value[1], record.revisions[1])}
                        >
                            (
                            {variantNameWithRev({
                                variant_name: value[1],
                                revision: record.revisions[1],
                            })}
                            )
                        </div>
                    </div>
                )
            },
        },
        {
            title: "Both are good",
            dataIndex: "positive",
            key: "positive",
            render: (value: any, record: HumanEvaluationListTableDataType) => {
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
        })
    }

    columns.push(
        ...[
            {
                title: "Created at",
                dataIndex: "createdAt",
                key: "createdAt",
            },
            {
                title: <GearSix size={16} />,
                key: "settings",
                width: 50,
                render: () => {
                    return (
                        <Dropdown
                            trigger={["hover"]}
                            menu={{
                                items: [
                                    {
                                        key: "change_variant",
                                        label: "Change Variant",
                                    },

                                    {
                                        key: "open_playground",
                                        label: "Open in playground",
                                    },
                                ],
                            }}
                        >
                            <Button type="text" icon={<MoreOutlined />} size="small" />
                        </Dropdown>
                    )
                },
            },
        ],
    )

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Title>A/B Testing Evaluations</Title>

                <Space>
                    <Button
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/annotations/human_a_b_testing?openHumanEvalModal=open`,
                            )
                        }
                    >
                        Start New
                    </Button>
                    <Button
                        type="text"
                        size="small"
                        href={`/apps/${appId}/annotations/human_a_b_testing`}
                    >
                        View All
                    </Button>
                </Space>
            </div>

            <Spin spinning={fetchingEvaluations}>
                <Table className="ph-no-capture" columns={columns} dataSource={evaluationsList} />
            </Spin>
        </div>
    )
}

export default AbTestingEvalOverview
