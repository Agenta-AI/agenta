import {deleteEvaluations, fetchData} from "@/lib/services/api"
import {Button, Collapse, Statistic, Table, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {ColumnsType} from "antd/es/table"
import {EvaluationResponseType} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {EvaluationTypeLabels} from "@/lib/helpers/utils"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {createUseStyles} from "react-jss"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {useAppTheme} from "../Layout/ThemeContextProvider"

interface EvaluationListTableDataType {
    key: string
    variants: string[]
    testset: {
        _id: string
        name: string
    }
    evaluationType: string
    status: EvaluationFlow
    scoresData: {
        nb_of_rows: number
        scores: {
            wrong: number
            correct: number
            true: number
            false: number
        }
        variant: any[]
    }
    resultsData: {[key: string]: number}
    createdAt: string
}

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    container: {
        marginBottom: 20,
        "& svg": {
            color: "red",
        },
    },
    collapse: ({themeMode}: StyleProps) => ({
        margin: "10px 0",
        "& .ant-collapse-header": {
            alignItems: "center !important",
            padding: "0px 20px !important",
            borderTopLeftRadius: "10px !important",
            borderTopRightRadius: "10px !important",
            background: themeMode === "dark" ? "#1d1d1d" : "#f8f8f8",
        },
    }),
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
})

const {Title} = Typography

export default function AutomaticEvaluationResult() {
    const router = useRouter()
    const [evaluationsList, setEvaluationsList] = useState<EvaluationListTableDataType[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectionType, setSelectionType] = useState<"checkbox" | "radio">("checkbox")
    const [deletingLoading, setDeletingLoading] = useState<boolean>(true)
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    const app_name = router.query.app_name?.toString() || ""

    useEffect(() => {
        if (!app_name) {
            return
        }
        const fetchEvaluations = async () => {
            try {
                fetchData(
                    `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/?app_name=${app_name}`,
                )
                    .then((response) => {
                        const fetchPromises = response.map((item: EvaluationResponseType) => {
                            return fetchData(
                                `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${item.id}/results`,
                            )
                                .then((results) => {
                                    if (
                                        [
                                            EvaluationType.auto_exact_match,
                                            EvaluationType.auto_similarity_match,
                                            EvaluationType.auto_regex_test,
                                            EvaluationType.auto_ai_critique,
                                        ].includes(item.evaluation_type as EvaluationType)
                                    ) {
                                        return {
                                            key: item.id,
                                            createdAt: formatDate(item.created_at),
                                            variants: item.variants,
                                            scoresData: results.scores_data,
                                            evaluationType: item.evaluation_type,
                                            status: item.status,
                                            testset: item.testset,
                                            resultsData: results.results_data,
                                        }
                                    }
                                })
                                .catch((err) => console.error(err))
                        })
                        Promise.all(fetchPromises)
                            .then((evaluations) => {
                                const validEvaluations = evaluations
                                    .filter((evaluation) => evaluation !== undefined)
                                    .filter(
                                        (item) =>
                                            item.resultsData !== undefined ||
                                            !(Object.keys(item.scoresData).length === 0),
                                    )
                                setEvaluationsList(validEvaluations)
                                setDeletingLoading(false)
                            })
                            .catch((err) => console.error(err))
                    })
                    .catch((err) => console.error(err))
            } catch (error) {
                console.log(error)
            }
        }

        fetchEvaluations()
    }, [app_name])

    const onCompleteEvaluation = (evaluation: any) => {
        // TODO: improve type
        const evaluationType =
            EvaluationType[evaluation.evaluationType as keyof typeof EvaluationType]

        if (evaluationType === EvaluationType.auto_exact_match) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_exact_match`)
        } else if (evaluationType === EvaluationType.auto_similarity_match) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_similarity_match`)
        } else if (evaluationType === EvaluationType.auto_regex_test) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_regex_test`)
        } else if (evaluationType === EvaluationType.auto_ai_critique) {
            router.push(`/apps/${app_name}/evaluations/${evaluation.key}/auto_ai_critique`)
        }
    }

    const columns: ColumnsType<EvaluationListTableDataType> = [
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return (
                    <div>
                        <span>{value[0]}</span>
                    </div>
                )
            },
        },
        {
            title: "Test set",
            dataIndex: "testsetName",
            key: "testsetName",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                return <span>{record.testset.name}</span>
            },
        },
        {
            title: "Evaluation type",
            dataIndex: "evaluationType",
            key: "evaluationType",
            width: "300",
            render: (value: string) => {
                const evaluationType = EvaluationType[value as keyof typeof EvaluationType]
                const label = EvaluationTypeLabels[evaluationType]
                return <span>{label}</span>
            },
        },
        {
            title: "Average score",
            dataIndex: "averageScore",
            key: "averageScore",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                if (record.scoresData) {
                    let correctScore = 0

                    if (record.scoresData.scores?.correct !== undefined) {
                        correctScore = record.scoresData.scores.correct
                    }
                    if (record.scoresData.scores?.true !== undefined) {
                        correctScore = record.scoresData.scores.true
                    }

                    let scoresAverage = (correctScore / record.scoresData.nb_of_rows) * 100
                    return (
                        <span>
                            <Statistic
                                className={classes.stat}
                                value={scoresAverage}
                                precision={scoresAverage <= 99 ? 2 : 1}
                                suffix="%"
                            />
                        </span>
                    )
                }

                let resultsDataAverage =
                    (record.resultsData[10] /
                        Object.values(record.resultsData).reduce((acc, value) => acc + value, 0)) *
                    100
                return (
                    <span>
                        <Statistic
                            className={classes.stat}
                            value={resultsDataAverage}
                            precision={resultsDataAverage <= 99 ? 2 : 1}
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
            title: "Action",
            dataIndex: "action",
            key: "action",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                let actionText = "View evaluation"
                if (record.status !== EvaluationFlow.EVALUATION_FINISHED) {
                    actionText = "Continue evaluation"
                }
                return (
                    <div className="hover-button-wrapper">
                        <Button type="primary" onClick={() => onCompleteEvaluation(record)}>
                            {actionText}
                        </Button>
                    </div>
                )
            },
        },
    ]

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[], selectedRows: EvaluationListTableDataType[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const onDelete = async () => {
        const evaluationsIds = selectedRowKeys.map((key) => key.toString())
        setDeletingLoading(true)
        try {
            const deletedIds = await deleteEvaluations(evaluationsIds)
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter((evaluation) => !deletedIds.includes(evaluation.key)),
            )

            setSelectedRowKeys([])
        } catch (e) {
            console.log(e)
        } finally {
            setDeletingLoading(false)
        }
    }

    const items = [
        {
            key: "1",
            label: (
                <div className={classes.container}>
                    <Title level={3}>Automatic Evaluation Results</Title>
                </div>
            ),
            children: (
                <div>
                    <div className={classes.container}>
                        <Button onClick={onDelete} disabled={selectedRowKeys.length == 0}>
                            <DeleteOutlined key="delete" />
                            Delete
                        </Button>
                    </div>

                    <Table
                        rowSelection={{
                            type: selectionType,
                            ...rowSelection,
                        }}
                        columns={columns}
                        dataSource={evaluationsList}
                        // loading={loading}
                    />
                </div>
            ),
        },
    ]

    return (
        <Collapse
            items={items}
            ghost
            bordered={false}
            expandIconPosition="end"
            className={classes.collapse}
            collapsible="icon"
            defaultActiveKey={["1"]}
        />
    )
}
