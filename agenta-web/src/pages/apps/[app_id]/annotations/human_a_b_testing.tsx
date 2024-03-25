import HumanEvaluationResult from "@/components/Evaluations/HumanEvaluationResult"
import HumanEvaluationModal from "@/components/HumanEvaluationModal/HumanEvaluationModal"
import React, {useState} from "react"

const HumanABTestingEvaluation = () => {
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)
    return (
        <>
            <HumanEvaluationResult setIsEvalModalOpen={setIsEvalModalOpen} />

            <HumanEvaluationModal
                evaluationType={"human_a_b_testing"}
                isEvalModalOpen={isEvalModalOpen}
                setIsEvalModalOpen={setIsEvalModalOpen}
            />
        </>
    )
}

export default HumanABTestingEvaluation
