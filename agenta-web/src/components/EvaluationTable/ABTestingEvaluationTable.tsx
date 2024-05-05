import {useState, useEffect, useCallback} from "react"
import type {ColumnType} from "antd/es/table"
import {
    Button,
    Card,
    Col,
    Input,
    Radio,
    Row,
    Space,
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
import {exportABTestingEvaluationData} from "@/lib/helpers/evaluate"
import SecondaryButton from "../SecondaryButton/SecondaryButton"
import {useQueryParam} from "@/hooks/useQuery"
import EvaluationCardView, {VARIANT_COLORS} from "../Evaluations/EvaluationCardView"
import {Evaluation, EvaluationResult, EvaluationScenario, KeyValuePair, Variant} from "@/lib/Types"
import {EvaluationTypeLabels, batchExecute, camelToSnake} from "@/lib/helpers/utils"
import {testsetRowToChatMessages} from "@/lib/helpers/testset"
import EvaluationVotePanel from "../Evaluations/EvaluationCardView/EvaluationVotePanel"
import VariantAlphabet from "../Evaluations/EvaluationCardView/VariantAlphabet"
import {ParamsFormWithRun} from "./SingleModelEvaluationTable"
import {debounce} from "lodash"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"

const {Title} = Typography

interface EvaluationTableProps {
    evaluation: Evaluation
    columnsCount: number
    evaluationScenarios: ABTestingEvaluationTableRow[]
    isLoading: boolean
}

export type ABTestingEvaluationTableRow = EvaluationScenario & {
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
        marginTop: "0.75rem",
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
    stat: {
        "& .ant-statistic-content-value": {
            color: "#1677ff",
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
    sideBar: {
        marginTop: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "2rem",
        border: "1px solid #d9d9d9",
        borderRadius: 6,
        padding: "1rem",
        alignSelf: "flex-start",
        "&>h4.ant-typography": {
            margin: 0,
        },
        flex: 0.35,
        minWidth: 240,
        maxWidth: 500,
    },
})

const ABTestingEvaluationTable: React.FC<EvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    isLoading,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const variants = evaluation.variants

    const variantData = useVariants(appId, variants)

    const [rows, setRows] = useState<ABTestingEvaluationTableRow[]>([])
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [evaluationResults, setEvaluationResults] = useState<EvaluationResult | null>(null)
    const [viewMode, setViewMode] = useQueryParam("viewMode", "card")

    let num_of_rows = evaluationResults?.votes_data.nb_of_rows || 0
    let flag_votes = evaluationResults?.votes_data.flag_votes?.number_of_votes || 0
    let positive_votes = evaluationResults?.votes_data.positive_votes.number_of_votes || 0
    let appVariant1 =
        evaluationResults?.votes_data?.variants_votes_data?.[evaluation.variants[0]?.variantId]
            ?.number_of_votes || 0
    let appVariant2 =
        evaluationResults?.votes_data?.variants_votes_data?.[evaluation.variants[1]?.variantId]
            ?.number_of_votes || 0

    const depouncedUpdateEvaluationScenario = useCallback(
        debounce((data: Partial<EvaluationScenario>, scenarioId) => {
            updateEvaluationScenarioData(scenarioId, data)
        }, 800),
        [evaluationScenarios],
    )

    useEffect(() => {
        if (evaluationScenarios) {
            const obj = [...evaluationScenarios]
            obj.forEach((item) =>
                item.outputs.forEach((op) => (item[op.variant_id] = op.variant_output)),
            )
            setRows(obj)
        }
    }, [evaluationScenarios])

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

    const setRowValue = useCallback(
        (rowIndex: number, columnKey: keyof ABTestingEvaluationTableRow, value: any) => {
            const newRows = [...rows]
            newRows[rowIndex][columnKey] = value as never
            setRows(newRows)
        },
        [rows],
    )

    const updateEvaluationScenarioData = useCallback(
        async (id: string, data: Partial<EvaluationScenario>, showNotification: boolean = true) => {
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
        },
        [evaluation.evaluationType, evaluation.id, evaluationScenarios, setRowValue],
    )

    const handleVoteClick = useCallback(
        (id: string, vote: string) => {
            const rowIndex = rows.findIndex((row) => row.id === id)
            const evaluation_scenario_id = rows[rowIndex].id

            if (evaluation_scenario_id) {
                setRowValue(rowIndex, "vote", "loading")
                const data = {
                    vote: vote,
                    outputs: variants.map((v: Variant) => ({
                        variant_id: v.variantId,
                        variant_output: rows[rowIndex][v.variantId],
                    })),
                    inputs: rows[rowIndex].inputs,
                }

                updateEvaluationScenarioData(evaluation_scenario_id, data)
            }
        },
        [rows, setRowValue, updateEvaluationScenarioData, variants],
    )

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
    }, [evaluationStatus, evaluation.id, handleVoteClick])

    const runAllEvaluations = async () => {
        setEvaluationStatus(EvaluationFlow.EVALUATION_STARTED)
        batchExecute(rows.map((row) => () => runEvaluation(row.id!, rows.length - 1, false)))
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
                    if (typeof result !== "string") {
                        result = result.message
                    }

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

    const dynamicColumns: ColumnType<ABTestingEvaluationTableRow>[] = variants.map(
        (variant: Variant, ix) => {
            const columnKey = variant.variantId

            return {
                title: (
                    <div>
                        <span>Variant: </span>
                        <VariantAlphabet index={ix} width={24} />
                        <span className={classes.appVariant} style={{color: VARIANT_COLORS[ix]}}>
                            {variants
                                ? variantNameWithRev({
                                      variant_name: variant.variantName,
                                      revision: evaluation.revisions[ix],
                                  })
                                : ""}
                        </span>
                    </div>
                ),
                dataIndex: columnKey,
                key: columnKey,
                width: "20%",
                render: (text: any, record: ABTestingEvaluationTableRow, rowIndex: number) => {
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
            render: (_: any, record: ABTestingEvaluationTableRow, rowIndex: number) => {
                return (
                    <ParamsFormWithRun
                        evaluation={evaluation}
                        record={record}
                        rowIndex={rowIndex}
                        onRun={() => runEvaluation(record.id!)}
                        onParamChange={(name, value) =>
                            handleInputChange(
                                {target: {value}} as any,
                                record.id,
                                record?.inputs.findIndex((ip) => ip.input_name === name),
                            )
                        }
                        variantData={variantData}
                    />
                )
            },
        },
        {
            title: "Expected Output",
            dataIndex: "expectedOutput",
            key: "expectedOutput",
            width: "25%",
            render: (text: any, record: any, rowIndex: number) => {
                let correctAnswer =
                    record.correctAnswer || evaluation.testset.csvdata[rowIndex].correct_answer

                return (
                    <>
                        <Input.TextArea
                            defaultValue={correctAnswer}
                            autoSize={{minRows: 3, maxRows: 5}}
                            onChange={(e) =>
                                depouncedUpdateEvaluationScenario(
                                    {
                                        correctAnswer: e.target.value,
                                    },
                                    record.id,
                                )
                            }
                            key={record.id}
                        />
                    </>
                )
            },
        },
        ...dynamicColumns,
        {
            title: "Score",
            dataIndex: "score",
            key: "score",
            render: (text: any, record: any, rowIndex: number) => {
                return (
                    <>
                        {
                            <EvaluationVotePanel
                                type="comparison"
                                value={record.vote || ""}
                                variants={variants}
                                onChange={(vote) => handleVoteClick(record.id, vote)}
                                loading={record.vote === "loading"}
                                vertical
                                key={record.id}
                                outputs={record.outputs}
                            />
                        }
                    </>
                )
            },
        },
        {
            title: "Additional Note",
            dataIndex: "additionalNote",
            key: "additionalNote",
            render: (text: any, record: any, rowIndex: number) => {
                return (
                    <>
                        <Input.TextArea
                            defaultValue={record?.note || ""}
                            autoSize={{minRows: 3, maxRows: 5}}
                            onChange={(e) =>
                                depouncedUpdateEvaluationScenario({note: e.target.value}, record.id)
                            }
                            key={record.id}
                        />
                    </>
                )
            },
        },
    ]

    return (
        <div>
            <Title level={2}>{EvaluationTypeLabels.human_a_b_testing}</Title>
            <div>
                <Row align="middle">
                    <Col span={12}>
                        <Space>
                            <Button
                                type="primary"
                                onClick={runAllEvaluations}
                                size="large"
                                data-cy="abTesting-run-all-button"
                            >
                                Run All
                            </Button>
                            <SecondaryButton
                                onClick={() =>
                                    exportABTestingEvaluationData(
                                        evaluation,
                                        evaluationScenarios,
                                        rows,
                                    )
                                }
                                disabled={false}
                            >
                                Export Results
                            </SecondaryButton>
                        </Space>
                    </Col>

                    <Col span={12}>
                        <Card bordered={true} className={classes.card}>
                            <Row justify="end">
                                <Col span={10}>
                                    <Statistic
                                        title={`${
                                            evaluation.variants[0]?.variantName || ""
                                        } is better:`}
                                        value={`${appVariant1} out of ${num_of_rows}`}
                                        className={classes.stat}
                                    />
                                </Col>
                                <Col span={10}>
                                    <Statistic
                                        title={`${
                                            evaluation.variants[1]?.variantName || ""
                                        } is better:`}
                                        value={`${appVariant2} out of ${num_of_rows}`}
                                        className={classes.stat}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Statistic
                                        title="Both are good:"
                                        value={`${positive_votes} out of ${num_of_rows}`}
                                        className={classes.statCorrect}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Statistic
                                        title="Both are bad:"
                                        value={`${flag_votes} out of ${num_of_rows}`}
                                        className={classes.statWrong}
                                    />
                                </Col>
                            </Row>
                        </Card>
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
                    rowKey={(record) => record.id!}
                />
            ) : (
                <EvaluationCardView
                    variants={variants}
                    evaluationScenarios={rows}
                    onRun={runEvaluation}
                    onVote={(id, vote) => handleVoteClick(id, vote as string)}
                    onInputChange={handleInputChange}
                    updateEvaluationScenarioData={updateEvaluationScenarioData}
                    evaluation={evaluation}
                    variantData={variantData}
                    isLoading={isLoading}
                />
            )}
        </div>
    )
}

export default ABTestingEvaluationTable
