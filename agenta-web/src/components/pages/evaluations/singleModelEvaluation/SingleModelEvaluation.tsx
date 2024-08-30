import {SingleModelEvaluationListTableDataType} from "@/lib/Types"
import React from "react"
import SingleModelEvalOverview from "@/components/pages/overview/singleModelEvaluation/SingleModelEvalOverview"

interface SingleModelEvaluationProps {
    evaluationList: SingleModelEvaluationListTableDataType[]
    fetchingEvaluations: boolean
}

const SingleModelEvaluation = ({
    evaluationList,
    fetchingEvaluations,
}: SingleModelEvaluationProps) => {
    return <SingleModelEvalOverview viewType="evaluation" />
}

export default SingleModelEvaluation
