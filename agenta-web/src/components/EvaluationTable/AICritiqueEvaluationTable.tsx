import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {BarChartOutlined, LineChartOutlined} from "@ant-design/icons"
import {Button, Card, Col, Input, Row, Space, Spin, Statistic, Table, Tag, Typography} from "antd"
import {Variant} from "@/lib/Types"
import {updateEvaluationScenario, callVariant, useLoadResults} from "@/lib/services/api"
import {useVariant} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import TextArea from "antd/es/input/TextArea"
import {getOpenAIKey} from "@/lib/helpers/utils"

interface AICritiqueEvaluationTableProps {
    evaluation: any
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
/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */

const AICritiqueEvaluationTable: React.FC<AICritiqueEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const {Text} = Typography
    const router = useRouter()
    const appName = Array.isArray(router.query.app_name)
        ? router.query.app_name[0]
        : router.query.app_name || ""

    const variants = evaluation.variants
    const { data: evaluationResults, isTestsetsLoading, isTestsetsLoadingError } = useLoadResults(evaluation.id);

    const variantData = variants.map((variant: Variant) => {
        const {inputParams, optParams, URIPath, isLoading, isError, error} = useVariant(appName, variant)

        return {
            inputParams,
            optParams,
            URIPath,
            isLoading,
            isError,
            error,
        }
    })

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

    const [isResultsComponentDisplayed, setIsResultsComponentDisplayed] = useState<boolean>(false);
    const [isResultsLoading, setIsResultsLoading] = useState<boolean>(false);

    useEffect(() => {
        if (variantData && variantData[0] && variantData[0].inputParams){
            const llmAppInputs = variantData[0].inputParams.map(param => `${param.name}: {${param.name}}`).join(', ');
            setEvaluationPromptTemplate(evaluationPromptTemplate.replace("{inputs}", llmAppInputs))
        }
    }, [variantData])

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
        }
    }, [evaluationScenarios])

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
            await Promise.all(rows.map((_, rowIndex) => runEvaluation(rowIndex)));
            console.log("All evaluations finished.");
        } catch (err) {
            console.error("An error occurred:", err);
        }
    }

    const runEvaluation = async (rowIndex: number) => {
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: { [key: string]: any }, item) => {
            acc[item.input_name] = item.input_value;
            return acc;
        }, {});

        const columnsDataNames = ["columnData0"];
        for (const [idx, columnName] of columnsDataNames.entries()) {
            try {
                setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED);
                setIsResultsComponentDisplayed(true);
                setIsResultsLoading(true);

                let result = await callVariant(inputParamsDict, variantData[idx].optParams, variantData[idx].URIPath);
                setRowValue(rowIndex, columnName, result);
                await evaluate(rowIndex);

                // Fetch results after evaluation (add your fetch function here)
                // const fetchedResults = await useLoadResults(evaluation.id);
                console.log(evaluationResults);
                // handleFetchedResults(fetchedResults);

            } catch (e) {
                console.error("Error:", e);
            }
        }
    }

    const evaluate = async (rowNumber: number) => {
        const evaluation_scenario_id = rows[rowNumber].id;
        const appVariantNameX = variants[0].variantName;
        const outputVariantX = rows[rowNumber].columnData0;

        if (evaluation_scenario_id) {
            const data = {
                outputs: [{ variant_name: appVariantNameX, variant_output: outputVariantX }],
                inputs: rows[rowNumber].inputs,
                evaluation_prompt_template: evaluationPromptTemplate,
                open_ai_key: getOpenAIKey(),
            };

            try {
                const responseData = await updateEvaluationScenario(evaluation.id, evaluation_scenario_id, data, evaluation.evaluationType);
                setRowValue(rowNumber, "evaluationFlow", EvaluationFlow.EVALUATION_FINISHED);
                setRowValue(rowNumber, "evaluation", responseData.evaluation);
            } catch (err) {
                console.error(err);
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
                        <span
                            style={{
                                backgroundColor: "rgb(201 255 216)",
                                color: "rgb(0 0 0)",
                                padding: 4,
                                borderRadius: 5,
                            }}
                        >
                            {variants ? variants[i].variantName : ""}
                        </span>
                    </div>
                ),
                dataIndex: columnKey,
                key: columnKey,
                width: "30%",
                render: (
                    text: any,
                    record: AICritiqueEvaluationTableRow,
                    rowIndex: number,
                ) => {
                    if (record.evaluationFlow === EvaluationFlow.COMPARISON_RUN_STARTED) {
                        return <center><Spin /></center> 
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
                <div style={{display: "flex", justifyContent: "space-between"}}>
                    <div>
                        <span> Inputs (Test set: </span>
                        <span
                            style={{
                                backgroundColor: "rgb(201 255 216)",
                                color: "rgb(0 0 0)",
                                padding: 4,
                                borderRadius: 5,
                            }}
                        >
                            {evaluation.testset.name}
                        </span>
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
                            <div style={{marginBottom: 10}} key={index}>
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
                if(record.evaluationFlow === "COMPARISON_RUN_STARTED") {
                    return (<Spin ></Spin>)
                }
                let tagColor = ""

                return (
                    <Spin spinning={rows[rowIndex].evaluation === "loading" ? true : false}>
                        <Space>
                            <div>
                                {rows[rowIndex].evaluation !== "" && (
                                    <Tag color={tagColor} style={{fontSize: "14px"}}>
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
            <h1>
                AI Critique Evaluation
            </h1>
            <div>
                <div>
                    <Card
                        style={{
                            marginTop: 16,
                            width: "100%",
                            border: "1px solid #ccc",
                            marginRight: "24px",
                            marginBottom: 30,
                            backgroundColor: 'rgb(246 253 245)',
                        }}
                        bodyStyle={{padding: "4px 16px", border: "0px solid #ccc"}}
                        headStyle={{minHeight: 44, padding: "0px 12px"}}
                        title="Evaluation strategy prompt"
                    >
                        <TextArea
                            rows={5}
                            style={{height: 120,  padding: "0px 0px" }}
                            bordered={false}
                            placeholder="e.g:"
                            onChange={onChangeEvaluationPromptTemplate}
                            value={evaluationPromptTemplate}
                        />
                    </Card>
                </div>
                <Row align="middle" style={{marginBottom: 20}}>
                    <Col span={12}>
                        <Button
                            type="primary"
                            onClick={runAllEvaluations}
                            icon={<LineChartOutlined />}
                            size="large"
                        >
                            Run Evaluation
                        </Button>
                        <Button
                            disabled={true}
                            onClick={runAllEvaluations}
                            icon={<BarChartOutlined />}
                            size="large"
                            style={{marginLeft: 10}}
                        >
                            Results
                            {/* {evaluationResults && (
                                <div>
                                    {evaluationResults.}
                                </div>
                            )} */}
                        </Button>
                    </Col>
                </Row>
            </div>
            {isResultsComponentDisplayed && (
                <div style={{
                        padding: 20,
                        backgroundColor: 'rgb(244 244 244)',
                        border: '1px solid #ccc',
                        borderRadius: 5,
                    }}>
                    {isResultsLoading && (
                        <center><Spin /></center>
                        )
                    }
                </div>
            )}
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
