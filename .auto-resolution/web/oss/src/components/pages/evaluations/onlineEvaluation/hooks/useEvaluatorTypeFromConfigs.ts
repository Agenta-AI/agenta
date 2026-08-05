import {useMemo} from "react"

import {
    collectEvaluatorCandidates,
    evaluatorConfigsListDataAtom,
    getWorkflowTypeLabel,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"

import {EVALUATOR_CATEGORY_LABEL_MAP} from "../constants"

export interface UseEvaluatorTypeFromConfigsParams {
    evaluator?: any | null
}

const getEvaluatorTypeLabel = (typeKey: string): string | undefined =>
    ((EVALUATOR_CATEGORY_LABEL_MAP as any)[typeKey] as string | undefined) ??
    getWorkflowTypeLabel(typeKey) ??
    undefined

export const useEvaluatorTypeFromConfigs = ({
    evaluator,
}: UseEvaluatorTypeFromConfigsParams): {label?: string; typeKey?: string} => {
    const configs = useAtomValue(evaluatorConfigsListDataAtom)

    return useMemo(() => {
        if (!evaluator || !Array.isArray(configs) || configs.length === 0) {
            return {label: undefined, typeKey: undefined}
        }

        const candidates = collectEvaluatorCandidates(
            resolveEvaluatorKey(evaluator as any),
            (evaluator as any)?.slug,
            (evaluator as any)?.key,
            (evaluator as any)?.meta?.evaluator_key,
            (evaluator as any)?.flags?.evaluator_key,
        )

        const match = configs.find((cfg) => {
            const key = (resolveEvaluatorKey(cfg) || cfg?.name || cfg?.id || "").toString().trim()
            if (!key) return false
            const lower = key.toLowerCase()
            if (candidates.includes(lower)) return true
            if (candidates.includes(lower.replace(/[^a-z0-9]+/g, "_"))) return true
            return false
        })

        if (!match) return {label: undefined, typeKey: undefined}
        const matchKey =
            (
                resolveEvaluatorKey(match) ||
                (match as any)?.key ||
                (match as any)?.slug ||
                (match as any)?.name ||
                ""
            )
                .toString()
                .trim() || undefined

        // 1) Try label from config.tags using category map
        const tags: string[] = Array.isArray(match.tags)
            ? (match.tags as string[])
            : typeof (match as any)?.tags === "string"
              ? [(match as any).tags as string]
              : []

        for (const raw of tags) {
            if (!raw) continue
            const lower = raw.toString().trim().toLowerCase()
            const slugified = lower
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/_+/g, "_")
                .replace(/^_|_$/g, "")
            const label = getEvaluatorTypeLabel(slugified)
            if (label) return {label, typeKey: matchKey ?? slugified}
        }

        // 2) Infer label by scanning evaluator_key/name tokens for known category slugs
        const categorySlugs = Object.keys(EVALUATOR_CATEGORY_LABEL_MAP || {})
        const keyTokens = [
            resolveEvaluatorKey(match),
            (match as any)?.name,
            (evaluator as any)?.key,
            (evaluator as any)?.name,
        ]
            .filter(Boolean)
            .map((v) => v.toString().toLowerCase())
            .flatMap((text) => text.split(/[^a-z0-9]+/g).filter(Boolean))

        for (const token of keyTokens) {
            // direct token match
            const tokenLabel = getEvaluatorTypeLabel(token)
            if (tokenLabel) {
                return {
                    label: tokenLabel,
                    typeKey: matchKey ?? token,
                }
            }
            // token may contain category slug as substring
            const found = categorySlugs.find((slug) => token.includes(slug))
            if (found) {
                const foundLabel = getEvaluatorTypeLabel(found)
                return {
                    label: foundLabel,
                    typeKey: matchKey ?? found,
                }
            }
        }

        // 2b) Heuristics: map common keywords to categories
        const keywordToCategory: Record<string, string> = {
            // regex-based evaluators are functional validators
            regex: "functional",
            // semantic similarity
            similarity: "similarity",
            similar: "similarity",
            // classifiers
            classifier: "classifiers",
            classify: "classifiers",
            // llm/ai
            llm: "ai_llm",
            gpt: "ai_llm",
            openai: "ai_llm",
            anthropic: "ai_llm",
            mistral: "ai_llm",
            minimax: "ai_llm",
            groq: "ai_llm",
        }

        for (const token of keyTokens) {
            const cat = keywordToCategory[token]
            const catLabel = cat ? getEvaluatorTypeLabel(cat) : undefined
            if (cat && catLabel) {
                return {
                    label: catLabel,
                    typeKey: matchKey ?? cat,
                }
            }
        }

        return {label: undefined, typeKey: undefined}
    }, [evaluator, configs])
}
