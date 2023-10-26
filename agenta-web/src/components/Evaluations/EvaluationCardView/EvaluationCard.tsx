import {Variant} from "@/lib/Types"
import React from "react"
import {createUseStyles} from "react-jss"
import EvaluationVariantCard from "./EvaluationVariantCard"
import {ABTestingEvaluationTableRow} from "@/components/EvaluationTable/ABTestingEvaluationTable"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
    },
})

interface Props {
    evaluationScenario: ABTestingEvaluationTableRow
    variants: Variant[]
}

const EvaluationCard: React.FC<Props> = ({evaluationScenario, variants}) => {
    const classes = useStyles()

    return (
        <div className={classes.root}>
            {variants.map((variant) => (
                <EvaluationVariantCard
                    key={variant.variantId}
                    variant={variant}
                    outputText={
                        evaluationScenario[variant.variantId] ||
                        evaluationScenario.outputs.find((item) => item.variant_id)
                            ?.variant_output ||
                        ""
                    }
                />
            ))}
        </div>
    )
}

export default EvaluationCard
