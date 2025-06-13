// @ts-nocheck
import {useCallback, useEffect, useState, useMemo} from "react"

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
import type {ColumnType} from "antd/es/table"
import debounce from "lodash/debounce"
import {useRouter} from "next/router"

import {useAppsData} from "@/oss/contexts/app.context"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {EvaluationFlow} from "@/oss/lib/enums"
import {exportSingleModelEvaluationData} from "@/oss/lib/helpers/evaluate"
import {isBaseResponse, isFuncResponse} from "@/oss/lib/helpers/playgroundResp"
import {testsetRowToChatMessages} from "@/oss/lib/helpers/testset"
import {
    EvaluationTypeLabels,
    batchExecute,
    camelToSnake,
    getStringOrJson,
} from "@/oss/lib/helpers/utils"
import {variantNameWithRev} from "@/oss/lib/helpers/variantHelper"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {BaseResponse, EvaluationScenario, KeyValuePair, Variant} from "@/oss/lib/Types"
import {callVariant} from "@/oss/services/api"
import {updateEvaluation, updateEvaluationScenario} from "@/oss/services/human-evaluations/api"

import EvaluationCardView from "../Evaluations/EvaluationCardView"
import EvaluationVotePanel from "../Evaluations/EvaluationCardView/EvaluationVotePanel"
import SaveTestsetModal from "../SaveTestsetModal/SaveTestsetModal"
import SecondaryButton from "../SecondaryButton/SecondaryButton"

import {useSingleModelEvaluationTableStyles} from "./assets/styles"
import ParamsFormWithRun from "./components/ParamsFormWithRun"
import type {EvaluationTableProps, SingleModelEvaluationRow} from "./types"

const {Title} = Typography

/**
 *
 * @param evaluation - Evaluation object
 * @param evaluationScenarios - Evaluation rows
 * @param columnsCount - Number of variants to compare face to face (per default 2)
 * @returns
 */
const SingleModelEvaluationTable: React.FC<EvaluationTableProps> = ({
    evaluation,
    evaluationScenarios,
    isLoading,
}) => {
    const classes = useSingleModelEvaluationTableStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const variants = evaluation.variants
    const {currentApp} = useAppsData()

    const {data, isLoading: isVariantsLoading} = useVariants(currentApp)(
        {
            appId: appId,
        },
        variants,
    )

    // Select the correct variant revisions for this evaluation
    const variantData = useMemo(() => {
        const allVariantData = data?.variants || []
        if (!allVariantData.length) return []

        return evaluation.variants.map((evVariant, idx) => {
            const revisionId = evaluation.variant_revision_ids?.[idx]
            const revisionNumber = evaluation.revisions?.[idx]

            // 1. Try to find by exact revision id
            let selected = allVariantData.find((v) => v.id === revisionId)

            // 2. Try by variantId & revision number
            if (!selected && revisionNumber !== undefined) {
                selected = allVariantData.find(
                    (v) => v.variantId === evVariant.variantId && v.revision === revisionNumber,
                )
            }

            // 3. Fallback – latest revision for that variant
            if (!selected) {
                selected = allVariantData.find(
                    (v) => v.variantId === evVariant.variantId && v.isLatestRevision,
                )
            }

            return selected || evVariant
        })
    }, [data?.variants, evaluation.variants, evaluation.variant_revision_ids, evaluation.revisions])

    const [rows, setRows] = useState<SingleModelEvaluationRow[]>([])
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [viewMode, setViewMode] = useQueryParam("viewMode", "card")
    const [accuracy, setAccuracy] = useState<number>(0)
    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)

    const depouncedUpdateEvaluationScenario = useCallback(
        debounce((data: Partial<EvaluationScenario>, scenarioId) => {
            updateEvaluationScenarioData(scenarioId, data)
        }, 800),
        [rows],
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

    useEffect(() => {
        const filtered = rows.filter((row) => typeof row.score === "number" && !isNaN(row.score))

        if (filtered.length > 0) {
            const avg = filtered.reduce((acc, val) => acc + Number(val.score), 0) / filtered.length
            setAccuracy(avg)
        } else {
            setAccuracy(0)
        }
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
        showNotification = true,
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
                        rows.findIndex((item) => item.id === id),
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
        batchExecute(rows.map((row) => () => runEvaluation(row.id!, rows.length - 1, false)))
            .then(() => {
                setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
                message.success("Evaluations Updated!")
            })
            .catch((err) => console.error("An error occurred:", err))
    }

    const runEvaluation = async (id: string, count = 1, showNotification = true) => {
        const rowIndex = rows.findIndex((row) => row.id === id)
        const inputParamsDict = rows[rowIndex].inputs.reduce((acc: Record<string, any>, item) => {
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
                    const result = await callVariant(
                        inputParamsDict,
                        variantData[idx].inputParams!,
                        variantData[idx].parameters
                            ? transformToRequestBody({
                                  variant: variantData[idx],
                                  allMetadata: getAllMetadata(),
                              })
                            : variantData[idx].promptOptParams!,
                        appId || "",
                        variantData[idx].baseId || "",
                        variantData[idx].isChatVariant
                            ? testsetRowToChatMessages(evaluation.testset.csvdata[rowIndex], false)
                            : [],
                        undefined,
                        true,
                        !!variantData[idx]._parentVariant, // isNewVariant
                        variantData[idx].isCustom,
                        variantData[idx].uriObject,
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
                        console.error("Unknown response type:", result)
                    }

                    const _result = getStringOrJson(res.data)

                    setRowValue(rowIndex, variant.variantId, _result)
                    ;(outputs as KeyValuePair)[variant.variantId] = _result
                    setRowValue(rowIndex, "evaluationFlow", EvaluationFlow.COMPARISON_RUN_STARTED)
                    if (idx === variants.length - 1) {
                        if (count === 1 || count === rowIndex) {
                            setEvaluationStatus(EvaluationFlow.EVALUATION_FINISHED)
                        }
                    }

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
                } catch (err) {
                    console.error("Error running evaluation:", err)
                    setEvaluationStatus(EvaluationFlow.EVALUATION_FAILED)
                    setRowValue(
                        rowIndex,
                        variant.variantId,
                        err?.response?.data?.detail?.message || "Failed to run evaluation!",
                    )
                }
            }),
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
                            {variants
                                ? variantNameWithRev({
                                      variant_name: variant.variantName,
                                      revision: evaluation.revisions[0],
                                  })
                                : ""}
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
            width: 300,
            dataIndex: "inputs",
            render: (_: any, record: SingleModelEvaluationRow, rowIndex: number) => {
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
                const correctAnswer =
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
                                type="rating"
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
                                onClick={() =>
                                    exportSingleModelEvaluationData(
                                        evaluation,
                                        evaluationScenarios,
                                        rows,
                                    )
                                }
                                disabled={false}
                            >
                                Export Results
                            </SecondaryButton>
                            <Button
                                type="default"
                                size="large"
                                onClick={() => setIsTestsetModalOpen(true)}
                                disabled={false}
                                data-cy="single-model-save-testset-button"
                            >
                                Save Testset
                            </Button>
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

            <SaveTestsetModal
                open={isTestsetModalOpen}
                onCancel={() => setIsTestsetModalOpen(false)}
                onSuccess={(testsetName: string) => {
                    message.success(`Row added to the "${testsetName}" test set!`)
                    setIsTestsetModalOpen(false)
                }}
                rows={rows}
                evaluation={evaluation}
            />

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
                    onVote={(id, score) => depouncedHandleScoreChange(id, score as number)}
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

export default SingleModelEvaluationTable
