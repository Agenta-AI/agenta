import {useQueryParam} from "@/hooks/useQuery"
import {Evaluation, EvaluationResult, EvaluationScenario} from "@/lib/Types"
import {LeftOutlined, RightOutlined} from "@ant-design/icons"
import {Button, Empty, Input, Typography} from "antd"
import React, {useMemo} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    heading: {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
    },
    center: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        borderRadius: 8,
        border: `1px solid`,
    },
    card: {
        flex: 1,
        borderRadius: 8,
        border: `1px solid`,
    },
    inputsContainer: {
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
    },
})

interface Props {
    evaluation: Evaluation
    evaluationScenarios: EvaluationScenario[]
    results: EvaluationResult
}

const EvaluationCardView: React.FC<Props> = ({evaluation, evaluationScenarios, results}) => {
    const classes = useStyles()
    const [scenarioId, setScenarioId] = useQueryParam(
        "evaluationScenario",
        evaluationScenarios[0]?.id || "",
    )

    const {scenario, scenarioIndex} = useMemo(() => {
        const scenarioIndex = evaluationScenarios.findIndex(
            (scenario) => scenario.id === scenarioId,
        )
        const scenario = evaluationScenarios[scenarioIndex]
        return {scenario, scenarioIndex}
    }, [evaluationScenarios, scenarioId])

    const loadPrevious = () => {
        if (scenarioIndex === 0) return
        setScenarioId(evaluationScenarios[scenarioIndex - 1].id)
    }

    const loadNext = () => {
        if (scenarioIndex === evaluationScenarios.length - 1) return
        setScenarioId(evaluationScenarios[scenarioIndex + 1].id)
    }

    return (
        <div className={classes.center}>
            {scenario ? (
                <>
                    <div className={classes.heading}>
                        <Button
                            icon={<LeftOutlined />}
                            disabled={scenarioIndex === 0}
                            onClick={loadPrevious}
                        />
                        <Typography.Title level={3}>
                            Evaluation: {scenarioIndex + 1}/{evaluationScenarios.length}
                        </Typography.Title>
                        <Button
                            icon={<RightOutlined />}
                            disabled={scenarioIndex === evaluationScenarios.length - 1}
                            onClick={loadNext}
                        />
                    </div>
                    <div className={classes.card}>
                        <div className={classes.inputsContainer}>
                            {scenario.inputs.map((ip) => (
                                <Input placeholder={ip.input_name} defaultValue={ip.input_value} />
                            ))}
                        </div>
                    </div>
                </>
            ) : (
                <Empty description="Evaluation not found" />
            )}
        </div>
    )
}

export default EvaluationCardView
