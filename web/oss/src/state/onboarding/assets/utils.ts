import Router from "next/router"
import {getDefaultStore} from "jotai"
import {v4 as uuidv4} from "uuid"

import {collectEvaluatorCandidates} from "@/oss/components/pages/evaluations/onlineEvaluation/utils/evaluatorDetails"
import {evaluatorConfigsAtom} from "@/oss/lib/atoms/evaluation"
import type {EvaluatorConfig} from "@/oss/lib/Types"
import {
    createSimpleEvaluation,
    createSimpleQuery,
    retrieveQueryRevision,
    type SimpleEvaluationCreatePayload,
    type SimpleEvaluationPayload,
} from "@/oss/services/onlineEvaluations/api"
import {fetchAllEvaluatorConfigs} from "@/oss/services/evaluators"
import {lastVisitedEvaluationAtom} from "@/oss/components/pages/evaluations/state/lastVisitedEvaluationAtom"
import {waitForValidURL, getURLValues} from "@/oss/state/url"

import {demoOnlineEvaluationAtom, type DemoOnlineEvaluationContext} from "../atoms/helperAtom"

const DEMO_EVALUATION_NAME = "demo-evaluation"
const LLM_JUDGE_KEYS = new Set([
    "llm-as-a-judge",
    "llm_as_a_judge",
    "auto_ai_critique",
    "ai_critique",
])

const ensureEvaluatorConfigs = async (): Promise<EvaluatorConfig[]> => {
    const store = getDefaultStore()
    let configs = store.get(evaluatorConfigsAtom) || []
    if (configs.length) return configs
    configs = await fetchAllEvaluatorConfigs()
    store.set(evaluatorConfigsAtom, configs)
    return configs
}

const findLlmJudgeConfig = async (): Promise<EvaluatorConfig | null> => {
    const configs = await ensureEvaluatorConfigs()
    return (
        configs.find((config) => {
            const candidates = collectEvaluatorCandidates(
                config?.evaluator_key,
                (config as any)?.slug,
                config?.name,
                (config as any)?.key,
                (config as any)?.meta?.evaluator_key,
                (config as any)?.meta?.key,
            )
            return candidates.some((candidate) => LLM_JUDGE_KEYS.has(candidate))
        }) ?? null
    )
}

const safePush = async (href: string | null | undefined) => {
    if (!href || typeof window === "undefined") return false
    try {
        if (Router.asPath === href) return true
        await Router.push(href)
        return true
    } catch (error) {
        console.error("[onboarding] navigation failed", {href, error})
        return false
    }
}

export const createOnlineEvaluation = async (): Promise<DemoOnlineEvaluationContext> => {
    const evaluatorConfig = await findLlmJudgeConfig()
    if (!evaluatorConfig) {
        throw new Error("Add an LLM-as-a-judge evaluator before starting the tour.")
    }

    const querySlug = `demo-eval-${uuidv4().slice(0, 8)}`
    const queryResponse = await createSimpleQuery({
        query: {
            slug: querySlug,
            name: `${DEMO_EVALUATION_NAME}-query`,
            description: "Auto-generated query for the SME onboarding tour",
        },
    })
    const queryId = queryResponse.query?.id
    if (!queryId) {
        throw new Error("Unable to create a query for the demo evaluation.")
    }

    const revisionResponse = await retrieveQueryRevision({query_ref: {id: queryId}})
    const queryRevisionId = revisionResponse.query_revision?.id
    if (!queryRevisionId) {
        throw new Error("Unable to resolve the query revision for the demo evaluation.")
    }

    const evaluationPayload: SimpleEvaluationCreatePayload = {
        name: DEMO_EVALUATION_NAME,
        description: "Live evaluation created from the onboarding tour",
        flags: {
            is_live: true,
            is_closed: false,
            is_active: false,
        },
        data: {
            status: "pending",
            query_steps: {[queryRevisionId]: "auto"},
            evaluator_steps: {[evaluatorConfig.id]: "auto"},
            repeats: 1,
        },
    }

    const evaluationResponse = await createSimpleEvaluation({evaluation: evaluationPayload})
    const evaluation = evaluationResponse.evaluation
    if (!evaluation?.id) {
        throw new Error("Failed to create the demo online evaluation.")
    }

    return {
        evaluation,
        evaluatorConfig,
        queryId,
        queryRevisionId,
    }
}

export const redirectToAppsPage = async () => {
    const urls = await waitForValidURL({requireProject: true})
    if (!urls.projectURL) return false
    return safePush(`${urls.projectURL}/apps`)
}

export const redirectToPlayground = async () => {
    const urls = await waitForValidURL({requireProject: true})
    const baseApp = urls.appURL || urls.recentlyVisitedAppURL
    if (!baseApp) return false
    return safePush(`${baseApp}/playground`)
}

export const redirectToOnlineEvaluations = async () => {
    const urls = await waitForValidURL({requireProject: true})
    if (!urls.projectURL) return false
    const store = getDefaultStore()
    store.set(lastVisitedEvaluationAtom, "online_evaluation")
    return safePush(`${urls.projectURL}/evaluations?selectedEvaluation=online_evaluation`)
}

export const redirectToDemoEvaluationRun = async () => {
    const store = getDefaultStore()
    const context = store.get(demoOnlineEvaluationAtom)
    if (!context?.evaluation?.id) return false
    const urls = await waitForValidURL({requireProject: true})
    if (!urls.projectURL) return false
    store.set(lastVisitedEvaluationAtom, "online_evaluation")
    const target = `${urls.projectURL}/evaluations/results/${context.evaluation.id}?type=online`
    return safePush(target)
}

export const getPlaygroundRoute = (): string | null => {
    const urls = getURLValues()
    const baseApp = urls.appURL || urls.recentlyVisitedAppURL
    if (!baseApp) return null
    return `${baseApp}/playground`
}
export const getOnlineEvaluationsRoute = (): string | null => {
    const urls = getURLValues()
    if (!urls.projectURL) return null
    return `${urls.projectURL}/evaluations?selectedEvaluation=online_evaluation`
}

export const getDemoEvaluationRunRoute = (): string | null => {
    const store = getDefaultStore()
    const context = store.get(demoOnlineEvaluationAtom)
    if (!context?.evaluation?.id) return null
    const urls = getURLValues()
    if (!urls.projectURL) return null
    return `${urls.projectURL}/evaluations/results/${context.evaluation.id}?type=online`
}
