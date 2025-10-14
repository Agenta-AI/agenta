// @ts-nocheck
import {useState, useEffect, useCallback, useMemo, useRef} from "react"

import SecondaryButton from "@agenta/oss/src/components/SecondaryButton/SecondaryButton"
import {Button, Card, Col, Input, Radio, Row, Space, Statistic, Table, message} from "antd"
import type {ColumnType} from "antd/es/table"
import {getDefaultStore, useAtomValue} from "jotai"
import debounce from "lodash/debounce"
import {useRouter} from "next/router"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {EvaluationFlow} from "@/oss/lib/enums"
import {exportABTestingEvaluationData} from "@/oss/lib/helpers/evaluate"
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
import {updateEvaluationScenario, updateEvaluation} from "@/oss/services/human-evaluations/api"
import {useEvaluationResults} from "@/oss/services/human-evaluations/hooks/useEvaluationResults"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {
    stablePromptVariablesAtomFamily,
    transformedPromptsAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {appUriInfoAtom, appSchemaAtom} from "@/oss/state/variant/atoms/fetcher"

import EvaluationCardView from "../Evaluations/EvaluationCardView"
import {VARIANT_COLORS} from "../Evaluations/EvaluationCardView/assets/styles"
import EvaluationVotePanel from "../Evaluations/EvaluationCardView/EvaluationVotePanel"
import VariantAlphabet from "../Evaluations/EvaluationCardView/VariantAlphabet"

import {useABTestingEvaluationTableStyles} from "./assets/styles"
import ParamsFormWithRun from "./components/ParamsFormWithRun"
import type {ABTestingEvaluationTableProps, ABTestingEvaluationTableRow} from "./types"

// Note: Avoid Typography.Title to prevent EllipsisMeasure/ResizeObserver loops

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
    const uriObject = useAtomValue(appUriInfoAtom)
    const store = getDefaultStore()
    const evalVariants = [...evaluation.variants]

    const {variants: data, isLoading: isVariantsLoading} = useStatelessVariants()

    // // Select the correct variant revisions for this evaluation
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

    const {numOfRows, flagVotes, positiveVotes, appVariant1Votes, appVariant2Votes} =
        useMemo(() => {
            const votesData = evaluationResults?.votes_data || {}
            const variantsVotesData = votesData.variants_votes_data || {}

            const [variant1, variant2] = evaluation.variants || []

            return {
                numOfRows: votesData.nb_of_rows || 0,
                flagVotes: votesData.flag_votes?.number_of_votes || 0,
                positiveVotes: votesData.positive_votes?.number_of_votes || 0,
                appVariant1Votes: variantsVotesData?.[variant1?.variantId]?.number_of_votes || 0,
                appVariant2Votes: variantsVotesData?.[variant2?.variantId]?.number_of_votes || 0,
            }
        }, [evaluationResults, evaluation.variants])

    const depouncedUpdateEvaluationScenario = useCallback(
        debounce((data: Partial<EvaluationScenario>, scenarioId) => {
            updateEvaluationScenarioData(scenarioId, data)
        }, 800),
        [],
    )

    useEffect(() => {
        if (evaluationScenarios) {
            setRows(() => {
                const obj = [...evaluationScenarios]
                const spec = store.get(appSchemaAtom) as any
                const routePath = uriObject?.routePath

                obj.forEach((item, rowIndex) => {
                    // Map outputs into row shape for table columns
                    item.outputs.forEach((op) => (item[op.variant_id] = op.variant_output))

                    try {
                        // Build a stable input name set from variants (schema for custom, stable prompts otherwise)
                        const names = new Set<string>()
                        ;(variantData || []).forEach((v: any) => {
                            const rid = v?.id
                            if (!rid) return
                            const flags = store.get(
                                variantFlagsAtomFamily({revisionId: rid}),
                            ) as any
                            if (flags?.isCustom && spec) {
                                extractInputKeysFromSchema(spec as any, routePath).forEach((k) =>
                                    names.add(k),
                                )
                            } else {
                                const vars = store.get(
                                    stablePromptVariablesAtomFamily(rid),
                                ) as string[]
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
                        // best-effort prepopulation only
                    }
                })

                return obj
            })
        }
    }, [evaluationScenarios, variantData, uriObject?.routePath, evaluation?.testset?.csvdata])

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>, id: string, inputIndex: number) => {
            setRows((oldRows) => {
                const rowIndex = oldRows.findIndex((row) => row.id === id)
                const newRows = [...oldRows]
                if (newRows[rowIndex] && newRows[rowIndex].inputs?.[inputIndex]) {
                    newRows[rowIndex].inputs[inputIndex].input_value = e.target.value
                }
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

    // Upsert a single input value into a row by scenario id
    const upsertRowInput = useCallback((rowId: string, name: string, value: any) => {
        setRows((old) => {
            const idx = old.findIndex((r) => r.id === rowId)
            if (idx === -1) return old
            const next = [...old]
            const row = {...next[idx]}
            const inputs = Array.isArray(row.inputs) ? [...row.inputs] : []
            const pos = inputs.findIndex((ip) => ip.input_name === name)
            if (pos === -1) {
                inputs.push({input_name: name, input_value: value})
            } else if (inputs[pos]?.input_value !== value) {
                inputs[pos] = {...inputs[pos], input_value: value}
            }
            row.inputs = inputs
            next[idx] = row as any
            return next
        })
    }, [])

    const updateEvaluationScenarioData = useCallback(
        async (id: string, data: Partial<EvaluationScenario>, showNotification = true) => {
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
                    setRows((prev) => {
                        const next = [...prev]
                        const idx = next.findIndex((r) => r.id === id)
                        if (idx >= 0) {
                            Object.keys(data).forEach((key) => {
                                // @ts-ignore
                                next[idx][key] = data[key as keyof EvaluationScenario] as any
                            })
                        }
                        return next
                    })
                    if (showNotification) message.success("Evaluation Updated!")
                })
                .catch(console.error)
        },
        [evaluation.evaluationType, evaluation.id],
    )

    const handleVoteClick = useCallback(
        async (id: string, vote: string) => {
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
                await updateEvaluationScenarioData(evaluation_scenario_id, data)
                await mutate()
            }
        },
        [rows, setRowValue, updateEvaluationScenarioData, evalVariants],
    )

    // Keep stable refs to callback handlers to avoid re-creating table columns
    // Initialize with no-ops to avoid TDZ when functions are declared below
    const runEvaluationRef = useRef<
        (id: string, count?: number, showNotification?: boolean) => void
    >(() => {})
    const handleInputChangeRef = useRef<
        (e: React.ChangeEvent<HTMLTextAreaElement>, id: string, inputIndex: number) => void
    >(() => {})
    const handleVoteClickRef = useRef<(id: string, vote: string) => void>(() => {})
    // // Note: assign .current values after handlers are defined (see below)

    const runEvaluation = useCallback(
        async (id: string, count = 1, showNotification = true) => {
            const _variantData = variantData
            const rowIndex = rows.findIndex((row) => row.id === id)
            const testRow = evaluation?.testset?.csvdata?.[rowIndex] || {}

            // Derive request schema once
            const spec = store.get(appSchemaAtom) as any
            const routePath = uriObject?.routePath
            const requestSchema: any = spec ? getRequestSchema(spec as any, {routePath}) : undefined
            const hasMessagesProp = Boolean(requestSchema?.properties?.messages)

            const outputs = rows[rowIndex].outputs.reduce(
                (acc, op) => ({...acc, [op.variant_id]: op.variant_output}),
                {},
            )

            await Promise.all(
                evalVariants.map(async (variant: Variant, idx: number) => {
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
                        // Build stable optional parameters using atom-based prompts (stable params)
                        const revisionId = _variantData?.[idx]?.id as string | undefined
                        const flags = revisionId
                            ? (store.get(variantFlagsAtomFamily({revisionId})) as any)
                            : undefined
                        const isCustom = Boolean(flags?.isCustom)
                        // Determine effective input keys per variant
                        const schemaKeys = spec
                            ? extractInputKeysFromSchema(spec as any, routePath)
                            : []
                        const stableFromParams: string[] = (() => {
                            try {
                                const params = (_variantData[idx] as any)?.parameters
                                const ag = params?.ag_config ?? params ?? {}
                                const s = new Set<string>()
                                Object.values(ag || {}).forEach((cfg: any) => {
                                    const arr = cfg?.input_keys
                                    if (Array.isArray(arr)) {
                                        arr.forEach((k) => {
                                            if (typeof k === "string" && k) s.add(k)
                                        })
                                    }
                                })
                                return Array.from(s)
                            } catch {
                                return []
                            }
                        })()

                        console.log("stableFromParams", stableFromParams)
                        // Also include stable variables derived from saved prompts (handles cases where input_keys are not explicitly listed)
                        const stableFromPrompts: string[] = revisionId
                            ? (store.get(stablePromptVariablesAtomFamily(revisionId)) as string[])
                            : []
                        const effectiveKeys = isCustom
                            ? schemaKeys
                            : Array.from(
                                  new Set([
                                      ...(stableFromParams || []),
                                      ...(stableFromPrompts || []),
                                  ]),
                              ).filter((k) => typeof k === "string" && k && k !== "chat")

                        // Build input params strictly from effective keys using testcase (with row overrides)
                        let inputParamsDict: Record<string, any> = {}
                        if (Array.isArray(effectiveKeys) && effectiveKeys.length > 0) {
                            effectiveKeys.forEach((key) => {
                                const fromRowInput = rows[rowIndex]?.inputs?.find(
                                    (ip) => ip.input_name === key,
                                )?.input_value
                                const fromTestcase = (testRow as any)?.[key]
                                if (fromRowInput !== undefined) inputParamsDict[key] = fromRowInput
                                else if (fromTestcase !== undefined)
                                    inputParamsDict[key] = fromTestcase
                            })
                        } else {
                            // Fallback: preserve previous behavior if keys unavailable
                            inputParamsDict = rows[rowIndex].inputs.reduce(
                                (acc: Record<string, any>, item) => {
                                    acc[item.input_name] = item.input_value
                                    return acc
                                },
                                {},
                            )
                        }
                        // Fallback: if chat testset, hydrate from test row keys as needed
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
                            (_variantData[idx]?.parameters
                                ? transformToRequestBody({
                                      variant: _variantData[idx],
                                      allMetadata: getAllMetadata(),
                                      prompts:
                                          spec && _variantData[idx]
                                              ? derivePromptsFromSpec(
                                                    _variantData[idx] as any,
                                                    spec as any,
                                                    uriObject?.routePath,
                                                ) || []
                                              : [],
                                      // Keep request shape aligned with OpenAPI schema
                                      isChat: hasMessagesProp,
                                      isCustom,
                                      customProperties: undefined,
                                  })
                                : (_variantData[idx]?.promptOptParams as any))
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
                            _variantData[idx].baseId || "",
                            sanitizedMessages,
                            undefined,
                            true,
                            !!_variantData[idx]._parentVariant, // isNewVariant (new arch if parent exists)
                            isCustom,
                            uriObject,
                            _variantData[idx].variantId,
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

                        const _result = getStringOrJson(res.data)

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
        },
        [
            variantData,
            rows,
            evalVariants,
            updateEvaluationScenarioData,
            setRowValue,
            appId,
            evaluation.testset.csvdata,
        ],
    )

    // Now that handlers are declared, update stable refs
    useEffect(() => {
        runEvaluationRef.current = runEvaluation
        handleInputChangeRef.current = handleInputChange
        handleVoteClickRef.current = handleVoteClick
    }, [runEvaluation, handleInputChange, handleVoteClick])

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
                    render: (text: any, record: ABTestingEvaluationTableRow) => {
                        const value =
                            text ||
                            record?.[columnKey] ||
                            record.outputs?.find((o: any) => o.variant_id === columnKey)
                                ?.variant_output ||
                            ""
                        return (
                            <div className="max-w-[350px] max-h-[350px] overflow-y-auto">
                                {value}
                            </div>
                        )
                    },
                }
            }),
        [evalVariants, evaluation.revisions],
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
                            onRun={() => runEvaluationRef.current(record.id!)}
                            onParamChange={(name, value) => upsertRowInput(record.id!, name, value)}
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
                                    type="comparison"
                                    value={record.vote || ""}
                                    variants={evalVariants}
                                    onChange={(vote) => handleVoteClickRef.current(record.id, vote)}
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
    }, [
        isVariantsLoading,
        evaluation.testset.name,
        classes.inputTestContainer,
        classes.inputTest,
        dynamicColumns,
        evalVariants,
    ])

    return (
        <div>
            <h2 style={{fontSize: 24, margin: 0}}>{EvaluationTypeLabels.human_a_b_testing}</h2>
            <div>
                <Row align="middle">
                    <Col span={12}>
                        <Space>
                            <Button type="primary" onClick={runAllEvaluations} size="large">
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
                        <Card variant="outlined" className={classes.card}>
                            <Row justify="end">
                                <Col span={10}>
                                    <Statistic
                                        title={`${
                                            evaluation.variants[0]?.variantName || ""
                                        } is better:`}
                                        value={`${appVariant1Votes} out of ${numOfRows}`}
                                        className={classes.stat}
                                    />
                                </Col>
                                <Col span={10}>
                                    <Statistic
                                        title={`${
                                            evaluation.variants[1]?.variantName || ""
                                        } is better:`}
                                        value={`${appVariant2Votes} out of ${numOfRows}`}
                                        className={classes.stat}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Statistic
                                        title="Both are good:"
                                        value={`${positiveVotes} out of ${numOfRows}`}
                                        className={classes.statCorrect}
                                    />
                                </Col>
                                <Col span={4}>
                                    <Statistic
                                        title="Both are bad:"
                                        value={`${flagVotes} out of ${numOfRows}`}
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
