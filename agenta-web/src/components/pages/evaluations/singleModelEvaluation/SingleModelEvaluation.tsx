import {SingleModelEvaluationListTableDataType} from "@/lib/Types"
import React from "react"

interface SingleModelEvaluationProps {
    evaluationList: SingleModelEvaluationListTableDataType[]
    fetchingEvaluations: boolean
}

const SingleModelEvaluation = ({
    evaluationList,
    fetchingEvaluations,
}: SingleModelEvaluationProps) => {
    return <div>SingleModelEvaluation</div>
}

export default SingleModelEvaluation
