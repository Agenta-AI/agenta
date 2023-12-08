import {useState, useEffect, useCallback} from "react"
import type {ColumnType} from "antd/es/table"
import {CaretRightOutlined} from "@ant-design/icons"
import {
    Button,
    Card,
    Col,
    Input,
    InputNumber,
    Radio,
    Row,
    Space,
    Spin,
    Statistic,
    Table,
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
import {createUseStyles} from "react-jss"
import {exportSingleModelEvaluationData} from "@/lib/helpers/evaluate"
import SecondaryButton from "../SecondaryButton/SecondaryButton"
import {useQueryParam} from "@/hooks/useQuery"
import EvaluationCardView from "../Evaluations/EvaluationCardView"
import {Evaluation, EvaluationScenario, KeyValuePair, Variant} from "@/lib/Types"
import {EvaluationTypeLabels, camelToSnake} from "@/lib/helpers/utils"
import {testsetRowToChatMessages} from "@/lib/helpers/testset"
import {debounce} from "lodash"
import EvaluationVotePanel from "../Evaluations/EvaluationCardView/EvaluationVotePanel"

const {Title} = Typography

interface EvaluationTableProps {
    evaluation: Evaluation
    evaluationScenarios: SingleModelEvaluationRow[]
}

export type SingleModelEvaluationRow = EvaluationScenario & {
    evaluationFlow: EvaluationFlow
} & {[variantId: string]: string}
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
    inputTestBtn: {
        width: "100%",
        display: "flex",
        justifyContent: "flex-end",
        "& button": {
            marginLeft: 10,
        },
    },
    recordInput: {
        marginBottom: 10,
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
    viewModeRow: {
        display: "flex",
        justifyContent: "flex-end",
        margin: "1rem 0",
        position: "sticky",
        top: 36,
        zIndex: 1,
    },
})

const SingleModelEvaluationTable: React.FC<EvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const variants = evaluation.variants

    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<SingleModelEvaluationRow[]>([])
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [viewMode, setViewMode] = useQueryParam("viewMode", "card")
    const [accuracy, setAccuracy] = useState<number>(0)

    useEffect(() => {
        if (evaluationScenarios) {
            const obj = [...evaluationScenarios]
            obj.forEach((item) =>
                item.outputs.forEach((op) => (item[op.variant_id] = op.variant_output)),
            )
            setRows(obj)
        }
    }, [evaluationScenarios])

    useEffect(() => {
        const filtered = rows.filter((row) => row.score !== null)
        const avg =
            filtered.reduce((acc, val) => acc + (val.score as number), 0) / (filtered.length || 1)
        setAccuracy(avg)
    }, [rows])

    useEffect(() => {
        if (evaluationStatus === EvaluationFlow.EVALUATION_FINISHED) {
            updateEvaluation(evaluation.id, {status: EvaluationFlow.EVALUATION_FINISHED}).catch(
                (err) => console.error("Failed to fetch results:", err),
            )
        }
    }, [evaluationStatus, evaluation.id])

    const handleInputChange = (
        e: React.ChangeEvent<HTMLTextAreaElement>,
        id: string,
        inputIndex: number,
    ) => {
        const rowIndex = rows.findIndex((row) => row.id === id)
        const newRows = [...rows]
        newRows[rowIndex].inputs[inputIndex].input_value = e.target.value
        setRows(newRows)
    }

    const handleScoreChange = (id: string, score: number) => {
        const rowIndex = rows.findIndex((row) => row.id === id)
        const evaluation_scenario_id = rows[rowIndex].id

        if (evaluation_scenario_id) {
            setRowValue(rowIndex, "score", "loading")
            const data = {
                score: score ?? "",
                outputs: variants.map((v: Variant) => ({
                    variant_id: v.variantId,
                    variant_output: rows[rowIndex][v.variantId],
                })),
                inputs: rows[rowIndex].inputs,
            }

            updateEvaluationScenarioData(evaluation_scenario_id, data)
        }
    }

    const depouncedHandleScoreChange = useCallback(
        debounce((...args: Parameters<typeof handleScoreChange>) => {
            handleScoreChange(...args)
        }, 800),
        [handleScoreChange],
    )

    const updateEvaluationScenarioData = async (
        id: string,
        data: Partial<EvaluationScenario>,
        showNotification: boolean = true,
    ) => {
        await updateEvaluationScenario(
            evaluation.id,
            id,
            Object.keys(data).reduce(
                (acc, key) => ({
                    ...acc,
                    [camelToSnake(key)]: data[key as keyof EvaluationScenario],
                }),
                {},
            ),
            evaluation.evaluationType,
        )
            .then(() => {
                Object.keys(data).forEach((key) => {
                    setRowValue(
                        evaluationScenarios.findIndex((item) => item.id === id),
                        key,
                        data[key as keyof EvaluationScenario],
                    )
                })
                if (showNotification) message.success("Evaluation Updated!")
            })
            .catch(console.error)
    }

    const runAllEvaluations = async () => {
        setEvaluationStatus(EvaluationFlow.EVALUATION_STARTED)
        Promise.all(rows.map((row) => runEvaluation(row.id!, rows.length - 1, false)))
            .then(() => {
                setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
                message.success("Evaluations Updated!")
            })
            .catch((err) => console.error("An error occurred:", err))
    }

    const runEvaluation = async (
        id: string,
        count: number = 1,
        showNotification: boolean = true,
    ) => {
        const rowIndex = rows.findIndex((row) => row.id === id)
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: {[key: string]: any}, item) => {
            acc[item.input_name] = item.input_value
            return acc
        }, {})

        const outputs = rows[rowIndex].outputs.reduce(
            (acc, op) => ({...acc, [op.variant_id]: op.variant_output}),
            {},
        )

        await Promise.all(
            variants.map(async (variant: Variant, idx: number) => {
                setRowValue(rowIndex, variant.variantId, "loading...")
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

                    setRowValue(rowIndex, variant.variantId, result)
                    ;(outputs as KeyValuePair)[variant.variantId] = result
                    setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)
                    if (idx === variants.length - 1) {
                        if (count === 1 || count === rowIndex) {
                            setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
                        }
                    }
                } catch (err) {
                    console.log("Error running evaluation:", err)
                    setRowValue(rowIndex, variant.variantId, "")
                }
            }),
        )

        updateEvaluationScenarioData(
            id,
            {
                outputs: Object.keys(outputs).map((key) => ({
                    variant_id: key,
                    variant_output: outputs[key as keyof typeof outputs],
                })),
                inputs: rows[rowIndex].inputs,
            },
            showNotification,
        )
    }

    const setRowValue = (
        rowIndex: number,
        columnKey: keyof SingleModelEvaluationRow,
        value: any,
    ) => {
        const newRows = [...rows]
        newRows[rowIndex][columnKey] = value as never
        setRows(newRows)
    }

    const dynamicColumns: ColumnType<SingleModelEvaluationRow>[] = variants.map(
        (variant: Variant) => {
            const columnKey = variant.variantId

            return {
                title: (
                    <div>
                        <span>App Variant: </span>
                        <span className={classes.appVariant}>
                            {variants ? variant.variantName : ""}
                        </span>
                    </div>
                ),
                dataIndex: columnKey,
                key: columnKey,
                width: "25%",
                render: (text: any, record: SingleModelEvaluationRow, rowIndex: number) => {
                    if (text) return text
                    if (record.outputs && record.outputs.length > 0) {
                        const outputValue = record.outputs.find(
                            (output: any) => output.variant_id === columnKey,
                        )?.variant_output
                        return <div>{outputValue}</div>
                    }
                    return ""
                },
            }
        },
    )

    const columns = [
        {
            key: "1",
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
            render: (text: any, record: SingleModelEvaluationRow, rowIndex: number) => (
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
                                  <Input.TextArea
                                      rows={2}
                                      placeholder={input.input_name}
                                      value={input.input_value}
                                      onChange={(e) => handleInputChange(e, record.id, index)}
                                  />
                              </div>
                          ))}

                    <div className={classes.inputTestBtn}>
                        <Button
                            onClick={() => runEvaluation(record.id!)}
                            icon={<CaretRightOutlined />}
                        >
                            Run
                        </Button>
                    </div>
                </div>
            ),
        },
        ...dynamicColumns,
        {
            title: "Evaluate",
            dataIndex: "evaluate",
            key: "evaluate",
            width: 200,
            // fixed: 'right',
            render: (text: any, record: any, rowIndex: number) => {
                return (
                    <EvaluationVotePanel
                        type="numeric"
                        value={[
                            {
                                variantId: variants[0].variantId,
                                score: record.score as number,
                            },
                        ]}
                        variants={variants}
                        onChange={(val) =>
                            depouncedHandleScoreChange(record.id, val[0].score as number)
                        }
                        loading={record.score === "loading"}
                        showVariantName={false}
                        key={record.id}
                    />
                )
            },
        },
    ]

    return (
        <div>
            <Title level={2}>{EvaluationTypeLabels.single_model_test}</Title>
            <div>
                <Row align="middle">
                    <Col span={12}>
                        <Space>
                            <Button
                                type="primary"
                                onClick={runAllEvaluations}
                                size="large"
                                data-cy="single-model-run-all-button"
                            >
                                Run All
                            </Button>
                            <SecondaryButton
                                onClick={() => exportSingleModelEvaluationData(evaluation, rows)}
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

            <div className={classes.viewModeRow}>
                <Radio.Group
                    options={[
                        {label: "Card View", value: "card"},
                        {label: "Tabular View", value: "tabular"},
                    ]}
                    onChange={(e) => setViewMode(e.target.value)}
                    value={viewMode}
                    optionType="button"
                />
            </div>

            {viewMode === "tabular" ? (
                <Table
                    dataSource={rows}
                    columns={columns}
                    pagination={false}
                    rowClassName={() => "editable-row"}
                    rowKey={(record) => record.id!}
                />
            ) : (
                <EvaluationCardView
                    variants={variants}
                    evaluationScenarios={rows}
                    onRun={runEvaluation}
                    onVote={(id, score) => depouncedHandleScoreChange(id, score as number)}
                    onInputChange={handleInputChange}
                    updateEvaluationScenarioData={updateEvaluationScenarioData}
                    evaluation={evaluation}
                />
            )}
        </div>
    )
}

export default SingleModelEvaluationTable
