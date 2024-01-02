import EvaluationResults from "@/components/pages/evaluations/evaluationResults/EvaluationResults"
import React from "react"

interface Props {}

const Annotations: React.FC<Props> = () => {
    return <EvaluationResults type="human" />
}

export default Annotations
