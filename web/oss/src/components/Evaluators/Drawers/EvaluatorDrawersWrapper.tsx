/**
 * EvaluatorDrawersWrapper
 *
 * Global wrapper that mounts both the auto and human evaluator drawers.
 * Mounted in AppGlobalWrappers alongside VariantDrawerWrapper.
 */
import dynamic from "next/dynamic"

const EvaluatorDrawer = dynamic(
    () => import("@/oss/components/Evaluators/Drawers/EvaluatorDrawer"),
    {ssr: false},
)

const HumanEvaluatorDrawer = dynamic(
    () => import("@/oss/components/Evaluators/Drawers/HumanEvaluatorDrawer"),
    {ssr: false},
)

const EvaluatorDrawersWrapper = () => {
    return (
        <>
            <EvaluatorDrawer />
            <HumanEvaluatorDrawer />
        </>
    )
}

export default EvaluatorDrawersWrapper
