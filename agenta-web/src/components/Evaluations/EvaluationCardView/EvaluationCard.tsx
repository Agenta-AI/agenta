import {Variant} from "@/lib/Types"
import React from "react"
import {createUseStyles} from "react-jss"
import EvaluationVariantCard from "./EvaluationVariantCard"
import {ABTestingEvaluationTableRow} from "@/components/EvaluationTable/ABTestingEvaluationTable"
import EvaluationChatResponse from "./EvaluationChatResponse"

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
    isChat?: boolean
    showVariantName?: boolean
}

const EvaluationCard: React.FC<Props> = ({
    evaluationScenario,
    variants,
    isChat,
    showVariantName = true,
}) => {
    const classes = useStyles()

    return (
        <div
            className={classes.root}
            style={isChat ? {flexDirection: "column", marginTop: "1rem"} : {}}
        >
            {variants.map((variant, ix) =>
                isChat ? (
                    <EvaluationChatResponse
                        key={variant.variantId}
                        variant={variant}
                        outputText={
                            evaluationScenario[variant.variantId] ||
                            evaluationScenario.outputs.find((item) => item.variant_id)
                                ?.variant_output ||
                            ""
                        }
                        index={ix}
                        showVariantName={showVariantName}
                    />
                ) : (
                    <EvaluationVariantCard
                        key={variant.variantId}
                        variant={variant}
                        outputText={
                            evaluationScenario[variant.variantId] ||
                            evaluationScenario.outputs.find((item) => item.variant_id)
                                ?.variant_output ||
                            ""
                        }
                        index={ix}
                        showVariantName={showVariantName}
                        //random image from unsplash
                        // outputImg={`https://source.unsplash.com/random/?sig=${ix}`}
                    />
                ),
            )}
        </div>
    )
}

export default EvaluationCard
