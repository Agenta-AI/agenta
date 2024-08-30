import {HumanEvaluationListTableDataType} from "@/components/Evaluations/HumanEvaluationResult"
import React from "react"
import AbTestingEvalOverview from "@/components/pages/overview/abTestingEvaluation/AbTestingEvalOverview"

interface AbTestingEvaluationProps {
    evaluationList: HumanEvaluationListTableDataType[]
    fetchingEvaluations: boolean
}

const AbTestingEvaluation = ({evaluationList, fetchingEvaluations}: AbTestingEvaluationProps) => {
    return <AbTestingEvalOverview viewType="evaluation" />
}

export default AbTestingEvaluation
