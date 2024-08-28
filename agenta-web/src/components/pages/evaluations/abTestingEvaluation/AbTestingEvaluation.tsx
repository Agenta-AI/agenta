import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import React from "react"

interface AbTestingEvaluationProps {
    evaluationList: HumanEvaluationListTableDataType[]
    fetchingEvaluations: boolean
}

const AbTestingEvaluation = ({evaluationList, fetchingEvaluations}: AbTestingEvaluationProps) => {
    return <div>AbTestingEvaluation</div>
}

export default AbTestingEvaluation
