import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {LineChartOutlined} from "@ant-design/icons"
import {Button, Card, Col, Input, Row, Space, Spin, Statistic, Table, Tag, message} from "antd"
import {Evaluation} from "@/lib/Types"
import {
    updateEvaluationScenario,
    callVariant,
    fetchEvaluationResults,
    updateEvaluation,
    executeCustomEvaluationCode,
    loadTestset,
    updateEvaluationScenarioScore,
} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {getOpenAIKey} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"

interface CustomCodeEvaluationTableProps {
    evaluation: Evaluation
    columnsCount: number
    customEvaluationId: string
    evaluationScenarios: CustomCodeEvaluationTableRow[]
}

interface CustomCodeEvaluationTableRow {
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
    evaluation: string
    codeResult: string
    evaluationFlow: EvaluationFlow
}

interface IVariantInputs {
    input_name: string
    input_value: string
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
        marginTop: 16,
        width: "100%",
        border: "1px solid #ccc",
        marginRight: "24px",
        marginBottom: 30,
        backgroundColor: "rgb(246 253 245)",
        "& .ant-card-head": {
            minHeight: 44,
            padding: "0px 12px",
        },
        "& .ant-card-body": {
            padding: "4px 16px",
            border: "0px solid #ccc",
        },
    },
    cardTextarea: {
        height: 120,
        padding: "0px 0px",
    },
    row: {marginBottom: 20},
    evaluationResult: {
        padding: "30px 10px",
        marginBottom: 20,
        backgroundColor: "rgb(244 244 244)",
        border: "1px solid #ccc",
        borderRadius: 5,
    },
    h3: {
        marginTop: 0,
    },
    resultDataRow: {
        maxWidth: "100%",
        overflowX: "auto",
        whiteSpace: "nowrap",
    },
    resultDataCol: {
        display: "inline-block",
    },
    resultDataCard: {
        width: 200,
        margin: "0 4px",
    },
    stat: {
        "& .ant-statistic-content-value": {
            color: "#3f8600",
        },
    },
})

const CustomCodeRunEvaluationTable: React.FC<CustomCodeEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
    customEvaluationId,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appName = Array.isArray(router.query.app_name)
        ? router.query.app_name[0]
        : router.query.app_name || ""

    const variants = evaluation.variants

    const variantData = useVariants(appName, variants)

    const [rows, setRows] = useState<CustomCodeEvaluationTableRow[]>([])

    const [shouldFetchResults, setShouldFetchResults] = useState(false)
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [evaluationResults, setEvaluationResults] = useState<any>(null)
    const [evaluationTestsets, setEvaluationTestsets] = useState([])

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

    const handleInputChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        rowIndex: number,
        inputFieldKey: number,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex].inputs[inputFieldKey].input_value = e.target.value
        setRows(newRows)
    }

    useEffect(() => {
        const getTests = async () => {
            const data = await loadTestset(evaluation.testset._id)
            if (data.csvdata.length > 0) {
                setEvaluationTestsets(data.csvdata)
            }
        }

        getTests()
    }, [evaluation])

    const runAllEvaluations = async () => {
        try {
            setEvaluationStatus(EvaluationFlow.EVALUATION_STARTED)
            await Promise.all(rows.map((_, rowIndex) => runEvaluation(rowIndex)))
            setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
            console.log("All evaluations finished.")
        } catch (err) {
            console.error("An error occurred:", err)
        }
    }

    const runEvaluation = async (rowIndex: number) => {
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: {[key: string]: any}, item) => {
            acc[item.input_name] = item.input_value
            return acc
        }, {})

        const columnsDataNames = ["columnData0"]
        let idx = 0
        for (const columnName of columnsDataNames) {
            setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)

            let result = await callVariant(
                inputParamsDict,
                variantData[idx].inputParams!,
                variantData[idx].optParams!,
                variantData[idx].URIPath!,
            )
            setRowValue(rowIndex, columnName as any, result)
            await evaluate(rowIndex)
            setShouldFetchResults(true)
            if (rowIndex === rows.length - 1) {
                message.success("Evaluation Results Saved")
            }
            idx++
        }
    }

    const correctAnswer = (variantInputs: Array<IVariantInputs>) => {
        const {input_name, input_value} = variantInputs[0]
        const filteredData: any = evaluationTestsets.filter(
            (item) => item[input_name] === input_value,
        )[0]
        return filteredData.correct_answer
    }

    const evaluate = async (rowNumber: number) => {
        const evaluation_scenario_id = rows[rowNumber].id
        const appVariantNameX = variants[0].variantName
        const outputVariantX = rows[rowNumber].columnData0

        if (evaluation_scenario_id) {
            const data = {
                outputs: [{variant_name: appVariantNameX, variant_output: outputVariantX}],
                inputs: rows[rowNumber].inputs,
                correct_answer: correctAnswer(rows[rowNumber].inputs),
                open_ai_key: getOpenAIKey(),
            }

            try {
                // Update evaluation scenario
                const responseData = await updateEvaluationScenario(
                    evaluation.id,
                    evaluation_scenario_id,
                    data,
                    evaluation.evaluationType as EvaluationType,
                )

                if (responseData) {
                    // Call custom code evaluation
                    const result = await callCustomCodeHandler(
                        data.inputs,
                        appName,
                        appVariantNameX,
                        responseData.outputs,
                    )
                    if (result) {
                        // Update the evaluation scenario with the score
                        await updateEvaluationScenarioScore(evaluation_scenario_id, result)
                    }
                    setRowValue(rowNumber, "codeResult", result)
                }

                setRowValue(rowNumber, "evaluationFlow", EvaluationFlow.EVALUATION_FINISHED)
                setRowValue(rowNumber, "evaluation", responseData.evaluation)
            } catch (err) {
                console.log(err)
            }
        }
    }

    const callCustomCodeHandler = async (
        variantInput: Array<IVariantInputs>,
        appName: string,
        variantName: string,
        outputs: Array<Object>,
    ) => {
        const expectedTarget = correctAnswer(variantInput)
        const data = {
            evaluation_id: customEvaluationId,
            inputs: variantInput,
            outputs: outputs,
            app_name: appName,
            correct_answer: expectedTarget,
            variant_name: variantName,
        }
        const response = await executeCustomEvaluationCode(data)
        if (response.status === 200) {
            return response.data
        }
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof CustomCodeEvaluationTableRow,
        value: any,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex][columnKey] = value as never
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<CustomCodeEvaluationTableRow>[] = Array.from(
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
                width: "30%",
                render: (text: any, record: CustomCodeEvaluationTableRow, rowIndex: number) => {
                    if (record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED) {
                        return (
                            <center>
                                <Spin />
                            </center>
                        )
                    }
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
            render: (text: any, record: CustomCodeEvaluationTableRow, rowIndex: number) => (
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
            width: "30%",

            render: (text: any, record: any, rowIndex: number) => {
                return <div>{correctAnswer(record.inputs)}</div>
            },
        },
        {
            title: "Result",
            dataIndex: "codeResult",
            key: "code_result",
            width: 200,
            align: "center" as "left" | "right" | "center",
            render: (text: number, record: any, rowIndex: number) => {
                return (
                    <Spin
                        spinning={
                            record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED
                                ? true
                                : false
                        }
                    >
                        <Space>
                            <div>{record.code_result !== "" && <div>{text.toFixed(2)}</div>}</div>
                        </Space>
                    </Spin>
                )
            },
        },
    ]

    return (
        <div>
            <h1>Custom Code Evaluation</h1>
            <div>
                <Row align="middle" className={classes.row}>
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
                </Row>
            </div>
            <div className={classes.evaluationResult}>
                <center>
                    {evaluationStatus === EvaluationFlow.EVALUATION_INITIALIZED && (
                        <div>Run evaluation to see average score!</div>
                    )}
                    {evaluationStatus === EvaluationFlow.EVALUATION_STARTED && <Spin />}
                    {evaluationResults && evaluationResults.avg_score && (
                        <div>
                            <h3 className={classes.h3}>Average Score:</h3>
                            <Row gutter={8} justify="center" className={classes.resultDataRow}>
                                <Col key={"avg-score"} className={classes.resultDataCol}>
                                    <Card bordered={false} className={classes.resultDataCard}>
                                        <Statistic
                                            className={classes.stat}
                                            value={evaluationResults.avg_score.toFixed(2) as number}
                                        />
                                    </Card>
                                </Col>
                            </Row>
                        </div>
                    )}
                </center>
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

export default CustomCodeRunEvaluationTable
