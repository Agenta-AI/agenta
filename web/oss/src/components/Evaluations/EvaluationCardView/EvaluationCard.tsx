import {createUseStyles} from "react-jss"

import {ABTestingEvaluationTableRow} from "@/oss/components/EvaluationTable/ABTestingEvaluationTable"
import {Evaluation, Variant} from "@/oss/lib/Types"

import EvaluationChatResponse from "./EvaluationChatResponse"
import EvaluationVariantCard from "./EvaluationVariantCard"

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
    evaluation: Evaluation
}

const EvaluationCard: React.FC<Props> = ({
    evaluationScenario,
    variants,
    isChat,
    showVariantName = true,
    evaluation,
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
                        evaluation={evaluation}
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
                        evaluation={evaluation}
                        //random image from unsplash
                        // outputImg={`https://fps.cdnpk.net/images/home/subhome-ai.webp?w=649&h=649`}
                    />
                ),
            )}
        </div>
    )
}

export default EvaluationCard
