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
import {Evaluation} from "@/lib/Types"
import {
    updateEvaluationScenario,
    callVariant,
    fetchEvaluationResults,
    updateEvaluation,
} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow, EvaluationType} from "@/lib/enums"
import {getOpenAIKey} from "@/lib/helpers/utils"
import {createUseStyles} from "react-jss"
import {exportAICritiqueEvaluationData} from "@/lib/helpers/evaluate"
import SecondaryButton from "../SecondaryButton/SecondaryButton"
import {useAppTheme} from "../Layout/ThemeContextProvider"

const {Title} = Typography

interface AICritiqueEvaluationTableProps {
    evaluation: Evaluation
    columnsCount: number
    evaluationScenarios: AICritiqueEvaluationTableRow[]
}

interface AICritiqueEvaluationTableRow {
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
    evaluationFlow: EvaluationFlow
}

type StyleProps = {
    themeMode: "dark" | "light"
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
    card: ({themeMode}: StyleProps) => ({
        marginTop: 16,
        width: "100%",
        border: "1px solid #ccc",
        marginRight: "24px",
        marginBottom: 30,
        background: themeMode === "light" ? "rgb(246 253 245)" : "#000000",
        "& .ant-card-head": {
            minHeight: 44,
            padding: "0px 12px",
        },
        "& .ant-card-body": {
            padding: "4px 16px",
            border: "0px solid #ccc",
        },
    }),
    cardTextarea: {
        height: 120,
        padding: "0px 0px",
    },
    row: {marginBottom: 20},
    evaluationResult: ({themeMode}: StyleProps) => ({
        padding: "30px 10px",
        marginBottom: 20,
        border: "1px solid #ccc",
        background: themeMode === "light" ? "rgb(244 244 244)" : "#000000",
        color: themeMode === "light" ? "#000" : "#fff",
        borderRadius: 5,
    }),
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

const AICritiqueEvaluationTable: React.FC<AICritiqueEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const router = useRouter()
    const appName = Array.isArray(router.query.app_name)
        ? router.query.app_name[0]
        : router.query.app_name || ""

    const variants = evaluation.variants

    const variantData = useVariants(appName, variants)

    const [rows, setRows] = useState<AICritiqueEvaluationTableRow[]>([])
    const [evaluationPromptTemplate, setEvaluationPromptTemplate] =
        useState<string>(`We have an LLM App that we want to evaluate its outputs.
Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below:

Evaluation strategy: 0 to 10 0 is very bad and 10 is very good.

Prompt: {llm_app_prompt_template}
Inputs: {inputs}
Correct Answer:{correct_answer}
Evaluate this: {app_variant_output}

Answer ONLY with one of the given grading or evaluation options.
`)

    const [shouldFetchResults, setShouldFetchResults] = useState(false)
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [evaluationResults, setEvaluationResults] = useState<any>(null)

    useEffect(() => {
        if (
            variantData &&
            variantData[0] &&
            variantData[0].inputParams &&
            variantData[0].inputParams.length > 0
        ) {
            const llmAppInputs = variantData[0].inputParams
                .map((param) => `${param.name}: {${param.name}}`)
                .join(", ")
            setEvaluationPromptTemplate(evaluationPromptTemplate.replace("{inputs}", llmAppInputs))
        }
    }, [variantData])

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
        }
    }, [evaluationScenarios])

    useEffect(() => {
        if (evaluationStatus === EvaluationFlow.EVALUATION_FINISHED && shouldFetchResults) {
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

    const evaluate = async (rowNumber: number) => {
        const evaluation_scenario_id = rows[rowNumber].id
        const appVariantNameX = variants[0].variantName
        const outputVariantX = rows[rowNumber].columnData0

        if (evaluation_scenario_id) {
            const data = {
                outputs: [{variant_name: appVariantNameX, variant_output: outputVariantX}],
                inputs: rows[rowNumber].inputs,
                evaluation_prompt_template: evaluationPromptTemplate,
                open_ai_key: getOpenAIKey(),
            }

            try {
                const responseData = await updateEvaluationScenario(
                    evaluation.id,
                    evaluation_scenario_id,
                    data,
                    evaluation.evaluationType as EvaluationType,
                )
                setRowValue(rowNumber, "evaluationFlow", EvaluationFlow.EVALUATION_FINISHED)
                setRowValue(rowNumber, "evaluation", responseData.evaluation)
            } catch (err) {
                console.error(err)
            }
        }
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof AICritiqueEvaluationTableRow,
        value: any,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex][columnKey] = value as never
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<AICritiqueEvaluationTableRow>[] = Array.from(
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
                render: (text: any, record: AICritiqueEvaluationTableRow, rowIndex: number) => {
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
            render: (text: any, record: AICritiqueEvaluationTableRow, rowIndex: number) => (
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

            render: (text: any, record: any, rowIndex: number) => <div>{record.correctAnswer}</div>,
        },
        {
            title: "Evaluation",
            dataIndex: "evaluation",
            key: "evaluation",
            width: 200,
            align: "center" as "left" | "right" | "center",
            render: (text: any, record: any, rowIndex: number) => {
                if (record.evaluationFlow === "COMPARISON_RUN_STARTED") {
                    return <Spin></Spin>
                }
                let tagColor = ""

                return (
                    <Spin spinning={rows[rowIndex].evaluation === "loading" ? true : false}>
                        <Space>
                            <div>
                                {rows[rowIndex].evaluation !== "" && (
                                    <Tag color={tagColor} className={classes.tag}>
                                        {record.evaluation}
                                    </Tag>
                                )}
                            </div>
                        </Space>
                    </Spin>
                )
            },
        },
    ]

    const onChangeEvaluationPromptTemplate = (e: any) => {
        setEvaluationPromptTemplate(e.target.value)
    }

    return (
        <div>
            <Title level={2}>AI Critique Evaluation</Title>
            <div>
                <div>
                    <Card className={classes.card} title="Evaluation strategy prompt">
                        <Input.TextArea
                            className={classes.cardTextarea}
                            rows={5}
                            bordered={false}
                            placeholder="e.g:"
                            onChange={onChangeEvaluationPromptTemplate}
                            value={evaluationPromptTemplate}
                        />
                    </Card>
                </div>
                <Row align="middle" className={classes.row}>
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
                                onClick={() => exportAICritiqueEvaluationData(evaluation, rows)}
                                disabled={evaluationStatus !== EvaluationFlow.EVALUATION_FINISHED}
                            >
                                Export results
                            </SecondaryButton>
                        </Space>
                    </Col>
                </Row>
            </div>
            <div className={classes.evaluationResult}>
                <center>
                    {evaluationStatus === EvaluationFlow.EVALUATION_INITIALIZED && (
                        <div>
                            Run evaluation to see results!
                        </div>
                    )}
                    {evaluationStatus === EvaluationFlow.EVALUATION_STARTED && <Spin />}
                    {evaluationResults && evaluationResults.results_data && (
                        <div>
                            <h3 className={classes.h3}>Results Data:</h3>
                            <Row gutter={8} justify="center" className={classes.resultDataRow}>
                                {Object.entries(evaluationResults.results_data).map(
                                    ([key, value], index) => {
                                        return (
                                            <Col key={index} className={classes.resultDataCol}>
                                                <Card
                                                    bordered={false}
                                                    className={classes.resultDataCard}
                                                >
                                                    <Statistic
                                                        title={key}
                                                        className={classes.stat}
                                                        value={value as any}
                                                    />
                                                </Card>
                                            </Col>
                                        )
                                    },
                                )}
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

export default AICritiqueEvaluationTable
