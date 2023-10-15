import {useState, useEffect, useRef} from "react"
import type {ColumnType} from "antd/es/table"
import {InfoCircleOutlined, LineChartOutlined} from "@ant-design/icons"
import {
    Button,
    Card,
    Col,
    Form,
    Input,
    Radio,
    Row,
    Space,
    Spin,
    Statistic,
    Table,
    Tag,
    Tooltip,
    message,
    Typography,
} from "antd"
import {updateEvaluationScenario, callVariant, updateEvaluation} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {evaluateWithRegex} from "@/lib/services/evaluations"
import {createUseStyles} from "react-jss"
import Highlighter from "react-highlight-words"
import {globalErrorHandler} from "@/lib/helpers/errorHandler"
import SecondaryButton from "../SecondaryButton/SecondaryButton"
import {exportRegexEvaluationData} from "@/lib/helpers/evaluate"
import {isValidRegex} from "@/lib/helpers/validators"

const {Title} = Typography

interface RegexEvaluationTableProps {
    evaluation: any
    columnsCount: number
    evaluationScenarios: RegexEvaluationTableRow[]
}

interface RegexEvaluationTableRow {
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
    isMatch: boolean
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
    form: {
        marginBottom: 20,
        "& .ant-form-item-has-error": {
            marginBottom: 0,
        },
    },
    regexInput: {
        minWidth: 240,
    },
    infoLabel: {
        display: "flex",
        gap: 3,
        alignItems: "center",
        "& .anticon-info-circle": {
            color: "#faad14",
            marginTop: 2,
        },
    },
})

const RegexEvaluationTable: React.FC<RegexEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const variants = evaluation.variants
    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<RegexEvaluationTableRow[]>([])
    const [wrongAnswers, setWrongAnswers] = useState<number>(0)
    const [correctAnswers, setCorrectAnswers] = useState<number>(0)
    const [accuracy, setAccuracy] = useState<number>(0)
    const [settings, setSettings] = useState(evaluation.evaluationTypeSettings)
    const [loading, setLoading] = useState<boolean[]>([])
    const [form] = Form.useForm()
    const showError = useRef(true)

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(evaluationScenarios)
            setLoading(Array(evaluationScenarios.length).fill(false))
        }
    }, [evaluationScenarios])

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
        //validate form
        try {
            await form.validateFields()
        } catch {
            return
        }
        showError.current = true

        const {regexPattern, regexShouldMatch} = form.getFieldsValue()
        const promises: Promise<void>[] = []

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i))
        }

        Promise.all(promises)
            .then(() => {
                updateEvaluation(evaluation.id, {
                    evaluation_type_settings: {
                        regex_should_match: regexShouldMatch,
                        regex_pattern: regexPattern,
                    },
                    status: EvaluationFlow.EVALUATION_FINISHED,
                }).then(() => {
                    setSettings({regexShouldMatch, regexPattern})
                    message.success("Evaluation Results Saved")
                })
            })
            .catch(() => {})
    }

    const runEvaluation = async (rowIndex: number) => {
        setLoading((prev) => prev.map((val, i) => (i === rowIndex ? true : val)))
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: {[key: string]: any}, item) => {
            acc[item.input_name] = item.input_value
            return acc
        }, {})

        const columnsDataNames = ["columnData0"]
        for (let idx = 0; idx < columnsDataNames.length; ++idx) {
            const columnName = columnsDataNames[idx] as keyof RegexEvaluationTableRow
            try {
                let result = await callVariant(
                    inputParamsDict,
                    variantData[idx].inputParams!,
                    variantData[idx].optParams!,
                    appId || "",
                    variants[idx].baseId || "",
                )

                const {regexPattern, regexShouldMatch} = form.getFieldsValue()
                const isCorrect = evaluateWithRegex(result, regexPattern, regexShouldMatch)
                const evaluationScenarioId = rows[rowIndex].id
                const score = isCorrect ? "correct" : "wrong"

                if (evaluationScenarioId) {
                    await updateEvaluationScenario(
                        evaluation.id,
                        evaluationScenarioId,
                        {
                            score,
                            outputs: [{variant_id: variants[0].variantId, variant_output: result}],
                        },
                        evaluation.evaluationType,
                    )
                }

                setRowValue(rowIndex, "score", score)
                if (isCorrect) {
                    setCorrectAnswers((prevCorrect) => prevCorrect + 1)
                } else {
                    setWrongAnswers((prevWrong) => prevWrong + 1)
                }
                setRowValue(rowIndex, columnName, result)
            } catch (err) {
                setRowValue(rowIndex, columnName, "")
                if (showError.current) {
                    globalErrorHandler(err)
                    showError.current = false
                }
                throw err
            } finally {
                setLoading((prev) => prev.map((val, i) => (i === rowIndex ? false : val)))
            }
        }
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof RegexEvaluationTableRow,
        value: any,
    ) => {
        const newRows: any = [...rows]
        newRows[rowIndex][columnKey] = value
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<RegexEvaluationTableRow>[] = Array.from(
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
                render: (value: any, record: RegexEvaluationTableRow, ix: number) => {
                    if (loading[ix]) return "Loading..."

                    let outputValue = value
                    if (record.outputs && record.outputs.length > 0) {
                        outputValue = record.outputs.find(
                            (output: any) => output.variant_id === variants[i].variantId,
                        )?.variant_output
                    }

                    return (
                        <Highlighter
                            textToHighlight={outputValue}
                            searchWords={[settings.regexPattern]}
                        />
                    )
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
            render: (_: any, record: RegexEvaluationTableRow, rowIndex: number) => (
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
            title: "Match / Mismatch",
            dataIndex: "score",
            key: "isMatch",
            width: "25%",
            render: (val: string, _: any, ix: number) => {
                if (loading[ix]) return <Spin spinning />

                const isCorrect = val === "correct"
                const isMatch = settings.regexShouldMatch ? isCorrect : !isCorrect
                return settings.regexPattern ? <div>{isMatch ? "Match" : "Mismatch"}</div> : null
            },
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
                            <Tag
                                color={score === "correct" ? "green" : "red"}
                                className={classes.tag}
                            >
                                {score}
                            </Tag>
                        )}
                    </Space>
                )
            },
        },
    ]

    return (
        <div>
            <Title level={2}>Regex Match / Mismatch Evaluation</Title>
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
                                    exportRegexEvaluationData(evaluation, rows, settings)
                                }
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

            {settings && (
                <Form
                    initialValues={settings}
                    layout="inline"
                    className={classes.form}
                    form={form}
                    requiredMark={false}
                >
                    <Form.Item
                        label="Regex"
                        name="regexPattern"
                        rules={[
                            {required: true, message: "Please enter a regex pattern"},
                            {
                                validator: (_, value) =>
                                    new Promise((res, rej) =>
                                        isValidRegex(value)
                                            ? res("")
                                            : rej("Regex pattern is not valid"),
                                    ),
                            },
                        ]}
                    >
                        <Input
                            placeholder="Pattern (ex: ^this_word\d{3}$)"
                            className={classes.regexInput}
                        />
                    </Form.Item>
                    <Form.Item
                        label={
                            <span className={classes.infoLabel}>
                                Strategy
                                <Tooltip title="Choose whether the LLM output should match the pattern or not.">
                                    <InfoCircleOutlined />
                                </Tooltip>
                            </span>
                        }
                        rules={[{required: true, message: "Please select strategy"}]}
                        name="regexShouldMatch"
                    >
                        <Radio.Group>
                            <Radio value={true}> Match </Radio>
                            <Radio value={false}> Mismatch </Radio>
                        </Radio.Group>
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

export default RegexEvaluationTable
