import {deleteEvaluations, fetchData} from "@/lib/services/api"
import {Button, Spin, Statistic, Table, Typography} from "antd"
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
import {getAgentaApiUrl, isDemo} from "@/lib/helpers/utils"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"

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
        positive_votes: {
            number_of_votes: number
            percentage: number
        }
        variants_votes_data: Record<string, VariantVotesData>
    }
    createdAt: string
    revisions: string[]
    variant_revision_ids: string[]
    variantNames: string[]
}

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    container: {
        marginBottom: 20,
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
    btnContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        margin: "20px 0",
        gap: 10,
        "& svg": {
            color: "red",
        },
    },
})

const {Title} = Typography

interface HumanEvaluationResultProps {
    setIsEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export default function HumanEvaluationResult({setIsEvalModalOpen}: HumanEvaluationResultProps) {
    const router = useRouter()
    const [evaluationsList, setEvaluationsList] = useState<HumanEvaluationListTableDataType[]>([])
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [selectionType] = useState<"checkbox" | "radio">("checkbox")
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const app_id = router.query.app_id?.toString() || ""
    const [fetchingEvaluations, setFetchingEvaluations] = useState(false)

    useEffect(() => {
        if (!app_id) {
            return
        }
        const fetchEvaluations = async () => {
            try {
                setFetchingEvaluations(true)
                fetchData(`${getAgentaApiUrl()}/api/human-evaluations/?app_id=${app_id}`)
                    .then((response) => {
                        const fetchPromises = response.map((item: EvaluationResponseType) => {
                            return fetchData(
                                `${getAgentaApiUrl()}/api/human-evaluations/${item.id}/results/`,
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
                                                revisions: item.revisions,
                                                variant_revision_ids: item.variants_revision_ids,
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
                    .finally(() => setFetchingEvaluations(false))
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
            router.push(`/apps/${app_id}/annotations/human_a_b_testing/${evaluation.key}`)
        }
    }

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${app_id}/playground?variant=${variantName}&revision=${revisionNum}`)
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

    return (
        <div>
            <div className={classes.btnContainer}>
                <Button onClick={onDelete} disabled={selectedRowKeys.length == 0}>
                    <DeleteOutlined key="delete" />
                    Delete
                </Button>
                <Button
                    type="primary"
                    data-cy="new-annotation-modal-button"
                    onClick={() => setIsEvalModalOpen(true)}
                >
                    New Evaluation
                </Button>
            </div>

            <div className={classes.container}>
                <Title level={3}>A/B Test Results</Title>
            </div>

            <Spin spinning={fetchingEvaluations}>
                <Table
                    rowSelection={{
                        type: selectionType,
                        ...rowSelection,
                    }}
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={evaluationsList}
                />
            </Spin>
        </div>
    )
}
