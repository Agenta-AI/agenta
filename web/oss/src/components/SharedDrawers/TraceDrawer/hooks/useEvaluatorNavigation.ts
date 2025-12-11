import {useCallback} from "react"

import {useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {closeTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import useURL from "@/oss/hooks/useURL"

type NavigationTarget = {
    href: string
    type: "human" | "auto"
}

const getEvaluatorIdentifier = (evaluator: any) => {
    if (!evaluator) return null
    return evaluator.id
}

const isHumanEvaluator = (evaluator: any) => {
    return Boolean(evaluator?.flags?.is_human || evaluator?.meta?.is_human)
}

const useEvaluatorNavigation = () => {
    const {projectURL} = useURL()
    const router = useRouter()
    const closeTraceDrawer = useSetAtom(closeTraceDrawerAtom)

    const buildEvaluatorTarget = useCallback(
        (evaluator?: any): NavigationTarget | null => {
            if (!projectURL || !evaluator) return null

            const identifier = getEvaluatorIdentifier(evaluator)
            if (!identifier) return null

            if (isHumanEvaluator(evaluator)) {
                return {
                    href: `${projectURL}/evaluators?tab=human&openEvaluator=${encodeURIComponent(
                        identifier,
                    )}`,
                    type: "human",
                }
            }

            return {
                href: `${projectURL}/evaluators/configure/${encodeURIComponent(identifier)}`,
                type: "auto",
            }
        },
        [projectURL],
    )

    const navigateToEvaluator = useCallback(
        async (evaluator?: any) => {
            const target = buildEvaluatorTarget(evaluator)
            if (!target) return

            closeTraceDrawer()
            await router.push(target.href)
        },
        [buildEvaluatorTarget, closeTraceDrawer, router],
    )

    return {buildEvaluatorTarget, navigateToEvaluator}
}

export default useEvaluatorNavigation
