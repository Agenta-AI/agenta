import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {LineChartOutlined} from "@ant-design/icons"
import {
    Button,
    Card,
    Col,
    Input,
    Row,
    Space,
    Spin,
    Statistic,
    Table,
    Tag,
    Typography,
    message,
} from "antd"
import {
    updateEvaluationScenario,
    callVariant,
    fetchEvaluationResults,
    updateEvaluation,
} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {evaluateWithExactMatch} from "@/lib/services/evaluations"
import {createUseStyles} from "react-jss"
import {exportExactEvaluationData} from "@/lib/helpers/evaluate"
import SecondaryButton from "../SecondaryButton/SecondaryButton"

const {Title} = Typography

interface ExactMatchEvaluationTableProps {
    evaluation: any
    columnsCount: number
    evaluationScenarios: ExactMatchEvaluationTableRow[]
}

interface ExactMatchEvaluationTableRow {
    id?: string
    inputs: {
        input_name: string
        input_value: string
    }[]
    outputs: {
        variant_id: string
        variant_output: string
    }[]
    columnData0: string
    correctAnswer: string
    score: string
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

const ExactMatchEvaluationTable: React.FC<ExactMatchEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const variants = evaluation.variants

    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<ExactMatchEvaluationTableRow[]>([])
    const [wrongAnswers, setWrongAnswers] = useState<number>(0)
    const [correctAnswers, setCorrectAnswers] = useState<number>(0)
    const [accuracy, setAccuracy] = useState<number>(0)
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
        }
    }, [evaluationScenarios])

    useEffect(() => {
        if (evaluationStatus === EvaluationFlow.EVALUATION_FINISHED) {
            fetchEvaluationResults(evaluation.id)
                .then(() => {
                    updateEvaluation(evaluation.id, {status: EvaluationFlow.EVALUATION_FINISHED})
                })
                .catch((err) => console.error("Failed to fetch results:", err))
        }
    }, [evaluationStatus, evaluation.id])

    useEffect(() => {
        if (correctAnswers + wrongAnswers > 0) {
            setAccuracy((correctAnswers / (correctAnswers + wrongAnswers)) * 100)
        } else {
            setAccuracy(0)
        }
    }, [correctAnswers, wrongAnswers])

    useEffect(() => {
        const correct = rows.filter((row) => row.score === "correct").length
        const wrong = rows.filter((row) => row.score === "wrong").length
        const accuracy = correct + wrong > 0 ? (correct / (correct + wrong)) * 100 : 0

        setCorrectAnswers(correct)
        setWrongAnswers(wrong)
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
                    appId || "",
                    variants[idx].baseId || "",
                )

                setRowValue(rowIndex, columnName, result)
                setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)
                evaluate(rowIndex)
                if (rowIndex === rows.length - 1) {
                    message.success("Evaluation Results Saved")
                }
            } catch (err) {
                console.log("Error running evaluation:", err)
                setRowValue(rowIndex, columnName, "")
            }
        })
    }

    /**
     *
     * @param rowNumber
     *
     * This method will:
     * 1. perform an exact match evaluation for the given row number
     * 2. update the evaluation row with the result
     * 3. update the score column in the table
     */
    const evaluate = (rowNumber: number) => {
        const isCorrect = evaluateWithExactMatch(
            rows[rowNumber].columnData0,
            rows[rowNumber].correctAnswer,
        )

        const evaluation_scenario_id = rows[rowNumber].id
        // TODO: we need to improve this and make it dynamic
        const outputVariantX = rows[rowNumber].columnData0

        if (evaluation_scenario_id) {
            const data = {
                score: isCorrect ? "correct" : "wrong",
                outputs: [{variant_id: variants[0].variantId, variant_output: outputVariantX}],
            }

            updateEvaluationScenario(
                evaluation.id,
                evaluation_scenario_id,
                data,
                evaluation.evaluationType,
            )
                .then(() => {
                    setRowValue(rowNumber, "score", data.score)
                    if (isCorrect) {
                        setCorrectAnswers((prevCorrect) => prevCorrect + 1)
                    } else {
                        setWrongAnswers((prevWrong) => prevWrong + 1)
                    }
                })
                .catch((err) => {
                    console.error(err)
                })
        }
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof ExactMatchEvaluationTableRow,
        value: any,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex][columnKey] = value as never
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<ExactMatchEvaluationTableRow>[] = Array.from(
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
                render: (text: any, record: ExactMatchEvaluationTableRow, rowIndex: number) => {
                    if (record.outputs && record.outputs.length > 0) {
                        const outputValue = record.outputs.find(
                            (output: any) => output.variant_id === variants[i].variantId,
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
            render: (text: any, record: ExactMatchEvaluationTableRow, rowIndex: number) => (
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
                if (record.score === "correct") {
                    tagColor = "green"
                } else if (record.score === "wrong") {
                    tagColor = "red"
                }
                return (
                    <Spin spinning={rows[rowIndex].score === "loading" ? true : false}>
                        <Space>
                            <div>
                                {rows[rowIndex].score !== "" && (
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
    ]

    return (
        <div>
            <Title level={2}>Exact match Evaluation</Title>
            <div>
                <Row align="middle">
                    <Col span={12}>
                        <Space>
                            <Button
                                type="primary"
                                onClick={runAllEvaluations}
                                icon={<LineChartOutlined />}
                                size="large"
                            >
                                Run Evaluation
                            </Button>
                            <SecondaryButton
                                onClick={() => exportExactEvaluationData(evaluation, rows)}
                                disabled={evaluationStatus !== EvaluationFlow.EVALUATION_FINISHED}
                            >
                                Export results
                            </SecondaryButton>
                        </Space>
                    </Col>

                    <Col span={12}>
                        <Card bordered={true} className={classes.card}>
                            <Row justify="end">
                                <Col span={10}>
                                    <Statistic
                                        title="Correct answers:"
                                        value={`${correctAnswers} out of ${rows.length}`}
                                        className={classes.statCorrect}
                                    />
                                </Col>
                                <Col span={10}>
                                    <Statistic
                                        title="Wrong answers:"
                                        value={`${wrongAnswers} out of ${rows.length}`}
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
                    rowKey="id"
                />
            </div>
        </div>
    )
}

export default ExactMatchEvaluationTable
