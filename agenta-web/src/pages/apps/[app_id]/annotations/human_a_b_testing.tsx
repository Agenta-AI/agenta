import HumanEvaluationResult from "@/components/Evaluations/HumanEvaluationResult"
import HumanEvaluationModal from "@/components/HumanEvaluationModal/HumanEvaluationModal"
import {useQueryParam} from "@/hooks/useQuery"
import React, {useState} from "react"

const HumanABTestingEvaluation = () => {
    const [isEvalModalOpen, setIsEvalModalOpen] = useState(false)
    const [isQueryHumanEvalOpen, setIsQueryHumanEvalOpen] = useQueryParam("openHumanEvalModal")

    return (
        <>
            <HumanEvaluationResult setIsEvalModalOpen={setIsEvalModalOpen} />

            <HumanEvaluationModal
                evaluationType={"human_a_b_testing"}
                isEvalModalOpen={isQueryHumanEvalOpen === "open" || isEvalModalOpen}
                setIsEvalModalOpen={setIsEvalModalOpen}
                setIsQueryHumanEvalOpen={setIsQueryHumanEvalOpen}
            />
        </>
    )
}

export default HumanABTestingEvaluation
