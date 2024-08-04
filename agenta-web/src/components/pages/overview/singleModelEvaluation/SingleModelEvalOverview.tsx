import {EvaluationType} from "@/lib/enums"
import {calculateResultsDataAvg} from "@/lib/helpers/evaluate"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {
    fromEvaluationResponseToEvaluation,
    singleModelTestEvaluationTransformer,
} from "@/lib/transformers"
import {Evaluation, JSSTheme, SingleModelEvaluationListTableDataType} from "@/lib/Types"
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
}))

const SingleModelEvalOverview = () => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [evaluationsList, setEvaluationsList] = useState<
        SingleModelEvaluationListTableDataType[]
    >([])
    const [fetchingEvaluations, setFetchingEvaluations] = useState(false)

    useEffect(() => {
        if (!appId) return

        const fetchEvaluations = async () => {
            try {
                setFetchingEvaluations(true)
                const evals: Evaluation[] = (await fetchAllLoadEvaluations(appId)).map(
                    fromEvaluationResponseToEvaluation,
                )
                const results = await Promise.all(evals.map((e) => fetchEvaluationResults(e.id)))
                const newEvals = results.map((result, ix) => {
                    const item = evals[ix]
                    if ([EvaluationType.single_model_test].includes(item.evaluationType)) {
                        return singleModelTestEvaluationTransformer({item, result})
                    }
                })

                const newEvalResults = newEvals
                    .filter((evaluation) => evaluation !== undefined)
                    .filter(
                        (item: any) =>
                            item.resultsData !== undefined ||
                            !(Object.keys(item.scoresData || {}).length === 0) ||
                            item.avgScore !== undefined,
                    )
                    .slice(0, 5)

                setEvaluationsList(newEvalResults as any)
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

    const columns: ColumnsType<SingleModelEvaluationListTableDataType> = [
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            render: (value: any, record: SingleModelEvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            render: (value, record: SingleModelEvaluationListTableDataType) => {
                return (
                    <div
                        onClick={() => handleNavigation(value[0].variantName, record.revisions[0])}
                        style={{cursor: "pointer"}}
                    >
                        <span>
                            {variantNameWithRev({
                                variant_name: value[0].variantName,
                                revision: record.revisions[0],
                            })}
                        </span>
                    </div>
                )
            },
        },
        {
            title: "Average score",
            dataIndex: "averageScore",
            key: "averageScore",
            render: (value: any, record: SingleModelEvaluationListTableDataType, index: number) => {
                let score = 0
                if (record.scoresData) {
                    score =
                        ((record.scoresData.correct?.length ||
                            record.scoresData.true?.length ||
                            0) /
                            record.scoresData.nb_of_rows) *
                        100
                } else if (record.resultsData) {
                    const multiplier = {
                        [EvaluationType.auto_webhook_test]: 100,
                        [EvaluationType.single_model_test]: 1,
                    }
                    score = calculateResultsDataAvg(
                        record.resultsData,
                        multiplier[record.evaluationType as keyof typeof multiplier],
                    )
                    score = isNaN(score) ? 0 : score
                } else if (record.avgScore) {
                    score = record.avgScore * 100
                }

                return (
                    <span>
                        <Statistic
                            className={classes.stat}
                            value={score}
                            precision={score <= 99 ? 2 : 1}
                            suffix="%"
                        />
                    </span>
                )
            },
        },
        {
            title: "Created at",
            dataIndex: "createdAt",
            key: "createdAt",
            width: "300",
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
    ]

    return (
        <div className={classes.container}>
            <div className="flex items-center justify-between">
                <Title>Single Model Evaluations</Title>

                <Space>
                    <Button
                        icon={<PlusOutlined />}
                        size="small"
                        onClick={() =>
                            router.push(
                                `/apps/${appId}/annotations/single_model_test?openHumanEvalModal=open`,
                            )
                        }
                    >
                        Start New
                    </Button>
                    <Button
                        type="text"
                        size="small"
                        href={`/apps/${appId}/annotations/single_model_test`}
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

export default SingleModelEvalOverview
