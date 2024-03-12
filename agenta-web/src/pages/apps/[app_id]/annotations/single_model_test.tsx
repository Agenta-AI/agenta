import React, {useState} from "react"
import AutomaticEvaluationResult from "@/components/Evaluations/AutomaticEvaluationResult"
import HumanEvaluationModal from "@/components/HumanEvaluationModal/HumanEvaluationModal"

const SingleModelTestEvaluation = () => {
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)

    return (
        <>
            <AutomaticEvaluationResult setIsEvalModalOpen={setIsEvalModalOpen} />

            <HumanEvaluationModal
                evaluationType={"single_model_test"}
                isEvalModalOpen={isEvalModalOpen}
                setIsEvalModalOpen={setIsEvalModalOpen}
            />
        </>
    )
}

export default SingleModelTestEvaluation
