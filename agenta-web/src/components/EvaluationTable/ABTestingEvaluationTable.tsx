import {useState, useEffect, useCallback, useMemo} from "react"

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
import debounce from "lodash/debounce"
import {useRouter} from "next/router"

import {updateEvaluationScenario, updateEvaluation} from "@/services/human-evaluations/api"
import {callVariant} from "@/services/api"
import {EvaluationFlow} from "@/lib/enums"
import {exportABTestingEvaluationData} from "@/lib/helpers/evaluate"
import {
    EvaluationTypeLabels,
    batchExecute,
    camelToSnake,
    getStringOrJson,
} from "@/lib/helpers/utils"
import {useQueryParam} from "@/hooks/useQuery"
import {testsetRowToChatMessages} from "@/lib/helpers/testset"
import {variantNameWithRev} from "@/lib/helpers/variantHelper"
import {isBaseResponse, isFuncResponse} from "@/lib/helpers/playgroundResp"

import SecondaryButton from "../SecondaryButton/SecondaryButton"
import EvaluationCardView from "../Evaluations/EvaluationCardView"
import EvaluationVotePanel from "../Evaluations/EvaluationCardView/EvaluationVotePanel"
import VariantAlphabet from "../Evaluations/EvaluationCardView/VariantAlphabet"
import ParamsFormWithRun from "./components/ParamsFormWithRun"
import {useABTestingEvaluationTableStyles} from "./assets/styles"

import type {ColumnType} from "antd/es/table"
import type {BaseResponse, EvaluationScenario, KeyValuePair, Variant} from "@/lib/Types"
import type {ABTestingEvaluationTableProps, ABTestingEvaluationTableRow} from "./types"
import {useAppsData} from "@/contexts/app.context"
import {useVariants} from "@/lib/hooks/useVariants"
import {VARIANT_COLORS} from "../Evaluations/EvaluationCardView/assets/styles"
import {useEvaluationResults} from "@/services/human-evaluations/hooks/useEvaluationResults"
import {transformToRequestBody} from "@/lib/hooks/useStatelessVariant/assets/transformer/reverseTransformer"
import {getAllMetadata} from "@/lib/hooks/useStatelessVariant/state"

const {Title} = Typography

/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */
const ABTestingEvaluationTable: React.FC<ABTestingEvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    isLoading,
}) => {
    const classes = useABTestingEvaluationTableStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const evalVariants = [...evaluation.variants]
    const {currentApp} = useAppsData()

    const {data, isLoading: isVariantsLoading} = useVariants(currentApp)(
        {
            appId: appId,
        },
        evalVariants,
    )

    const variantData = data?.variants || []

    const [rows, setRows] = useState<ABTestingEvaluationTableRow[]>([])
    const [, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [viewMode, setViewMode] = useQueryParam("viewMode", "card")
    const {data: evaluationResults, mutate} = useEvaluationResults({
        evaluationId: evaluation.id,
        onSuccess: () => {
            updateEvaluation(evaluation.id, {status: EvaluationFlow.EVALUATION_FINISHED})
        },
        onError: (err) => {
            console.error("Failed to fetch results:", err)
        },
    })

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
            setRows((prevRows) => {
                const obj = [...evaluationScenarios]
                obj.forEach((item) =>
                    item.outputs.forEach((op) => (item[op.variant_id] = op.variant_output)),
                )
                return obj
            })
        }
    }, [evaluationScenarios])

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>, id: string, inputIndex: number) => {
            setRows((oldRows) => {
                const rowIndex = oldRows.findIndex((row) => row.id === id)
                const newRows = [...rows]
                newRows[rowIndex].inputs[inputIndex].input_value = e.target.value
                return newRows
            })
        },
        [],
    )

    const setRowValue = useCallback(
        (rowIndex: number, columnKey: keyof ABTestingEvaluationTableRow, value: any) => {
            setRows((oldRows) => {
                const newRows = [...oldRows]
                newRows[rowIndex][columnKey] = value as never
                return newRows
            })
        },
        [],
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
            const evaluation_scenario_id = rows[rowIndex]?.id

            if (evaluation_scenario_id) {
                setRowValue(rowIndex, "vote", "loading")
                const data = {
                    vote: vote,
                    outputs: evalVariants.map((v: Variant) => ({
                        variant_id: v.variantId,
                        variant_output: rows[rowIndex][v.variantId],
                    })),
                    inputs: rows[rowIndex].inputs,
                }
                updateEvaluationScenarioData(evaluation_scenario_id, data)
            }
        },
        [rows, setRowValue, updateEvaluationScenarioData, evalVariants],
    )

    const runEvaluation = useCallback(
        async (id: string, count: number = 1, showNotification: boolean = true) => {
            const variantData = data?.variants || []
            const rowIndex = rows.findIndex((row) => row.id === id)
            const inputParamsDict = rows[rowIndex].inputs.reduce(
                (acc: {[key: string]: any}, item) => {
                    acc[item.input_name] = item.input_value
                    return acc
                },
                {},
            )

            const outputs = rows[rowIndex].outputs.reduce(
                (acc, op) => ({...acc, [op.variant_id]: op.variant_output}),
                {},
            )

            await Promise.all(
                evalVariants.map(async (variant: Variant, idx: number) => {
                    setRowValue(rowIndex, variant.variantId, "loading...")

                    try {
                        let result = await callVariant(
                            inputParamsDict,
                            (data?.variants || [])[idx].inputParams!,
                            (data?.variants || [])[idx].parameters
                                ? transformToRequestBody(
                                      (data?.variants || [])[idx].variant,
                                      undefined,
                                      getAllMetadata(),
                                  )
                                : (data?.variants || [])[idx].promptOptParams!,
                            appId || "",
                            variant.baseId || "",
                            (data?.variants || [])[idx].isChatVariant
                                ? testsetRowToChatMessages(
                                      evaluation.testset.csvdata[rowIndex],
                                      false,
                                  )
                                : [],
                            undefined,
                            true,
                            !!(data?.variants || [])[idx].parameters, // isNewVariant
                        )

                        let res: BaseResponse | undefined

                        if (typeof result === "string") {
                            res = {version: "2.0", data: result} as BaseResponse
                        } else if (isFuncResponse(result)) {
                            res = {version: "2.0", data: result.message} as BaseResponse
                        } else if (isBaseResponse(result)) {
                            res = result as BaseResponse
                        } else if (result.data) {
                            res = {version: "2.0", data: result.data} as BaseResponse
                        } else {
                            res = {version: "2.0", data: ""} as BaseResponse
                        }

                        let _result = getStringOrJson(res.data)

                        setRowValue(rowIndex, variant.variantId, _result)
                        ;(outputs as KeyValuePair)[variant.variantId] = _result
                        setRowValue(
                            rowIndex,
                            "evaluationFlow",
                            EvaluationFlow.COMPARISON_RUN_STARTED,
                        )
                        if (idx === evalVariants.length - 1) {
                            if (count === 1 || count === rowIndex) {
                                setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
                            }
                        }
                    } catch (err) {
                        console.error("Error running evaluation:", err)
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
        },
        [
            data?.variants,
            rows,
            evalVariants,
            updateEvaluationScenarioData,
            setRowValue,
            appId,
            evaluation.testset.csvdata,
        ],
    )

    const runAllEvaluations = useCallback(async () => {
        setEvaluationStatus(EvaluationFlow.EVALUATION_STARTED)
        batchExecute(rows.map((row) => () => runEvaluation(row.id!, rows.length - 1, false)))
            .then(() => {
                setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
                mutate()
                message.success("Evaluations Updated!")
            })
            .catch((err) => console.error("An error occurred:", err))
    }, [runEvaluation, rows])

    const dynamicColumns: ColumnType<ABTestingEvaluationTableRow>[] = useMemo(
        () =>
            evalVariants.map((variant: Variant, ix) => {
                const columnKey = variant.variantId

                return {
                    title: (
                        <div>
                            <span>Variant: </span>
                            <VariantAlphabet index={ix} width={24} />
                            <span
                                className={classes.appVariant}
                                style={{color: VARIANT_COLORS[ix]}}
                            >
                                {evalVariants
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
            }),
        [evalVariants],
    )

    const columns = useMemo(() => {
        return [
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
                width: 300,
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
                            isLoading={isVariantsLoading}
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
                                autoSize={{minRows: 3, maxRows: 10}}
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
                                    variants={evalVariants}
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
                                autoSize={{minRows: 3, maxRows: 10}}
                                onChange={(e) =>
                                    depouncedUpdateEvaluationScenario(
                                        {note: e.target.value},
                                        record.id,
                                    )
                                }
                                key={record.id}
                            />
                        </>
                    )
                },
            },
        ]
    }, [runEvaluation, isVariantsLoading, rows])

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
                    variants={evalVariants}
                    evaluationScenarios={rows}
                    onRun={runEvaluation}
                    onVote={(id, vote) => handleVoteClick(id, vote as string)}
                    onInputChange={handleInputChange}
                    updateEvaluationScenarioData={updateEvaluationScenarioData}
                    evaluation={evaluation}
                    variantData={variantData}
                    isLoading={isLoading || isVariantsLoading}
                />
            )}
        </div>
    )
}

export default ABTestingEvaluationTable
