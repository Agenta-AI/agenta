import {useQueryParam} from "@/hooks/useQuery"
import {EvaluationScenario, Variant} from "@/lib/Types"
import {
    EditFilled,
    EditOutlined,
    LeftOutlined,
    PlayCircleOutlined,
    PushpinFilled,
    PushpinOutlined,
    QuestionCircleOutlined,
    RightOutlined,
} from "@ant-design/icons"
import {Alert, Button, Empty, Input, Space, Tooltip, Typography, theme} from "antd"
import React, {useCallback, useEffect, useMemo, useRef} from "react"
import {createUseStyles} from "react-jss"
import EvaluationVoteRecorder from "./EvaluationVoteRecorder"
import EvaluationCard from "./EvaluationCard"
import EvaluationInputs from "./EvaluationInputs"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {ABTestingEvaluationTableRow} from "@/components/EvaluationTable/ABTestingEvaluationTable"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {useLocalStorage} from "usehooks-ts"

export const VARIANT_COLORS = [
    "#297F87", // "#722ed1",
    "#F6D167", //"#13c2c2",
]

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    root: {
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
        paddingRight: "1rem",
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
    buttonsBar: ({themeMode}: StyleProps) => ({
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        "& .anticon": {
            fontSize: 20,
            cursor: "pointer",
        },
        padding: "1rem",
        boxShadow:
            themeMode === "dark"
                ? "0 0 10px 0 rgba(255, 255, 255, 0.15)"
                : "0 0 8px rgba(0, 0, 0, 0.1)",
        borderRadius: 6,
        position: "sticky",
        top: "calc(50vh - 130px)",
    }),
    instructions: {
        paddingInlineStart: "1.5rem",
        "& code": {
            backgroundColor: "rgba(0, 0, 0, 0.05)",
            padding: "0.1rem 0.3rem",
            borderRadius: 3,
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
})

interface Props {
    variants: Variant[]
    evaluationScenarios: ABTestingEvaluationTableRow[]
    onRun: (id: string) => void
    onVote: (id: string, vote: string) => void
    onInputChange: Function
    updateEvaluationScenarioData: (id: string, data: Partial<EvaluationScenario>) => void
}

const EvaluationCardView: React.FC<Props> = ({
    variants,
    evaluationScenarios,
    onRun,
    onVote,
    onInputChange,
    updateEvaluationScenarioData,
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
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
                        Click the <b>Run</b> button on right or press <code>{`Enter (↵)`}</code> to
                        generate the variants' outputs.
                    </li>
                    <li>
                        Vote by either clicking the evaluation buttons at the bottom or pressing the
                        key <code>a</code> for 1st Variant, <code>b</code> for 2nd Variant and{" "}
                        <code>x</code> if both are bad.
                    </li>
                    <li>
                        You can also jump to a specific evaluation by pressing the numeric keys{" "}
                        <code>1</code> to <code>9</code>.
                    </li>
                </ol>
            ),
            okText: "Ok",
            cancelText: null,
            width: 500,
        })
    }, [])

    const onEditNote = () => {
        let note = scenario?.note || ""
        AlertPopup({
            title: note ? "Edit note" : "Add a note",
            type: "info",
            message: (
                <div>
                    <p>Enter a note for this evaluation:</p>
                    <Input.TextArea defaultValue={note} onChange={(e) => (note = e.target.value)} />
                </div>
            ),
            okText: "Save",
            onOk: () => updateEvaluationScenarioData(scenarioId, {note}),
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
        const listener = (e: KeyboardEvent) => {
            if (document.activeElement !== rootRef.current) return
            if (e.key === "ArrowLeft") loadPrevious()
            else if (e.key === "ArrowRight") loadNext()
            else if (e.key === "Enter") callbacks.current.onRun(scenarioId)
            else if (e.key === "a") callbacks.current.onVote(scenarioId, variants[0].variantId)
            else if (e.key === "b") callbacks.current.onVote(scenarioId, variants[1].variantId)
            else if (e.key === "x") callbacks.current.onVote(scenarioId, "0")
            else if (!isNaN(+e.key)) {
                const num = +e.key
                if (num >= 1 && num <= evaluationScenarios.length)
                    setScenarioId(evaluationScenarios[num - 1].id)
            }
        }

        document.addEventListener("keydown", listener)
        return () => document.removeEventListener("keydown", listener)
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

                        {scenario.note && (
                            <Alert
                                message={scenario.note}
                                type="warning"
                                showIcon
                                closable
                                onClose={() => updateEvaluationScenarioData(scenarioId, {note: ""})}
                                className={classes.note}
                            />
                        )}

                        <div className={classes.headingDivider}>
                            <div className={classes.helpIcon}>
                                <Tooltip title="Instructions">
                                    <QuestionCircleOutlined
                                        onClick={showInstructions}
                                        style={{color: token.colorPrimary}}
                                    />
                                </Tooltip>
                            </div>
                        </div>

                        <EvaluationInputs
                            evaluationScenario={scenario}
                            onInputChange={onInputChange}
                        />

                        <EvaluationCard variants={variants} evaluationScenario={scenario} />

                        {scenario.outputs.some((item) => !!item.variant_output) && (
                            <>
                                <EvaluationVoteRecorder
                                    type="comparison"
                                    value={scenario.vote || ""}
                                    variants={variants}
                                    onChange={(vote) => onVote(scenarioId, vote)}
                                    loading={scenario.vote === "loading"}
                                />
                            </>
                        )}
                    </div>
                    <div className={classes.buttonsBar}>
                        {scenario.note ? (
                            <Tooltip title="Edit note">
                                <EditFilled
                                    style={{color: token.colorPrimary}}
                                    onClick={onEditNote}
                                />
                            </Tooltip>
                        ) : (
                            <Tooltip title="Add a note">
                                <EditOutlined
                                    style={{color: token.colorPrimary}}
                                    onClick={onEditNote}
                                />
                            </Tooltip>
                        )}
                        {scenario.isPinned ? (
                            <Tooltip title="Unpin">
                                <PushpinFilled
                                    style={{color: token.colorErrorActive}}
                                    onClick={() =>
                                        updateEvaluationScenarioData(scenarioId, {isPinned: false})
                                    }
                                />
                            </Tooltip>
                        ) : (
                            <Tooltip title="Pin">
                                <PushpinOutlined
                                    style={{color: token.colorError}}
                                    onClick={() =>
                                        updateEvaluationScenarioData(scenarioId, {isPinned: true})
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
                </>
            ) : (
                <Empty description="Evaluation not found" />
            )}
        </div>
    )
}

export default EvaluationCardView
