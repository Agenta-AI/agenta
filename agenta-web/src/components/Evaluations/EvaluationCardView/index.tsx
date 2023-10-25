import {useQueryParam} from "@/hooks/useQuery"
import {Evaluation, EvaluationResult, EvaluationScenario} from "@/lib/Types"
import {LeftOutlined, RightOutlined} from "@ant-design/icons"
import {Button, Divider, Empty, Space, Typography} from "antd"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import EvaluationVoteRecorder from "./EvaluationVoteRecorder"
import EvaluationCard from "./EvaluationCard"
import EvaluationInputs from "./EvaluationInputs"
import {updateEvaluationScenario} from "@/lib/services/api"
import {useAtom} from "jotai"
import {evaluationScenariosAtom} from "@/lib/atoms/evaluation"

const useStyles = createUseStyles({
    root: {
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
    },
    heading: {
        width: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "0.75rem",
        "& .ant-typography": {
            margin: 0,
        },
    },
})

interface Props {
    evaluation: Evaluation
    evaluationScenarios: EvaluationScenario[]
    results: EvaluationResult
}

const EvaluationCardView: React.FC<Props> = ({evaluation, evaluationScenarios}) => {
    const classes = useStyles()
    const [scenarioId, setScenarioId] = useQueryParam(
        "evaluationScenario",
        evaluationScenarios[0]?.id || "",
    )
    const {scenario, scenarioIndex} = useMemo(() => {
        const scenarioIndex = evaluationScenarios.findIndex(
            (scenario) => scenario.id === scenarioId,
        )
        return {scenario: evaluationScenarios[scenarioIndex], scenarioIndex}
    }, [scenarioId, evaluationScenarios])
    const [_, setEvaluationScenarios] = useAtom(evaluationScenariosAtom)
    // const [scenario, setScenario] = useState(evaluationScenarios[scenarioIndex])

    // useEffect(() => {
    //     if (scenarioIndex === -1) return
    //     setScenario(evaluationScenarios[scenarioIndex])
    // }, [scenarioIndex])

    const loadPrevious = () => {
        if (scenarioIndex === 0) return
        setScenarioId(evaluationScenarios[scenarioIndex - 1].id)
    }

    const loadNext = () => {
        if (scenarioIndex === evaluationScenarios.length - 1) return
        setScenarioId(evaluationScenarios[scenarioIndex + 1].id)
    }

    const onVote = (vote: string) => {
        updateEvaluationScenario(
            evaluation.id,
            scenarioId,
            {vote, outputs: scenario.outputs},
            evaluation.evaluationType,
        )
            .then(() => {
                const newScenarios = [...evaluationScenarios]
                newScenarios[scenarioIndex].vote = vote
                setEvaluationScenarios(newScenarios)
            })
            .catch(console.error)
    }

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") loadPrevious()
            else if (e.key === "ArrowRight") loadNext()
        }

        document.addEventListener("keydown", listener)
        return () => document.removeEventListener("keydown", listener)
    }, [scenarioIndex])

    return (
        <div className={classes.root}>
            {scenario ? (
                <>
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

                    <Divider />
                    <Typography.Title level={5}>Inputs</Typography.Title>
                    <EvaluationInputs evaluationScenario={scenario} />

                    <Divider />
                    <Typography.Title level={5}>Variants</Typography.Title>
                    <EvaluationCard evaluation={evaluation} evaluationScenario={scenario} />

                    <Divider />
                    <Typography.Title level={5}>Evaluation</Typography.Title>
                    <EvaluationVoteRecorder
                        type="comparison"
                        value={scenario.vote || ""}
                        variants={evaluation.variants}
                        onChange={onVote}
                    />
                </>
            ) : (
                <Empty description="Evaluation not found" />
            )}
        </div>
    )
}

export default EvaluationCardView
