import {Evaluation, EvaluationScenario} from "@/lib/Types"
import React from "react"
import {createUseStyles} from "react-jss"
import EvaluationVariantCard from "./EvaluationVariantCard"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
    },
})

interface Props {
    evaluation: Evaluation
    evaluationScenario: EvaluationScenario
}

const EvaluationCard: React.FC<Props> = ({evaluationScenario, evaluation}) => {
    const classes = useStyles()

    return (
        <div className={classes.root}>
            {evaluationScenario.outputs.map((op) => (
                <EvaluationVariantCard
                    key={op.variant_id}
                    variant={evaluation.variants.find((item) => item.variantId === op.variant_id)!}
                    outputText={op.variant_output}
                />
            ))}
        </div>
    )
}

export default EvaluationCard
