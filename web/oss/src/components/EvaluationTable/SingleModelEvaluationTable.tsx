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
import {getDefaultStore, useAtomValue} from "jotai"
import debounce from "lodash/debounce"
import {useRouter} from "next/router"

import SaveTestsetModal from "@/oss/components/SaveTestsetModal/SaveTestsetModal"
import SecondaryButton from "@/oss/components/SecondaryButton/SecondaryButton"
import {EvaluationFlow} from "@/oss/lib/enums"
import {exportSingleModelEvaluationData} from "@/oss/lib/evaluations/legacy"
import {isBaseResponse, isFuncResponse} from "@/oss/lib/helpers/playgroundResp"
import {testsetRowToChatMessages} from "@/oss/lib/helpers/testset"
import {
    EvaluationTypeLabels,
    batchExecute,
    camelToSnake,
    getStringOrJson,
} from "@/oss/lib/helpers/utils"
import {variantNameWithRev} from "@/oss/lib/helpers/variantHelper"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {getRequestSchema} from "@/oss/lib/shared/variant/openapiUtils"
import {derivePromptsFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {BaseResponse, EvaluationScenario, KeyValuePair, Variant} from "@/oss/lib/Types"
import {callVariant} from "@/oss/services/api"
import {updateEvaluation, updateEvaluationScenario} from "@/oss/services/human-evaluations/api"
import {useQueryParamState} from "@/oss/state/appState"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {
    stablePromptVariablesAtomFamily,
    transformedPromptsAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {appUriInfoAtom, appSchemaAtom} from "@/oss/state/variant/atoms/fetcher"

import EvaluationCardView from "../Evaluations/EvaluationCardView"
import EvaluationVotePanel from "../Evaluations/EvaluationCardView/EvaluationVotePanel"

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
    const uriObject = useAtomValue(appUriInfoAtom)
    const store = getDefaultStore()
    const variants = evaluation.variants

    const {variants: data, isLoading: isVariantsLoading} = useStatelessVariants()

    // Select the correct variant revisions for this evaluation
    const variantData = useMemo(() => {
        const allVariantData = data || []
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
    }, [data, evaluation.variants, evaluation.variant_revision_ids, evaluation.revisions])

    const [rows, setRows] = useState<SingleModelEvaluationRow[]>([])
    const [evaluationStatus, setEvaluationStatus] = useState<EvaluationFlow>(evaluation.status)
    const [viewModeParam, setViewModeParam] = useQueryParamState("viewMode")
    const viewMode = useMemo(() => {
        if (Array.isArray(viewModeParam)) {
            return viewModeParam[0] ?? "card"
        }
        if (typeof viewModeParam === "string" && viewModeParam) {
            return viewModeParam
        }
        return "card"
    }, [viewModeParam])
    const setViewMode = useCallback(
        (nextMode: string) => {
            setViewModeParam(nextMode, {method: "replace", shallow: true})
        },
        [setViewModeParam],
    )
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
            const spec = store.get(appSchemaAtom) as any
            const routePath = uriObject?.routePath

            obj.forEach((item, rowIndex) => {
                // Map outputs into row shape for table columns
                item.outputs.forEach((op) => (item[op.variant_id] = op.variant_output))

                try {
                    const names = new Set<string>()
                    ;(variantData || []).forEach((v: any) => {
                        const rid = v?.id
                        if (!rid) return
                        const flags = store.get(variantFlagsAtomFamily({revisionId: rid})) as any
                        if (flags?.isCustom && spec) {
                            extractInputKeysFromSchema(spec as any, routePath).forEach((k) =>
                                names.add(k),
                            )
                        } else {
                            const vars = store.get(stablePromptVariablesAtomFamily(rid)) as string[]
                            ;(vars || []).forEach((k) => names.add(k))
                        }
                    })

                    const chatCol = evaluation?.testset?.testsetChatColumn || ""
                    const reserved = new Set(["correct_answer", chatCol])
                    const testRow = evaluation?.testset?.csvdata?.[rowIndex] || {}

                    const existing = new Set(
                        (Array.isArray(item.inputs) ? item.inputs : [])
                            .map((ip: any) => ip?.input_name)
                            .filter(Boolean),
                    )

                    const nextInputs = Array.isArray(item.inputs) ? [...item.inputs] : []
                    Array.from(names)
                        .filter((k) => typeof k === "string" && k && !reserved.has(k))
                        .forEach((k) => {
                            if (!existing.has(k)) {
                                nextInputs.push({
                                    input_name: k,
                                    input_value: (testRow as any)?.[k] ?? "",
                                })
                            }
                        })
                    item.inputs = nextInputs
                } catch {
                    // best-effort only
                }
            })

            setRows(obj)
        }
    }, [evaluationScenarios, variantData])

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
        // Build input params from stable effective keys: schema keys for custom; stable prompt variables/parameters for non-custom
        const testRow = evaluation?.testset?.csvdata?.[rowIndex] || {}
        const spec = store.get(appSchemaAtom) as any
        const routePath = uriObject?.routePath
        const requestSchema: any = spec ? getRequestSchema(spec as any, {routePath}) : undefined
        const hasMessagesProp = Boolean(requestSchema?.properties?.messages)

        const effectiveKeysForVariant = (idx: number): string[] => {
            const v = variantData?.[idx] as any
            const rid = v?.id
            const flags = rid ? (store.get(variantFlagsAtomFamily({revisionId: rid})) as any) : null
            const isCustom = Boolean(flags?.isCustom)
            if (isCustom) {
                return spec ? extractInputKeysFromSchema(spec as any, routePath) : []
            }
            // Union of saved parameters input_keys and stable prompt variables
            const fromParams: string[] = (() => {
                try {
                    const params = v?.parameters
                    const ag = params?.ag_config ?? params ?? {}
                    const s = new Set<string>()
                    Object.values(ag || {}).forEach((cfg: any) => {
                        const arr = cfg?.input_keys
                        if (Array.isArray(arr))
                            arr.forEach((k) => typeof k === "string" && s.add(k))
                    })
                    return Array.from(s)
                } catch {
                    return []
                }
            })()
            const fromPrompts: string[] = rid
                ? (store.get(stablePromptVariablesAtomFamily(rid)) as string[]) || []
                : []
            return Array.from(new Set([...(fromParams || []), ...(fromPrompts || [])])).filter(
                (k) => k && k !== (evaluation?.testset?.testsetChatColumn || ""),
            )
        }

        let inputParamsDict: Record<string, any> = {}
        const keys = effectiveKeysForVariant(0) // single model uses one variant for inputs shape
        if (Array.isArray(keys) && keys.length > 0) {
            keys.forEach((key) => {
                const fromScenario = rows[rowIndex]?.inputs?.find(
                    (ip) => ip.input_name === key,
                )?.input_value
                const fromTestcase = (testRow as any)?.[key]
                if (fromScenario !== undefined) inputParamsDict[key] = fromScenario
                else if (fromTestcase !== undefined) inputParamsDict[key] = fromTestcase
            })
        } else {
            // Fallback to backend-provided inputs
            inputParamsDict = rows[rowIndex].inputs.reduce((acc: Record<string, any>, item) => {
                acc[item.input_name] = item.input_value
                return acc
            }, {})
        }

        const outputs = rows[rowIndex].outputs.reduce(
            (acc, op) => ({...acc, [op.variant_id]: op.variant_output}),
            {},
        )
        await Promise.all(
            variants.map(async (variant: Variant, idx: number) => {
                setRowValue(rowIndex, variant.variantId, "loading...")

                const isChatTestset = !!evaluation?.testset?.testsetChatColumn
                const rawMessages = isChatTestset
                    ? testsetRowToChatMessages(evaluation.testset.csvdata[rowIndex], false)
                    : []

                const sanitizedMessages = rawMessages.map((msg) => {
                    if (!Array.isArray(msg.content)) return msg
                    return {
                        ...msg,
                        content: msg.content.filter((part) => {
                            return part.type !== "image_url" || part.image_url.url.trim() !== ""
                        }),
                    }
                })

                try {
                    const revisionId = variantData?.[idx]?.id as string | undefined
                    const flags = revisionId
                        ? (store.get(variantFlagsAtomFamily({revisionId})) as any)
                        : undefined
                    const isCustom = Boolean(flags?.isCustom)
                    // Recompute effective keys for this variant index
                    const vKeys = effectiveKeysForVariant(idx)
                    if (Array.isArray(vKeys) && vKeys.length > 0) {
                        vKeys.forEach((key) => {
                            if (!(key in inputParamsDict)) {
                                const v = (testRow as any)?.[key]
                                if (v !== undefined) inputParamsDict[key] = v
                            }
                        })
                    }
                    if (isChatTestset) {
                        const testRow = evaluation?.testset?.csvdata?.[rowIndex] || {}
                        const reserved = new Set([
                            "correct_answer",
                            evaluation?.testset?.testsetChatColumn || "",
                        ])
                        Object.keys(testRow)
                            .filter((k) => !reserved.has(k))
                            .forEach((k) => {
                                if (!(k in inputParamsDict))
                                    inputParamsDict[k] = (testRow as any)[k]
                            })
                    }

                    // Prefer stable transformed parameters (saved revision + schema)
                    const stableOptional = revisionId
                        ? store.get(
                              transformedPromptsAtomFamily({
                                  revisionId,
                                  useStableParams: true,
                              }),
                          )
                        : undefined
                    const optionalParameters =
                        stableOptional ||
                        (variantData[idx]?.parameters
                            ? transformToRequestBody({
                                  variant: variantData[idx],
                                  allMetadata: getAllMetadata(),
                                  prompts:
                                      spec && variantData[idx]
                                          ? derivePromptsFromSpec(
                                                variantData[idx] as any,
                                                spec as any,
                                                uriObject?.routePath,
                                            ) || []
                                          : [],
                                  // Keep request shape aligned with OpenAPI schema
                                  isChat: hasMessagesProp,
                                  isCustom,
                                  // stableOptional already includes custom props; fallback path keeps schema-aligned custom props
                                  customProperties: undefined,
                              })
                            : (variantData[idx]?.promptOptParams as any))

                    // For new arch, variable inputs must live under requestBody.inputs
                    // Mark them as non-"input" so callVariant places them under "inputs"
                    const synthesizedParamDef = Object.keys(inputParamsDict).map((name) => ({
                        name,
                        input: false,
                    })) as any

                    const result = await callVariant(
                        inputParamsDict,
                        synthesizedParamDef,
                        optionalParameters,
                        appId || "",
                        variantData[idx].baseId || "",
                        sanitizedMessages,
                        undefined,
                        true,
                        !!variantData[idx]._parentVariant, // isNewVariant
                        isCustom,
                        uriObject,
                        variantData[idx].variantId,
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
                    let outputValue = text
                    if (!outputValue && record.outputs && record.outputs.length > 0) {
                        outputValue = record.outputs.find(
                            (output: any) => output.variant_id === columnKey,
                        )?.variant_output
                    }
                    return (
                        <div className="max-w-[350px] max-h-[350px] overflow-y-auto">
                            {outputValue}
                        </div>
                    )
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
                        <span> Inputs (Testset: </span>
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
                            <Button type="primary" onClick={runAllEvaluations} size="large">
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
                    message.success(`Row added to the "${testsetName}" testset!`)
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
