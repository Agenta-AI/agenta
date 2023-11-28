import {useQueryParam} from "@/hooks/useQuery"
import {ChatMessage, Evaluation, EvaluationScenario, Variant} from "@/lib/Types"
import {
    LeftOutlined,
    PlayCircleOutlined,
    PushpinFilled,
    PushpinOutlined,
    QuestionCircleOutlined,
    RightOutlined,
} from "@ant-design/icons"
import {Button, Empty, Input, Space, Tooltip, Typography, theme} from "antd"
import React, {useCallback, useEffect, useMemo, useRef} from "react"
import {createUseStyles} from "react-jss"
import EvaluationVotePanel from "./EvaluationVotePanel"
import EvaluationCard from "./EvaluationCard"
import EvaluationInputs from "./EvaluationInputs"
import {ABTestingEvaluationTableRow} from "@/components/EvaluationTable/ABTestingEvaluationTable"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {useLocalStorage} from "usehooks-ts"
import ChatInputs from "@/components/ChatInputs/ChatInputs"
import {testsetRowToChatMessages} from "@/lib/helpers/testset"
import {safeParse} from "@/lib/helpers/utils"
import {debounce} from "lodash"
import {EvaluationType} from "@/lib/enums"

export const VARIANT_COLORS = [
    "#297F87", // "#722ed1",
    "#F6D167", //"#13c2c2",
]

const useStyles = createUseStyles({
    root: {
        display: "flex",
        gap: "1rem",
        outline: "none",
    },
    evaluation: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "1rem",
        "& .ant-divider": {
            margin: "2rem 0 1.5rem 0",
        },
        "& h5.ant-typography": {
            margin: 0,
            marginBottom: "1rem",
        },
        gap: "1rem",
    },
    heading: {
        width: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "0.75rem",
        "& .ant-typography": {
            margin: 0,
            fontWeight: 400,
        },
    },
    headingDivider: {
        position: "relative",
    },
    helpIcon: {
        position: "absolute",
        right: 0,
        top: 42,
        fontSize: 16,
    },
    instructions: {
        paddingInlineStart: 0,
        "& code": {
            backgroundColor: "rgba(0, 0, 0, 0.05)",
            padding: "0.1rem 0.3rem",
            borderRadius: 3,
        },
        "& li": {
            marginBottom: "0.5rem",
        },
    },
    note: {
        marginTop: "1.25rem",
        marginBottom: "-1rem",
        whiteSpace: "pre-line",
        display: "flex",
        alignItems: "flex-start",

        "& .anticon": {
            marginTop: 4,
        },
    },
    chatInputsCon: {
        marginTop: "0.5rem",
    },
    correctAnswerCon: {
        marginBottom: "0.5rem",
    },
    toolBar: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        justifyContent: "flex-end",
        "& .anticon": {
            fontSize: 18,
            cursor: "pointer",
        },
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

interface Props {
    variants: Variant[]
    evaluationScenarios: ABTestingEvaluationTableRow[]
    onRun: (id: string) => void
    onVote: (id: string, vote: string | number | null) => void
    onInputChange: Function
    updateEvaluationScenarioData: (id: string, data: Partial<EvaluationScenario>) => void
    evaluation: Evaluation
}

const EvaluationCardView: React.FC<Props> = ({
    variants,
    evaluationScenarios,
    onRun,
    onVote,
    onInputChange,
    updateEvaluationScenarioData,
    evaluation,
}) => {
    const classes = useStyles()
    const {token} = theme.useToken()
    const [scenarioId, setScenarioId] = useQueryParam(
        "evaluationScenario",
        evaluationScenarios[0]?.id || "",
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
                        Pin an evaluation to come back later by clicking the <b>Pin</b>{" "}
                        <PushpinOutlined style={{color: token.colorError}} /> button on the right.
                    </li>
                    <li>
                        Add a note to an evaluation from the <b>Additional Notes</b> input section{" "}
                        in the right sidebar.
                    </li>
                </ol>
            ),
            okText: "Ok",
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
                ...scenario.inputs.filter((ip) => ip.input_name !== "chat"),
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
            const chatStr = scenario?.inputs.find((ip) => ip.input_name === "chat")?.input_value
            if (chatStr) testsetRow[evaluation.testset.testsetChatColumn] = chatStr
        }
    }, [scenario])

    const correctAnswer = useMemo(() => {
        if (scenario?.correctAnswer) return scenario.correctAnswer
        let res = testsetRow?.correct_answer
        if (isChat) res = safeParse(res)?.content
        return res || ""
    }, [testsetRow?.correct_answer, scenario?.correctAnswer])

    const chat = useMemo(() => {
        const fromInput = scenario?.inputs.find((ip) => ip.input_name === "chat")?.input_value
        if (!isChat) return []

        return testsetRowToChatMessages(
            fromInput
                ? {chat: fromInput, correct_answer: testsetRow?.correct_answer}
                : testsetRow || {},
            false,
        )
    }, [scenarioIndex])

    return (
        <div className={classes.root} tabIndex={1} ref={rootRef}>
            {scenario ? (
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
                            <Typography.Title level={2}>
                                Evaluation: {scenarioIndex + 1}/{evaluationScenarios.length}
                            </Typography.Title>
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

                        {isChat ? (
                            <div className={classes.chatInputsCon}>
                                <ChatInputs
                                    key={scenarioId}
                                    defaultValue={chat}
                                    onChange={onChatChange}
                                />
                            </div>
                        ) : (
                            <EvaluationInputs
                                evaluationScenario={scenario}
                                onInputChange={onInputChange}
                            />
                        )}

                        <div className={classes.toolBar}>
                            <Tooltip title="Instructions">
                                <QuestionCircleOutlined
                                    onClick={showInstructions}
                                    style={{color: token.colorPrimary}}
                                />
                            </Tooltip>
                            {scenario.isPinned ? (
                                <Tooltip title="Unpin">
                                    <PushpinFilled
                                        style={{color: token.colorErrorActive}}
                                        onClick={() =>
                                            updateEvaluationScenarioData(scenarioId, {
                                                isPinned: false,
                                            })
                                        }
                                    />
                                </Tooltip>
                            ) : (
                                <Tooltip title="Pin">
                                    <PushpinOutlined
                                        style={{color: token.colorError}}
                                        onClick={() =>
                                            updateEvaluationScenarioData(scenarioId, {
                                                isPinned: true,
                                            })
                                        }
                                    />
                                </Tooltip>
                            )}
                            <Tooltip title="Run (Enter ↵)">
                                <PlayCircleOutlined
                                    style={{color: token.colorSuccessActive}}
                                    onClick={() => onRun(scenarioId)}
                                />
                            </Tooltip>
                        </div>

                        <div>
                            {!isAbTesting && (
                                <Typography.Text style={{fontSize: 20}}>
                                    Model Response
                                </Typography.Text>
                            )}

                            <EvaluationCard
                                isChat={isChat}
                                variants={variants}
                                evaluationScenario={scenario}
                                showVariantName={isAbTesting}
                            />
                        </div>
                    </div>

                    <div className={classes.sideBar}>
                        <Typography.Title level={4}>Submit your feedback</Typography.Title>
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
                                        />
                                    ) : (
                                        <EvaluationVotePanel
                                            type="numeric"
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
                <Empty description="Evaluation not found" />
            )}
        </div>
    )
}

export default EvaluationCardView
