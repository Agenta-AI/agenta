import {useCallback} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {traceDrawerNavigate, traceDrawerProjectURLAtom} from "./navigationSeam"
import {closeTraceDrawerAtom} from "./traceDrawerStore"

interface NavigationTarget {
    href: string
    type: "human" | "auto"
}

/**
 * Callers pass whole evaluator/workflow records whose `flags` differ in shape, so this takes
 * `unknown` and probes the two fields it needs rather than declaring a type they must match.
 */
type FeedbackFlags = {is_feedback?: boolean | null} | null | undefined

const getEvaluatorIdentifier = (evaluator: unknown) =>
    (evaluator as {id?: string} | null | undefined)?.id ?? null

const isHumanEvaluator = (evaluator: unknown) => {
    const e = evaluator as {flags?: FeedbackFlags; meta?: FeedbackFlags} | null | undefined
    return Boolean(e?.flags?.is_feedback || e?.meta?.is_feedback)
}

export const useEvaluatorNavigation = () => {
    const projectURL = useAtomValue(traceDrawerProjectURLAtom)
    const closeTraceDrawer = useSetAtom(closeTraceDrawerAtom)

    const buildEvaluatorTarget = useCallback(
        (evaluator?: unknown): NavigationTarget | null => {
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
                href: `${projectURL}/evaluators/playground?revisions=${encodeURIComponent(identifier)}`,
                type: "auto",
            }
        },
        [projectURL],
    )

    const navigateToEvaluator = useCallback(
        async (evaluator?: unknown) => {
            const target = buildEvaluatorTarget(evaluator)
            if (!target) return

            closeTraceDrawer()
            await traceDrawerNavigate(target.href)
        },
        [buildEvaluatorTarget, closeTraceDrawer],
    )

    return {buildEvaluatorTarget, navigateToEvaluator}
}

export default useEvaluatorNavigation
