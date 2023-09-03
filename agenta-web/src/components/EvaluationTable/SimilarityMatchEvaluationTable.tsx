import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {LineChartOutlined} from "@ant-design/icons"
import {Button, Card, Col, Input, Row, Space, Spin, Statistic, Table, Tag, message} from "antd"
import {updateEvaluationScenario, callVariant, updateEvaluation, fetchEvaluationResults} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {evaluateWithSimilarityMatch} from "@/lib/services/evaluations"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"

interface SimilarityMatchEvaluationTableProps {
    evaluation: any
    columnsCount: number
    evaluationScenarios: SimilarityMatchEvaluationTableRow[]
}

interface SimilarityMatchEvaluationTableRow {
    id?: string
    inputs: {
        input_name: string
        input_value: string
    }[]
    outputs: {
        variant_name: string
        variant_output: string
    }[]
    columnData0: string
    correctAnswer: string
    score: string
    similarity: number
    evaluationFlow: EvaluationFlow
}
/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */

const useStyles = createUseStyles({
    appVariant: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    inputTestContainer: {
        display: "flex",
        justifyContent: "space-between",
    },
    inputTest: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    recordInput: {
        marginBottom: 10,
    },
    tag: {
        fontSize: "14px",
    },
    card: {
        marginBottom: 20,
    },
    div: {
        marginBottom: 20,
    },
    statCorrect: {
        "& .ant-statistic-content-value": {
            color: "#3f8600",
        },
    },
    statWrong: {
        "& .ant-statistic-content-value": {
            color: "#cf1322",
        },
    },
})

const SimilarityMatchEvaluationTable: React.FC<SimilarityMatchEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appName = Array.isArray(router.query.app_name)
        ? router.query.app_name[0]
        : router.query.app_name || ""

    const variants = evaluation.variants

    const variantData = useVariants(appName, variants)

    const [rows, setRows] = useState<SimilarityMatchEvaluationTableRow[]>([])
    const [dissimilarAnswers, setDissimilarAnswers] = useState<number>(0)
    const [similarAnswers, setSimilarAnswers] = useState<number>(0)
    const [accuracy, setAccuracy] = useState<number>(0)
    const [loadSpinner, setLoadingSpinners] = useState(false)
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [evaluationResults, setEvaluationResults] = useState<any>(null)

    const {Text} = Typography

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
        }
    }, [evaluationScenarios])

    useEffect(() => {
        if (evaluationStatus === EvaluationFlow.EVALUATION_FINISHED) {
            fetchEvaluationResults(evaluation.id)
                .then((data) => setEvaluationResults(data))
                .catch((err) => console.error("Failed to fetch results:", err))
                .then(() => {
                    updateEvaluation(evaluation.id, {status: EvaluationFlow.EVALUATION_FINISHED})
                })
                .catch((err) => console.error("Failed to fetch results:", err))
        }
    }, [evaluationStatus, evaluation.id])

    useEffect(() => {
        if (similarAnswers + dissimilarAnswers > 0) {
            setAccuracy((similarAnswers / (similarAnswers + dissimilarAnswers)) * 100)
        } else {
            setAccuracy(0)
        }
    }, [similarAnswers, dissimilarAnswers])

    useEffect(() => {
        const similar = rows.filter((row) => row.score === "true").length
        const dissimilar = rows.filter((row) => row.score === "false").length
        const accuracy = similar + dissimilar > 0 ? (similar / (similar + dissimilar)) * 100 : 0

        setSimilarAnswers(similar)
        setDissimilarAnswers(dissimilar)
        setAccuracy(accuracy)
    }, [rows])

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        rowIndex: number,
        inputFieldKey: number,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex].inputs[inputFieldKey].input_value = e.target.value
        setRows(newRows)
    }

    const runAllEvaluations = async () => {
        // start loading spinner
        setLoadingSpinners(true)
        setEvaluationStatus(EvaluationFlow.EVALUATION_STARTED)
        const promises: Promise<void>[] = []

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i))
        }

        Promise.all(promises)
            .then(() => {
                console.log("All functions finished.")
                setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
            })
            .catch((err) => console.error("An error occurred:", err))
    }

    const runEvaluation = async (rowIndex: number) => {
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: {[key: string]: any}, item) => {
            acc[item.input_name] = item.input_value
            return acc
        }, {})

        const columnsDataNames = ["columnData0"]
        columnsDataNames.forEach(async (columnName: any, idx: number) => {
            setRowValue(rowIndex, columnName, "loading...")
            try {
                let result = await callVariant(
                    inputParamsDict,
                    variantData[idx].inputParams!,
                    variantData[idx].optParams!,
                    variantData[idx].URIPath!,
                )
                setRowValue(rowIndex, columnName, result)
                setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)
                evaluate(rowIndex)
                if (rowIndex === rows.length - 1) {
                    message.success("Evaluation Results Saved")
                }
            } catch {
                setRowValue(rowIndex, columnName, "")
            } finally {
                if (rowIndex === rows.length - 1) {
                    setLoadingSpinners(false)
                }
            }
        })
    }

    /**
     *
     * @param rowNumber
     *
     * This method will:
     * 1. perform an similarity match evaluation for the given row number
     * 2. update the evaluation row with the result
     * 3. update the score column in the table
     */
    const evaluate = (rowNumber: number) => {
        const similarity = evaluateWithSimilarityMatch(
            rows[rowNumber].columnData0,
            rows[rowNumber].correctAnswer,
        )
        const isSimilar =
            similarity >= evaluation.evaluationTypeSettings.similarityThreshold ? "true" : "false"

        const evaluation_scenario_id = rows[rowNumber].id

        // TODO: we need to improve this and make it dynamic
        const appVariantNameX = variants[0].variantName
        const outputVariantX = rows[rowNumber].columnData0

        if (evaluation_scenario_id) {
            const data = {
                score: isSimilar,
                outputs: [{variant_name: appVariantNameX, variant_output: outputVariantX}],
            }

            updateEvaluationScenario(
                evaluation.id,
                evaluation_scenario_id,
                data,
                evaluation.evaluationType,
            )
                .then((data) => {
                    // NOTE: both rows are set in the UI and neither of them disrupt the other
                    setRowValue(rowNumber, "similarity", similarity)
                    setRowValue(rowNumber, "score", data.score)
                    if (isSimilar) {
                        setSimilarAnswers((prevSimilar) => prevSimilar + 1)
                    } else {
                        setDissimilarAnswers((prevDissimilar) => prevDissimilar + 1)
                    }
                })
                .catch((err) => {
                    console.error(err)
                })
        }
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof SimilarityMatchEvaluationTableRow,
        value: any,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex][columnKey] = value as never
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<SimilarityMatchEvaluationTableRow>[] = Array.from(
        {length: columnsCount},
        (_, i) => {
            const columnKey = `columnData${i}`

            return {
                title: (
                    <div>
                        <span>App Variant: </span>
                        <span className={classes.appVariant}>
                            {variants ? variants[i].variantName : ""}
                        </span>
                    </div>
                ),
                dataIndex: columnKey,
                key: columnKey,
                width: "25%",
                render: (
                    text: any,
                    record: SimilarityMatchEvaluationTableRow,
                    rowIndex: number,
                ) => {
                    if (record.outputs && record.outputs.length > 0) {
                        const outputValue = record.outputs.find(
                            (output: any) => output.variant_name === variants[i].variantName,
                        )?.variant_output
                        return <div>{outputValue}</div>
                    }
                    return text
                },
            }
        },
    )

    const columns = [
        {
            key: "1",
            width: "30%",
            title: (
                <div className={classes.inputTestContainer}>
                    <div>
                        <span> Inputs (Test set: </span>
                        <span className={classes.inputTest}>{evaluation.testset.name}</span>
                        <span> )</span>
                    </div>
                </div>
            ),
            dataIndex: "inputs",
            render: (text: any, record: SimilarityMatchEvaluationTableRow, rowIndex: number) => (
                <div>
                    {record &&
                        record.inputs &&
                        record.inputs.length && // initial value of inputs is array with 1 element and variantInputs could contain more than 1 element
                        record.inputs.map((input: any, index: number) => (
                            <div className={classes.recordInput} key={index}>
                                <Input
                                    placeholder={input.input_name}
                                    value={input.input_value}
                                    onChange={(e) => handleInputChange(e, rowIndex, index)}
                                />
                            </div>
                        ))}
                </div>
            ),
        },
        ...dynamicColumns,
        {
            title: "Correct Answer",
            dataIndex: "correctAnswer",
            key: "correctAnswer",
            width: "25%",

            render: (text: any, record: any, rowIndex: number) => <div>{record.correctAnswer}</div>,
        },
        {
            title: "Evaluation",
            dataIndex: "evaluation",
            key: "evaluation",
            width: 200,
            align: "center" as "left" | "right" | "center",
            render: (text: any, record: any, rowIndex: number) => {
                let tagColor = ""
                if (record.score === "true") {
                    tagColor = "green"
                } else if (record.score === "false") {
                    tagColor = "red"
                }

                return (
                    <Spin spinning={loadSpinner}>
                        <Space>
                            <div>
                                {!loadSpinner && rows[rowIndex].score !== "" && (
                                    <Tag color={tagColor} className={classes.tag}>
                                        {record.score}
                                    </Tag>
                                )}
                            </div>
                        </Space>
                    </Spin>
                )
            },
        },
        {
            title: "Similarity",
            dataIndex: "similarity",
            key: "similarity",
            width: 200,
            align: "center" as "left" | "right" | "center",
            render: (text: any, record: any, rowIndex: number) => {
                let tagColor = ""
                if (record.score === "true") {
                    tagColor = "green"
                } else if (record.score === "false") {
                    tagColor = "red"
                }

                return (
                    <Spin spinning={loadSpinner}>
                        <Space>
                            <div>
                                {!loadSpinner && text !== undefined && (
                                    <Tag color={tagColor} className={classes.tag}>
                                        {text.toFixed(2)}
                                    </Tag>
                                )}
                            </div>
                        </Space>
                    </Spin>
                )
            },
        },
    ]

    return (
        <div>
            <h1>
                Similarity match Evaluation (Threshold:{" "}
                {evaluation.evaluationTypeSettings.similarityThreshold})
            </h1>
            <div className={classes.div}>
                <Text>
                    This evaluation type is calculating the similarity using Jaccard similarity.
                </Text>
            </div>
            <div>
                <Row align="middle">
                    <Col span={12}>
                        <Button
                            type="primary"
                            onClick={runAllEvaluations}
                            icon={<LineChartOutlined />}
                            size="large"
                        >
                            Run Evaluation
                        </Button>
                    </Col>

                    <Col span={12}>
                        <Card bordered={true} className={classes.card}>
                            <Row justify="end">
                                <Col span={10}>
                                    <Statistic
                                        title="Similar answers:"
                                        value={`${similarAnswers} out of ${rows.length}`}
                                        className={classes.statCorrect}
                                    />
                                </Col>
                                <Col span={10}>
                                    <Statistic
                                        title="Dissimilar answers:"
                                        value={`${dissimilarAnswers} out of ${rows.length}`}
                                        className={classes.statWrong}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Statistic
                                        title="Accuracy:"
                                        value={accuracy}
                                        precision={2}
                                        suffix="%"
                                    />
                                </Col>
                            </Row>
                        </Card>
                    </Col>
                </Row>
            </div>
            <div>
                <Table
                    dataSource={rows}
                    columns={columns}
                    pagination={false}
                    rowClassName={() => "editable-row"}
                />
            </div>
        </div>
    )
}

export default SimilarityMatchEvaluationTable
