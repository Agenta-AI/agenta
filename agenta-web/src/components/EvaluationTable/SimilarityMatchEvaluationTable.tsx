import {useState, useEffect} from "react"
import type {ColumnType} from "antd/es/table"
import {LineChartOutlined} from "@ant-design/icons"
import {
    Button,
    Card,
    Col,
    Form,
    Input,
    Row,
    Slider,
    Space,
    Spin,
    Statistic,
    Table,
    Tag,
    message,
} from "antd"
import {updateEvaluationScenario, callVariant, updateEvaluation} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {evaluateWithSimilarityMatch} from "@/lib/services/evaluations"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"
import {exportSimilarityEvaluationData} from "@/lib/helpers/evaluate"
import SecondaryButton from "../SecondaryButton/SecondaryButton"

const {Title} = Typography

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
        variant_id: string
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
    form: {
        marginBottom: 20,
        "& .ant-form-item-has-error": {
            marginBottom: 0,
        },
    },
    slider: {
        width: 200,
    },
})

const SimilarityMatchEvaluationTable: React.FC<SimilarityMatchEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const variants = evaluation.variants

    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<SimilarityMatchEvaluationTableRow[]>([])
    const [dissimilarAnswers, setDissimilarAnswers] = useState<number>(0)
    const [similarAnswers, setSimilarAnswers] = useState<number>(0)
    const [accuracy, setAccuracy] = useState<number>(0)
    const [settings, setSettings] = useState(evaluation.evaluationTypeSettings)
    const [loading, setLoading] = useState<boolean[]>([])
    const [form] = Form.useForm()
    const {Text} = Typography

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(
                evaluationScenarios.map((item) => ({
                    ...item,
                    similarity: item.outputs?.[0]?.variant_output
                        ? evaluateWithSimilarityMatch(
                              item.outputs[0].variant_output,
                              item.correctAnswer,
                          )
                        : NaN,
                })),
            )
            setLoading(Array(evaluationScenarios.length).fill(false))
        }
    }, [evaluationScenarios])

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
        //validate form
        try {
            await form.validateFields()
        } catch {
            return
        }

        const {similarityThreshold} = form.getFieldsValue()
        const promises: Promise<void>[] = []

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i))
        }

        Promise.all(promises).then(() => {
            updateEvaluation(evaluation.id, {
                evaluation_type_settings: {
                    similarity_threshold: similarityThreshold,
                },
                status: EvaluationFlow.EVALUATION_FINISHED,
            }).then(() => {
                message.success("Evaluation Results Saved")
            })
        })
    }

    const runEvaluation = async (rowIndex: number) => {
        setLoading((prev) => prev.map((val, i) => (i === rowIndex ? true : val)))
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: {[key: string]: any}, item) => {
            acc[item.input_name] = item.input_value
            return acc
        }, {})

        const columnsDataNames = ["columnData0"]
        columnsDataNames.forEach(async (columnName: any, idx: number) => {
            try {
                let result = await callVariant(
                    inputParamsDict,
                    variantData[idx].inputParams!,
                    variantData[idx].optParams!,
                    appId || "",
                    variants[idx].baseId || "",
                )

                const {similarityThreshold} = form.getFieldsValue()
                const similarity = evaluateWithSimilarityMatch(result, rows[rowIndex].correctAnswer)
                const evaluationScenarioId = rows[rowIndex].id
                const isSimilar = similarity >= similarityThreshold ? "true" : "false"

                if (evaluationScenarioId) {
                    await updateEvaluationScenario(
                        evaluation.id,
                        evaluationScenarioId,
                        {
                            score: isSimilar,
                            outputs: [{variant_id: variants[0].variantId, variant_output: result}],
                        },
                        evaluation.evaluationType,
                    )
                }

                setRowValue(rowIndex, "similarity", similarity)
                setRowValue(rowIndex, "score", isSimilar)
                if (isSimilar) {
                    setSimilarAnswers((prevSimilar) => prevSimilar + 1)
                } else {
                    setDissimilarAnswers((prevDissimilar) => prevDissimilar + 1)
                }
                setRowValue(rowIndex, columnName, result)
            } catch {
                setRowValue(rowIndex, columnName, "")
            } finally {
                setLoading((prev) => prev.map((val, i) => (i === rowIndex ? false : val)))
            }
        })
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
                render: (text: any, record: SimilarityMatchEvaluationTableRow, ix: number) => {
                    if (loading[ix]) return "Loading..."

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
        },
        {
            title: "Evaluation",
            dataIndex: "score",
            key: "evaluation",
            width: 200,
            align: "center" as "left" | "right" | "center",
            render: (score: string, _: any, ix: number) => {
                if (loading[ix]) return <Spin spinning />
                return (
                    <Space>
                        {score && (
                            <Tag color={score === "true" ? "green" : "red"} className={classes.tag}>
                                {score}
                            </Tag>
                        )}
                    </Space>
                )
            },
        },
        {
            title: "Similarity",
            dataIndex: "similarity",
            key: "similarity",
            width: 200,
            align: "center" as "left" | "right" | "center",
            render: (similarity: number, record: any, ix: number) => {
                if (loading[ix]) return <Spin spinning />

                const score = record.score
                return (
                    <Space>
                        {score && !isNaN(similarity) && (
                            <Tag color={score === "true" ? "green" : "red"} className={classes.tag}>
                                {similarity.toFixed(2)}
                            </Tag>
                        )}
                    </Space>
                )
            },
        },
    ]

    return (
        <div>
            <Title level={2}>
                Similarity match Evaluation (Threshold: {settings.similarityThreshold})
            </Title>
            <div className={classes.div}>
                <Text>
                    This evaluation type is calculating the similarity using Jaccard similarity.
                </Text>
            </div>
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
                                onClick={() => exportSimilarityEvaluationData(evaluation, rows)}
                                disabled={!rows?.[0]?.score}
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

            {settings && (
                <Form
                    initialValues={settings}
                    layout="inline"
                    className={classes.form}
                    form={form}
                    requiredMark={false}
                >
                    <Form.Item label="Similarity Threshold" name="similarityThreshold">
                        <Slider
                            min={0}
                            max={1}
                            step={0.01}
                            className={classes.slider}
                            onChange={(value: number) => setSettings({similarityThreshold: value})}
                        />
                    </Form.Item>
                </Form>
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

export default SimilarityMatchEvaluationTable
