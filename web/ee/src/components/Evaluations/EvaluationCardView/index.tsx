// @ts-nocheck
import {useCallback, useEffect, useMemo, useRef} from "react"

import {
    LeftOutlined,
    LoadingOutlined,
    PlayCircleOutlined,
    QuestionCircleOutlined,
    RightOutlined,
} from "@ant-design/icons"
import {Button, Empty, Form, Input, Result, Space, Tooltip, Typography, theme} from "antd"
import {atom, useAtomValue} from "jotai"
import debounce from "lodash/debounce"
import {useLocalStorage} from "usehooks-ts"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import ParamsForm from "@/oss/components/ParamsForm"
import {useQueryParamState} from "@/oss/state/appState"
import {EvaluationType} from "@/oss/lib/enums"
import {testsetRowToChatMessages} from "@/oss/lib/helpers/testset"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import type {ChatMessage, EvaluationScenario} from "@/oss/lib/Types"
import {inputParamsAtomFamily} from "@/oss/state/newPlayground/core/inputParams"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {useStyles} from "./assets/styles"
import EvaluationCard from "./EvaluationCard"
import EvaluationVotePanel from "./EvaluationVotePanel"
import type {EvaluationCardViewProps} from "./types"

const EvaluationCardView: React.FC<EvaluationCardViewProps> = ({
    variants,
    evaluationScenarios,
    onRun,
    onVote,
    onInputChange,
    updateEvaluationScenarioData,
    evaluation,
    variantData = [],
    isLoading,
}) => {
    const classes = useStyles()
    const {token} = theme.useToken()
    const [evaluationsState, setEvaluationsState] = useLocalStorage<
        Record<string, {lastVisitedScenario: string}>
    >("evaluationsState", {})

    const [scenarioParam, setScenarioParam] = useQueryParamState("evaluationScenario")
    const fallbackScenarioId = useMemo(() => {
        return (
            evaluationsState[evaluation.id]?.lastVisitedScenario || evaluationScenarios[0]?.id || ""
        )
    }, [evaluation.id, evaluationScenarios, evaluationsState])
    const scenarioId = useMemo(() => {
        if (Array.isArray(scenarioParam)) {
            return scenarioParam[0] || fallbackScenarioId
        }
        if (typeof scenarioParam === "string" && scenarioParam) {
            return scenarioParam
        }
        return fallbackScenarioId
    }, [scenarioParam, fallbackScenarioId])
    const setScenarioId = useCallback(
        (nextId: string) => {
            if (!nextId) return
            setScenarioParam(nextId, {method: "replace", shallow: true})
        },
        [setScenarioParam],
    )

    const [instructionsShown, setInstructionsShown] = useLocalStorage(
        "evalInstructionsShown",
        false,
    )
    const {scenario, scenarioIndex} = useMemo(() => {
        const scenarioIndex = evaluationScenarios.findIndex(
            (scenario) => scenario.id === scenarioId,
        )
        return {scenario: evaluationScenarios[scenarioIndex], scenarioIndex}
    }, [scenarioId, evaluationScenarios])

    useEffect(() => {
        setEvaluationsState((prevEvaluationsState) => ({
            ...prevEvaluationsState,
            [evaluation.id]: {
                ...(prevEvaluationsState[evaluation.id] || {}),
                lastVisitedScenario: scenarioId,
            },
        }))
    }, [scenarioId])

    const rootRef = useRef<HTMLDivElement>(null)
    const opened = useRef(false)
    const callbacks = useRef({
        onVote,
        onRun,
        onInputChange,
    })
    const isChat = !!evaluation.testset.testsetChatColumn
    const testsetRow = evaluation.testset.csvdata[scenarioIndex]
    const isAbTesting = evaluation.evaluationType === EvaluationType.human_a_b_testing
    const [form] = Form.useForm()
    const {_variants: _allStatelessVariants} = useStatelessVariants() as any

    const loadPrevious = () => {
        if (scenarioIndex === 0) return
        setScenarioId(evaluationScenarios[scenarioIndex - 1].id)
    }

    const loadNext = () => {
        if (scenarioIndex === evaluationScenarios.length - 1) return
        setScenarioId(evaluationScenarios[scenarioIndex + 1].id)
    }

    const showInstructions = useCallback(() => {
        if (opened.current) return

        opened.current = true
        AlertPopup({
            title: "Instructions",
            type: "info",
            message: (
                <ol className={classes.instructions}>
                    <li>
                        Use the buttons <b>Next</b> and <b>Prev</b> or the arrow keys{" "}
                        <code>{`Left (<)`}</code> and <code>{`Right (>)`}</code> to navigate between
                        evaluations.
                    </li>
                    <li>
                        Click the <b>Run</b>{" "}
                        <PlayCircleOutlined style={{color: token.colorSuccessActive}} /> button on
                        right or press <code>{`Enter (↵)`}</code> key to generate the variants'
                        outputs.
                    </li>
                    {isAbTesting && (
                        <li>
                            <b>Vote</b> by either clicking the evaluation buttons at the right
                            sidebar or pressing the key <code>a</code> for 1st Variant,{" "}
                            <code>b</code> for 2nd Variant and <code>x</code> if both are bad.
                        </li>
                    )}
                    <li>
                        Add a note to an evaluation from the <b>Additional Notes</b> input section{" "}
                        in the right sidebar.
                    </li>
                </ol>
            ),
            okText: <span>Ok</span>,
            cancelText: null,
            width: 500,
            onCancel: () => (opened.current = false),
            onOk: () => (opened.current = false),
        })
    }, [])

    const depouncedUpdateEvaluationScenario = useCallback(
        debounce((data: Partial<EvaluationScenario>) => {
            updateEvaluationScenarioData(scenarioId, data)
        }, 800),
        [scenarioId],
    )

    const onChatChange = (chat: ChatMessage[]) => {
        const stringified = JSON.stringify(chat)
        testsetRow[evaluation.testset.testsetChatColumn] = stringified

        depouncedUpdateEvaluationScenario({
            inputs: [
                {input_name: "chat", input_value: stringified},
                ...scenario.inputs.filter(
                    (ip: {input_name: string; input_value: string}) => ip.input_name !== "chat",
                ),
            ],
            [evaluation.testset.testsetChatColumn]: stringified,
        })
    }

    //hack to always get the latest callbacks using ref
    useEffect(() => {
        callbacks.current = {onVote, onRun, onInputChange}
    }, [onVote, onRun, onInputChange])

    // focus the root element on mount
    useEffect(() => {
        if (rootRef.current) {
            rootRef.current.focus()
        }
    }, [])

    useEffect(() => {
        if (!instructionsShown) {
            showInstructions()
            setInstructionsShown(true)
        }
    }, [instructionsShown])

    useEffect(() => {
        if (typeof window === "undefined") return () => {}

        const listener = (e: KeyboardEvent) => {
            if (document.activeElement !== rootRef.current) return
            if (e.key === "ArrowLeft") loadPrevious()
            else if (e.key === "ArrowRight") loadNext()
            else if (e.key === "Enter") callbacks.current.onRun(scenarioId)

            if (isAbTesting) {
                if (e.key === "a") callbacks.current.onVote(scenarioId, variants[0].variantId)
                else if (e.key === "b") callbacks.current.onVote(scenarioId, variants[1].variantId)
                else if (e.key === "x") callbacks.current.onVote(scenarioId, "0")
            }
        }

        document.addEventListener("keydown", listener)
        return () => document.removeEventListener("keydown", listener)
    }, [scenarioIndex])

    useEffect(() => {
        if (scenario) {
            const chatStr = scenario?.inputs.find(
                (ip: {input_name: string; input_value: string}) => ip.input_name === "chat",
            )?.input_value
            if (chatStr) testsetRow[evaluation.testset.testsetChatColumn] = chatStr
        }
    }, [scenario])

    const correctAnswer = useMemo(() => {
        if (scenario?.correctAnswer) return scenario.correctAnswer
        const res = testsetRow?.correct_answer
        return res || ""
    }, [testsetRow?.correct_answer, scenario?.correctAnswer])

    const chat = useMemo(() => {
        const fromInput = scenario?.inputs.find(
            (ip: {input_name: string; input_value: string}) => ip.input_name === "chat",
        )?.input_value
        if (!isChat) return []

        return testsetRowToChatMessages(
            fromInput
                ? {chat: fromInput, correct_answer: testsetRow?.correct_answer}
                : testsetRow || {},
            false,
        )
    }, [scenarioIndex])

    const routePath = useAtomValue(appUriInfoAtom)?.routePath
    const selectedRevisionId = (variantData?.[0] as any)?.id as string | undefined
    const hasRevision = Boolean(variantData?.[0] && selectedRevisionId)
    const inputParamsSelector = useMemo(
        () =>
            (hasRevision && routePath
                ? inputParamsAtomFamily({variant: variantData[0] as any, routePath})
                : atom<any[]>([])) as any,
        [hasRevision ? (variantData?.[0] as any)?.id : undefined, routePath],
    )
    const baseInputParams = useAtomValue(inputParamsSelector) as any[]
    // // Stable variables derived from saved prompts (spec + saved parameters; no live mutations)
    const variableNames = useAtomValue(
        hasRevision ? (stablePromptVariablesAtomFamily(selectedRevisionId!) as any) : atom([]),
    ) as string[]
    // Avoid creating new atoms during render to prevent infinite update loops
    const emptyObjAtom = useMemo(() => atom({}), [])
    const stableFlagsParam = useMemo(
        () => (selectedRevisionId ? {revisionId: selectedRevisionId} : undefined),
        [selectedRevisionId],
    )
    const flags = useAtomValue(
        hasRevision && stableFlagsParam
            ? (variantFlagsAtomFamily(stableFlagsParam) as any)
            : (emptyObjAtom as any),
    ) as any

    const derivedInputParams = useMemo(() => {
        const haveSchemaParams = Array.isArray(baseInputParams) && baseInputParams.length > 0

        // Determine candidate field names
        let sourceParams: any[] = []
        if (haveSchemaParams) {
            sourceParams = baseInputParams
        } else if (Array.isArray(scenario?.inputs) && scenario.inputs.length > 0) {
            sourceParams = scenario.inputs
                .filter((ip: any) => (isChat ? ip.input_name !== "chat" : true))
                .map((ip: any) => ({name: ip.input_name, type: "string"}))
        } else {
            const reserved = new Set([
                "correct_answer",
                evaluation?.testset?.testsetChatColumn || "",
            ])
            const row = testsetRow || {}
            sourceParams = Object.keys(row)
                .filter((k) => !reserved.has(k))
                .map((k) => ({name: k, type: "string"}))
        }
        // Display only stable inputs: filter to stable variable names for non-custom apps
        // For chat apps, exclude the reserved "chat" key (handled separately below).
        if (!flags?.isCustom && Array.isArray(variableNames) && variableNames.length > 0) {
            const allow = new Set(variableNames.filter((name) => (isChat ? name !== "chat" : true)))
            sourceParams = (sourceParams || []).filter((p: any) => allow.has(p?.name))
        }

        const withValues = (sourceParams || []).map((item: any) => {
            const fromScenario = scenario?.inputs.find(
                (ip: {input_name: string; input_value: string}) => ip.input_name === item.name,
            )?.input_value
            const fromRow = (testsetRow as any)?.[item.name]
            return {
                ...item,
                value: fromScenario ?? fromRow ?? "",
            }
        })

        if (isChat) {
            return [...withValues, {name: "chat", type: "string", value: chat}]
        }
        return withValues
    }, [
        baseInputParams,
        scenario?.inputs,
        isChat,
        chat,
        evaluation?.testset?.testsetChatColumn,
        testsetRow,
        variableNames,
        flags?.isCustom,
    ])

    const handleRun = useCallback(async () => {
        try {
            // Persist current derived inputs into scenario if missing, so runner sees them
            const nextInputs = (derivedInputParams || [])
                .filter((p: any) => p.name !== "chat")
                .map((p: any) => ({input_name: p.name, input_value: p.value ?? ""}))

            if (Array.isArray(nextInputs) && nextInputs.length > 0) {
                await updateEvaluationScenarioData(scenarioId, {inputs: nextInputs})
            }
        } catch (e) {
            console.warn("[EvaluationCardView] failed to persist inputs before run", e)
        }
        onRun(scenarioId)
    }, [derivedInputParams, scenarioId, onRun, updateEvaluationScenarioData])

    return (
        <div className={classes.root} tabIndex={1} ref={rootRef}>
            {isLoading ? (
                <Result className={classes.centeredItem} icon={<LoadingOutlined />} />
            ) : scenario ? (
                <>
                    <div className={classes.evaluation}>
                        <div className={classes.heading}>
                            <Button
                                icon={<LeftOutlined />}
                                disabled={scenarioIndex === 0}
                                onClick={loadPrevious}
                            >
                                Prev
                            </Button>
                            <h2 style={{fontSize: 24, margin: 0}}>
                                Evaluation: {scenarioIndex + 1}/{evaluationScenarios.length}
                            </h2>
                            <Button
                                disabled={scenarioIndex === evaluationScenarios.length - 1}
                                onClick={loadNext}
                            >
                                <Space>
                                    Next
                                    <RightOutlined />
                                </Space>
                            </Button>
                        </div>

                        <div>
                            <Typography.Text style={{fontSize: 20}}>Inputs</Typography.Text>
                            {derivedInputParams.length > 0 || isChat ? (
                                <ParamsForm
                                    isChatVariant={isChat}
                                    onParamChange={(name, value) => {
                                        if (isChat && name === "chat") return onChatChange(value)
                                        const idx =
                                            scenario?.inputs?.findIndex(
                                                (ip: any) => ip.input_name === name,
                                            ) ?? -1
                                        if (idx === -1) {
                                            // If the input key does not exist yet (cold load fallback), persist it
                                            const nextInputs = [
                                                {input_name: name, input_value: value},
                                                ...((scenario?.inputs || []).filter(
                                                    (ip: any) => ip.input_name !== name,
                                                ) as any[]),
                                            ]
                                            updateEvaluationScenarioData(scenarioId, {
                                                inputs: nextInputs as any,
                                            })
                                        } else {
                                            onInputChange({target: {value}} as any, scenarioId, idx)
                                        }
                                    }}
                                    inputParams={derivedInputParams}
                                    key={`${scenarioId}-${(variantData?.[0] as any)?.id || ""}`}
                                    useChatDefaultValue
                                    form={form}
                                    onFinish={handleRun}
                                    imageSize="large"
                                />
                            ) : null}
                        </div>

                        <div className={classes.toolBar}>
                            <Tooltip title="Instructions">
                                <QuestionCircleOutlined
                                    onClick={showInstructions}
                                    style={{fontSize: 24}}
                                />
                            </Tooltip>
                            <Tooltip title="Run (Enter ↵)">
                                <PlayCircleOutlined
                                    style={{color: token.colorSuccessActive, fontSize: 24}}
                                    onClick={isChat ? () => onRun(scenarioId) : form.submit}
                                />
                            </Tooltip>
                        </div>

                        <div>
                            <div style={{marginBottom: "1rem"}}>
                                {!isAbTesting ? (
                                    <Typography.Text style={{fontSize: 20}}>
                                        Model Response
                                    </Typography.Text>
                                ) : (
                                    <Typography.Text style={{fontSize: 20}}>
                                        Outputs
                                    </Typography.Text>
                                )}
                            </div>

                            <EvaluationCard
                                isChat={isChat}
                                variants={variants}
                                evaluationScenario={scenario}
                                showVariantName={isAbTesting}
                                evaluation={evaluation}
                            />
                        </div>
                    </div>

                    <div className={classes.sideBar}>
                        <h4 style={{fontSize: 18, margin: 0}}>Submit your feedback</h4>
                        {scenario.outputs.length > 0 &&
                            scenario.outputs.every((item) => !!item.variant_output) && (
                                <Space direction="vertical">
                                    <Typography.Text strong>
                                        {isAbTesting
                                            ? "Which response is better?"
                                            : "Rate the response"}
                                    </Typography.Text>
                                    {isAbTesting ? (
                                        <EvaluationVotePanel
                                            type="comparison"
                                            value={scenario.vote || ""}
                                            variants={variants}
                                            onChange={(vote) => onVote(scenarioId, vote)}
                                            loading={scenario.vote === "loading"}
                                            vertical
                                            key={scenarioId}
                                            outputs={scenario.outputs}
                                        />
                                    ) : (
                                        <EvaluationVotePanel
                                            type="rating"
                                            value={[
                                                {
                                                    variantId: variants[0].variantId,
                                                    score: scenario.score as number,
                                                },
                                            ]}
                                            variants={variants}
                                            onChange={(val) => onVote(scenarioId, val[0].score)}
                                            loading={scenario.score === "loading"}
                                            showVariantName={false}
                                            key={scenarioId}
                                            outputs={scenario.outputs}
                                        />
                                    )}
                                </Space>
                            )}

                        <Space direction="vertical">
                            <Typography.Text strong>Expected Answer</Typography.Text>
                            <Input.TextArea
                                defaultValue={correctAnswer}
                                autoSize={{minRows: 3, maxRows: 5}}
                                onChange={(e) =>
                                    depouncedUpdateEvaluationScenario({
                                        correctAnswer: e.target.value,
                                    })
                                }
                                key={scenarioId}
                            />
                        </Space>

                        <Space direction="vertical">
                            <Typography.Text strong>Additional Notes</Typography.Text>
                            <Input.TextArea
                                defaultValue={scenario?.note || ""}
                                autoSize={{minRows: 3, maxRows: 5}}
                                onChange={(e) =>
                                    depouncedUpdateEvaluationScenario({note: e.target.value})
                                }
                                key={scenarioId}
                            />
                        </Space>
                    </div>
                </>
            ) : (
                <Empty description="Evaluation not found" className={classes.centeredItem} />
            )}
        </div>
    )
}

export default EvaluationCardView
