import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {CodeOutlined, LineChartOutlined} from "@ant-design/icons"
import {
    Button,
    Card,
    Col,
    Input,
    Modal,
    Row,
    Space,
    Spin,
    Statistic,
    Table,
    Typography,
    message,
} from "antd"
import {CustomEvaluation, Evaluation} from "@/lib/Types"
import {
    updateEvaluationScenario,
    callVariant,
    fetchEvaluationResults,
    updateEvaluation,
    executeCustomEvaluationCode,
    loadTestset,
    updateEvaluationScenarioScore,
    fetchEvaluationScenarioResults,
    fetchCustomEvaluationDetail,
} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {getOpenAIKey} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"
import SecondaryButton from "../SecondaryButton/SecondaryButton"
import {exportCustomCodeEvaluationData} from "@/lib/helpers/evaluate"
import CodeBlock from "../DynamicCodeBlock/CodeBlock"

const {Title} = Typography

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

interface IScenarioScore {
    scenario_id: string
    score: string
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
    codeButton: {
        marginBottom: 20,
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
    codeBlockContainer: {
        marginTop: 24,
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
    const appId = router.query.app_id as string

    const variants = evaluation.variants

    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<CustomCodeEvaluationTableRow[]>([])

    const [shouldFetchResults, setShouldFetchResults] = useState(false)
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [evaluationResults, setEvaluationResults] = useState<any>(null)
    const [evaluationTestsets, setEvaluationTestsets] = useState([])
    const [listScenariosResult, setListScenariosResult] = useState<IScenarioScore[]>([])
    const [customEvaluation, setCustomEvaluation] = useState<CustomEvaluation>()
    const [modalOpen, setModalOpen] = useState(false)

    useEffect(() => {
        if (customEvaluationId && customEvaluation?.id !== customEvaluationId) {
            fetchCustomEvaluationDetail(customEvaluationId)
                .then(setCustomEvaluation)
                .catch(console.error)
        }
    }, [customEvaluationId])

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
            Promise.all(evaluationScenarios.map((item) => retrieveScenarioScore(item.id!)))
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
        const getTests = async () => {
            const data = await loadTestset(evaluation.testset._id)
            if (data.csvdata.length > 0) {
                setEvaluationTestsets(data.csvdata)
            }
        }

        getTests()
    }, [evaluation])

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
        return filteredData?.correct_answer
    }

    const calcScenarioScore = (ix: number) => {
        const item = rows[ix]

        let score = +item.codeResult
        if (!item.codeResult && item.outputs.length && listScenariosResult.length) {
            score = +(listScenariosResult.find((res) => res.scenario_id === item.id)?.score || 0)
        }
        if (isNaN(score)) score = 0

        return score.toFixed(2)
    }

    const retrieveScenarioScore = async (scenario_id: string) => {
        const response: any = await fetchEvaluationScenarioResults(scenario_id)
        setListScenariosResult((prev) => [...prev, response.data as IScenarioScore])
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
                        variants[0].variantId,
                        data.inputs,
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
        variantId: string,
        inputs: Array<IVariantInputs>,
        outputs: Array<Object>,
    ) => {
        const expectedTarget = correctAnswer(inputs)
        const data = {
            evaluation_id: customEvaluationId,
            inputs,
            outputs,
            correct_answer: expectedTarget,
            variant_id: variantId,
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
            render: (_: number, record: any, ix: number) => {
                return (
                    <Spin
                        spinning={
                            record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED
                                ? true
                                : false
                        }
                    >
                        <Space>{calcScenarioScore(ix)}</Space>
                    </Spin>
                )
            },
        },
    ]

    return (
        <div>
            <Title level={2}>Custom Code Evaluation</Title>
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
                                onClick={() =>
                                    exportCustomCodeEvaluationData(
                                        evaluation,
                                        rows.map((item, ix) => ({
                                            ...item,
                                            score: calcScenarioScore(ix),
                                        })),
                                    )
                                }
                                disabled={evaluationStatus !== EvaluationFlow.EVALUATION_FINISHED}
                            >
                                Export results
                            </SecondaryButton>
                        </Space>
                    </Col>

                    <Col span={12}>
                        <Row justify="end">
                            <Card bordered={true} className={classes.card}>
                                <Statistic
                                    title="Average Score:"
                                    value={evaluationResults?.avg_score?.toFixed(2) as number}
                                    precision={2}
                                />
                            </Card>
                        </Row>
                    </Col>
                </Row>
            </div>

            {customEvaluation?.python_code && (
                <Button
                    icon={<CodeOutlined />}
                    className={classes.codeButton}
                    onClick={() => setModalOpen(true)}
                >
                    Show Python Code
                </Button>
            )}

            <div>
                <Table
                    dataSource={rows}
                    columns={columns}
                    pagination={false}
                    rowClassName={() => "editable-row"}
                />
            </div>

            <Modal
                title="Custom Evaluation Code"
                open={modalOpen}
                footer={null}
                onCancel={() => setModalOpen(false)}
                width={700}
            >
                <div className={classes.codeBlockContainer}>
                    <CodeBlock language={"python"} value={customEvaluation?.python_code!} />
                </div>
            </Modal>
        </div>
    )
}

export default CustomCodeRunEvaluationTable
