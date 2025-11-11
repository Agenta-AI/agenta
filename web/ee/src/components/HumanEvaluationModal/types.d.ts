export interface HumanEvaluationModalProps {
    isEvalModalOpen: boolean
    setIsEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    evaluationType: "single_model_test" | "human_a_b_testing"
}
