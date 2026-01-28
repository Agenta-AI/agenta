import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {evaluatorConfigsAtom} from "@/oss/lib/atoms/evaluation"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import useEvaluatorConfigs from "@/oss/lib/hooks/useEvaluatorConfigs"

import {EVALUATOR_CATEGORY_LABEL_MAP} from "../constants"
import {collectEvaluatorCandidates} from "../utils/evaluatorDetails"

export interface UseEvaluatorTypeFromConfigsParams {
    evaluator?: any | null
}

export const useEvaluatorTypeFromConfigs = ({
    evaluator,
}: UseEvaluatorTypeFromConfigsParams): {label?: string; color?: string} => {
    const cached = useAtomValue(evaluatorConfigsAtom)
    const {data: fetched} = useEvaluatorConfigs({})
    const configs = cached && cached.length ? cached : fetched

    return useMemo(() => {
        if (!evaluator || !Array.isArray(configs) || configs.length === 0) {
            return {label: undefined, color: undefined}
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

        if (!match) return {label: undefined, color: undefined}

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
            const label = (EVALUATOR_CATEGORY_LABEL_MAP as any)[slugified]
            if (label) return {label, color: (match as any)?.color}
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
            if ((EVALUATOR_CATEGORY_LABEL_MAP as any)[token]) {
                return {
                    label: (EVALUATOR_CATEGORY_LABEL_MAP as any)[token],
                    color: (match as any)?.color,
                }
            }
            // token may contain category slug as substring
            const found = categorySlugs.find((slug) => token.includes(slug))
            if (found) {
                return {
                    label: (EVALUATOR_CATEGORY_LABEL_MAP as any)[found],
                    color: (match as any)?.color,
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
            groq: "ai_llm",
        }

        for (const token of keyTokens) {
            const cat = keywordToCategory[token]
            if (cat && (EVALUATOR_CATEGORY_LABEL_MAP as any)[cat]) {
                return {
                    label: (EVALUATOR_CATEGORY_LABEL_MAP as any)[cat],
                    color: (match as any)?.color,
                }
            }
        }

        // 3) No category determinable from config; return color only
        return {label: undefined, color: (match as any)?.color}
    }, [evaluator, configs])
}
