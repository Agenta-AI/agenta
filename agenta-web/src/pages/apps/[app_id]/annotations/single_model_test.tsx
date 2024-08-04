import React, {useState} from "react"
import AutomaticEvaluationResult from "@/components/Evaluations/AutomaticEvaluationResult"
import HumanEvaluationModal from "@/components/HumanEvaluationModal/HumanEvaluationModal"
import {useQueryParam} from "@/hooks/useQuery"

const SingleModelTestEvaluation = () => {
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)
    const [isQueryHumanEvalOpen, setIsQueryHumanEvalOpen] = useQueryParam("openHumanEvalModal")

    return (
        <>
            <AutomaticEvaluationResult setIsEvalModalOpen={setIsEvalModalOpen} />

            <HumanEvaluationModal
                evaluationType={"single_model_test"}
                isEvalModalOpen={isQueryHumanEvalOpen === "open" || isEvalModalOpen}
                setIsEvalModalOpen={setIsEvalModalOpen}
                setIsQueryHumanEvalOpen={setIsQueryHumanEvalOpen}
            />
        </>
    )
}

export default SingleModelTestEvaluation
