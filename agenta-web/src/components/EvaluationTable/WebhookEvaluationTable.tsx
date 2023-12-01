import {useState, useEffect, useRef} from "react"
import type {ColumnType} from "antd/es/table"
import {LineChartOutlined} from "@ant-design/icons"
import {
    Alert,
    Button,
    Card,
    Col,
    Form,
    Input,
    Row,
    Space,
    Spin,
    Statistic,
    Table,
    Tag,
    Tooltip,
    Typography,
    message,
} from "antd"
import {updateEvaluationScenario, callVariant, updateEvaluation} from "@/lib/services/api"
import {useVariants} from "@/lib/hooks/useVariant"
import {useRouter} from "next/router"
import {EvaluationFlow} from "@/lib/enums"
import {evaluateWithWebhook} from "@/lib/services/evaluations"
import {createUseStyles} from "react-jss"
import {globalErrorHandler} from "@/lib/helpers/errorHandler"
import {isValidUrl} from "@/lib/helpers/validators"
import SecondaryButton from "../SecondaryButton/SecondaryButton"
import {exportWebhookEvaluationData} from "@/lib/helpers/evaluate"
import {contentToChatMessageString, testsetRowToChatMessages} from "@/lib/helpers/testset"

const {Title} = Typography

interface WebhookEvaluationTableProps {
    evaluation: any
    columnsCount: number
    evaluationScenarios: WebhookEvaluationTableRow[]
}

interface WebhookEvaluationTableRow {
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
    infoBox: {
        marginBottom: 20,
    },
    pre: {
        position: "relative",
        overflow: "auto",
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
})

const WebhookEvaluationTable: React.FC<WebhookEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    columnsCount,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const variants = evaluation.variants
    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<WebhookEvaluationTableRow[]>([])
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
        const scores = rows.filter((item) => !isNaN(+item.score)).map((item) => +item.score)
        const avg = scores.reduce((acc, val) => acc + val, 0) / (scores.length || 1)
        setAccuracy(avg * 100)
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

        const {webhookUrl} = form.getFieldsValue()
        const promises: Promise<void>[] = []

        for (let i = 0; i < rows.length; i++) {
            promises.push(runEvaluation(i))
        }

        Promise.all(promises)
            .then(() => {
                updateEvaluation(evaluation.id, {
                    evaluation_type_settings: {
                        webhook_url: webhookUrl,
                    },
                    status: EvaluationFlow.EVALUATION_FINISHED,
                }).then(() => {
                    setSettings({webhookUrl})
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
            const columnName = columnsDataNames[idx] as keyof WebhookEvaluationTableRow
            try {
                let result = await callVariant(
                    inputParamsDict,
                    variantData[idx].inputParams!,
                    variantData[idx].optParams!,
                    appId || "",
                    variants[idx].baseId || "",
                    variantData[idx].isChatVariant
                        ? testsetRowToChatMessages(evaluation.testset.csvdata[rowIndex], false)
                        : [],
                )
                if (variantData[idx].isChatVariant) result = contentToChatMessageString(result)

                const {webhookUrl} = form.getFieldsValue()
                const score = await evaluateWithWebhook(webhookUrl, {
                    input_vars: inputParamsDict,
                    output: result,
                    correct_answer: rows[rowIndex].correctAnswer || null,
                })
                const evaluationScenarioId = rows[rowIndex].id

                if (evaluationScenarioId) {
                    await updateEvaluationScenario(
                        evaluation.id,
                        evaluationScenarioId,
                        {
                            score,
                            outputs: [{variant_id: variants[0].variantId, variant_output: result}],
                            inputs: rows[rowIndex].inputs,
                        },
                        evaluation.evaluationType,
                    )
                }

                setRowValue(rowIndex, "score", score)
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
        columnKey: keyof WebhookEvaluationTableRow,
        value: any,
    ) => {
        const newRows: any = [...rows]
        newRows[rowIndex][columnKey] = value
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<WebhookEvaluationTableRow>[] = Array.from(
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
                render: (value: any, record: WebhookEvaluationTableRow, ix: number) => {
                    if (loading[ix]) return "Loading..."

                    let outputValue
                    if (record.outputs && record.outputs.length > 0) {
                        outputValue = record.outputs.find(
                            (output: any) => output.variant_id === variants[i].variantId,
                        )?.variant_output
                    }

                    return value || outputValue || ""
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
            render: (_: any, record: WebhookEvaluationTableRow, rowIndex: number) => (
                <div>
                    {evaluation.testset.testsetChatColumn
                        ? evaluation.testset.csvdata[rowIndex][
                              evaluation.testset.testsetChatColumn
                          ] || " - "
                        : record &&
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
                            <Tooltip title={score}>
                                <Tag className={classes.tag}>{(+score).toFixed(2)}</Tag>
                            </Tooltip>
                        )}
                    </Space>
                )
            },
        },
    ]

    return (
        <div>
            <Title level={2}>Webhook URL Evaluation</Title>
            <Alert
                className={classes.infoBox}
                message="Endpoint Details"
                description={
                    <span>
                        The webhook URL you provide will be called with an <b>HTTP POST</b> request.
                        The request body will contain the following JSON object:
                        <pre className={classes.pre}>
                            <code>
                                {`{
    "input_vars": {                     // Key/value pairs for each variable in the Test Suite / Prompt
	    "var_1": "value_1",
	    "var_2": "value_2",
	    ...
    },
    "output": string,                   // The LLM's output
    "correct_answer": string | null     // The correct answer, if available
}`}
                            </code>
                        </pre>
                        Thre response of the payload should contain the following JSON object:
                        <pre className={classes.pre}>
                            <code>
                                {`{
    "score": number                     // Evaluation score between 0 and 1, 0 being "bad" and 1 being "good"
}`}
                            </code>
                        </pre>
                        <div>
                            <b>NOTE:</b> Your webhook should allow CORS request from our domain in
                            the response headers
                        </div>
                    </span>
                }
                type="info"
                showIcon
            />
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
                                onClick={() => exportWebhookEvaluationData(evaluation, rows)}
                                disabled={!rows?.[0]?.score}
                            >
                                Export results
                            </SecondaryButton>
                        </Space>
                    </Col>

                    <Col span={12}>
                        <Row justify="end">
                            <Card bordered={true} className={classes.card}>
                                <Statistic
                                    title="Accuracy:"
                                    value={accuracy}
                                    precision={2}
                                    suffix="%"
                                />
                            </Card>
                        </Row>
                    </Col>
                </Row>
            </div>

            {settings && (
                <Form
                    initialValues={settings}
                    layout="horizontal"
                    className={classes.form}
                    form={form}
                    requiredMark={false}
                >
                    <Form.Item
                        label="Webhook URL"
                        name="webhookUrl"
                        validateFirst
                        rules={[
                            {required: true, message: "Please enter a webhook url"},
                            {
                                validator: (_, value) =>
                                    new Promise((res, rej) =>
                                        isValidUrl(value)
                                            ? res("")
                                            : rej("Please enter a valid url"),
                                    ),
                            },
                        ]}
                    >
                        <Input placeholder="Enter URL to call" />
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

export default WebhookEvaluationTable
