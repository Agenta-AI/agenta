import {deleteEvaluations, fetchData} from "@/lib/services/api"
import {Button, Collapse, Statistic, Table, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {ColumnsType} from "antd/es/table"
import {EvaluationResponseType} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {createUseStyles} from "react-jss"
import {formatDate} from "@/lib/helpers/dateTimeHelper"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {getVotesPercentage} from "@/lib/helpers/evaluate"
import {isDemo} from "@/lib/helpers/utils"

interface VariantVotesData {
    number_of_votes: number
    percentage: number
}

export interface HumanEvaluationListTableDataType {
    key: string
    variants: string[]
    testset: {
        _id: string
        name: string
    }
    evaluationType: string
    status: EvaluationFlow
    votesData: {
        nb_of_rows: number
        variants: string[]
        flag_votes: {
            number_of_votes: number
            percentage: number
        }
        variants_votes_data: Record<string, VariantVotesData>
    }
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
})

const {Title} = Typography

export default function HumanEvaluationResult() {
    const router = useRouter()
    const [evaluationsList, setEvaluationsList] = useState<HumanEvaluationListTableDataType[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectionType] = useState<"checkbox" | "radio">("checkbox")
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const app_id = router.query.app_id?.toString() || ""

    useEffect(() => {
        if (!app_id) {
            return
        }
        const fetchEvaluations = async () => {
            try {
                fetchData(
                    `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/?app_id=${app_id}`,
                )
                    .then((response) => {
                        const fetchPromises = response.map((item: EvaluationResponseType) => {
                            return fetchData(
                                `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${item.id}/results`,
                            )
                                .then((results) => {
                                    if (item.evaluation_type === EvaluationType.human_a_b_testing) {
                                        if (Object.keys(results.votes_data).length > 0) {
                                            return {
                                                key: item.id,
                                                createdAt: formatDate(item.created_at),
                                                variants: item.variant_ids,
                                                variantNames: item.variant_names,
                                                votesData: results.votes_data,
                                                evaluationType: item.evaluation_type,
                                                status: item.status,
                                                user: {
                                                    id: item.user_id,
                                                    username: item.user_username,
                                                },
                                                testset: {
                                                    _id: item.testset_id,
                                                    name: item.testset_name,
                                                },
                                            }
                                        }
                                    }
                                })
                                .catch((err) => console.error(err))
                        })
                        Promise.all(fetchPromises)
                            .then((evaluations) => {
                                const validEvaluations = evaluations.filter(
                                    (evaluation) => evaluation !== undefined,
                                )
                                setEvaluationsList(validEvaluations)
                            })
                            .catch((err) => console.error(err))
                    })
                    .catch((err) => console.error(err))
            } catch (error) {
                console.log(error)
            }
        }

        fetchEvaluations()
    }, [app_id])

    const onCompleteEvaluation = (evaluation: any) => {
        // TODO: improve type
        const evaluationType =
            EvaluationType[evaluation.evaluationType as keyof typeof EvaluationType]

        if (evaluationType === EvaluationType.human_a_b_testing) {
            router.push(`/apps/${app_id}/evaluations/${evaluation.key}/human_a_b_testing`)
        }
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
                        <div>({value[0]})</div>
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
                        <div>({value[1]})</div>
                    </div>
                )
            },
        },
        {
            title: "Flag",
            dataIndex: "flag",
            key: "flag",
            render: (value: any, record: HumanEvaluationListTableDataType, index: number) => {
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
                width: "300",
            },
            {
                title: "Action",
                dataIndex: "action",
                key: "action",
                render: (value: any, record: HumanEvaluationListTableDataType, index: number) => {
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
        ],
    )

    const rowSelection = {
        onChange: (selectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(selectedRowKeys)
        },
    }

    const onDelete = async () => {
        const evaluationsIds = selectedRowKeys.map((key) => key.toString())
        try {
            await deleteEvaluations(evaluationsIds)
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter(
                    (evaluation) => !evaluationsIds.includes(evaluation.key),
                ),
            )

            setSelectedRowKeys([])
        } catch {}
    }

    const items = [
        {
            key: "1",
            label: (
                <div className={classes.container}>
                    <Title level={3}>Human Evaluation Results</Title>
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
