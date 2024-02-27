import {deleteEvaluations, fetchEvaluationResults, loadEvaluations} from "@/lib/services/api"
import {Button, Collapse, Statistic, Table, Typography} from "antd"
import {useRouter} from "next/router"
import {useEffect, useState} from "react"
import {ColumnsType} from "antd/es/table"
import {Evaluation, GenericObject} from "@/lib/Types"
import {DeleteOutlined} from "@ant-design/icons"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {createUseStyles} from "react-jss"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {calculateResultsDataAvg} from "@/lib/helpers/evaluate"
import {fromEvaluationResponseToEvaluation} from "@/lib/transformers"
import Link from "next/link"

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
        wrong?: GenericObject[]
        correct?: GenericObject[]
        true?: GenericObject[]
        false?: GenericObject[]
        variant: string[]
    }
    avgScore: number
    custom_code_eval_id: string
    resultsData: {[key: string]: number}
    createdAt: string
    revisions: string[]
    variant_revision_ids: string[]
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
interface AutomaticEvaluationResultProps {
    setIsEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
}
export default function AutomaticEvaluationResult({
    setIsEvalModalOpen,
}: AutomaticEvaluationResultProps) {
    const router = useRouter()
    const [evaluationsList, setEvaluationsList] = useState<EvaluationListTableDataType[]>([])
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
                const evals: Evaluation[] = (await loadEvaluations(app_id)).map(
                    fromEvaluationResponseToEvaluation,
                )
                const results = await Promise.all(evals.map((e) => fetchEvaluationResults(e.id)))
                const newEvals = results.map((result, ix) => {
                    const item = evals[ix]
                    if ([EvaluationType.single_model_test].includes(item.evaluationType)) {
                        return {
                            key: item.id,
                            createdAt: item.createdAt,
                            variants: item.variants,
                            scoresData: result.scores_data,
                            evaluationType: item.evaluationType,
                            status: item.status,
                            testset: item.testset,
                            custom_code_eval_id: item.evaluationTypeSettings.customCodeEvaluationId,
                            resultsData: result.results_data,
                            avgScore: result.avg_score,
                            revisions: item.revisions,
                            variant_revision_ids: item.variant_revision_ids,
                        }
                    }
                })

                setEvaluationsList(
                    newEvals
                        .filter((evaluation) => evaluation !== undefined)
                        .filter(
                            (item: any) =>
                                item.resultsData !== undefined ||
                                !(Object.keys(item.scoresData || {}).length === 0) ||
                                item.avgScore !== undefined,
                        ) as any,
                )
            } catch (error) {
                console.error(error)
            }
        }

        fetchEvaluations()
    }, [app_id])

    const handleNavigation = (variantName: string, revisionNum: string) => {
        router.push(`/apps/${app_id}/playground?variant=${variantName}&revision=${revisionNum}`)
    }

    const onCompleteEvaluation = (evaluation: any) => {
        // TODO: improve type
        const evaluationType =
            EvaluationType[evaluation.evaluationType as keyof typeof EvaluationType]

        if (evaluationType === EvaluationType.single_model_test) {
            router.push(`/apps/${app_id}/annotations/${evaluation.key}/single_model_test`)
        }
    }

    const columns: ColumnsType<EvaluationListTableDataType> = [
        {
            title: "Variant",
            dataIndex: "variants",
            key: "variants",
            render: (value, record: EvaluationListTableDataType) => {
                return (
                    <div
                        onClick={() => handleNavigation(value[0].variantName, record.revisions[0])}
                        style={{cursor: "pointer"}}
                    >
                        <span>{`${value[0].variantName} #${record.revisions[0]}`}</span>
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
            title: "Average score",
            dataIndex: "averageScore",
            key: "averageScore",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
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
            title: "Action",
            dataIndex: "action",
            key: "action",
            render: (value: any, record: EvaluationListTableDataType, index: number) => {
                let actionText = "View annotation"
                if (record.status !== EvaluationFlow.EVALUATION_FINISHED) {
                    actionText = "Continue annotation"
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
        try {
            await deleteEvaluations(evaluationsIds)
            setEvaluationsList((prevEvaluationsList) =>
                prevEvaluationsList.filter(
                    (evaluation) => !evaluationsIds.includes(evaluation.key),
                ),
            )

            setSelectedRowKeys([])
        } catch {
        } finally {
        }
    }

    return (
        <div>
            <div className={classes.btnContainer}>
                <Button onClick={onDelete} disabled={selectedRowKeys.length == 0}>
                    <DeleteOutlined key="delete" />
                    Delete
                </Button>
                <Button type="primary" onClick={() => setIsEvalModalOpen(true)}>
                    New Annotation
                </Button>
            </div>

            <div className={classes.container}>
                <Title level={3}>Single Model Test Results</Title>
            </div>

            <Table
                rowSelection={{
                    type: selectionType,
                    ...rowSelection,
                }}
                className="ph-no-capture"
                data-cy="automatic-evaluation-result"
                columns={columns}
                dataSource={evaluationsList}
            />
        </div>
    )
}
