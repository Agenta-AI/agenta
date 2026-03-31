/**
 * Shared utilities for filtering and displaying evaluator templates.
 * Used by both SelectEvaluatorModalContent and EvaluatorTemplateDropdown.
 */

import {capitalize} from "@/oss/lib/helpers/utils"
import {isDemo} from "@/oss/lib/helpers/utils"
import type {Evaluator} from "@/oss/lib/Types"

import type {EvaluatorPreview} from "./types"

/**
 * Whitelist of evaluator template keys that can be used for creating new evaluator configs.
 * These are the "blessed" evaluator types shown in the UI.
 */
export const ENABLED_EVALUATORS = [
    "auto_exact_match",
    "auto_contains_json",
    "auto_similarity_match",
    "auto_semantic_similarity",
    "auto_regex_test",
    "field_match_test",
    "json_multi_field_match",
    "auto_json_diff",
    "auto_ai_critique",
    "auto_custom_code_run",
    "auto_webhook_test",
    "auto_levenshtein_distance",
] as const

export type EnabledEvaluatorKey = (typeof ENABLED_EVALUATORS)[number]

/**
 * Default tab key for the "All templates" filter.
 */
export const DEFAULT_TAB_KEY = "all"

/**
 * Tailwind CSS class mappings for evaluator tag badges.
 * Each tag category has a distinct color scheme.
 */
export const TAG_CLASSNAME_MAP: Record<string, string> = {
    rag: "bg-sky-100 text-sky-700",
    classifiers: "bg-orange-100 text-orange-700",
    similarity: "bg-blue-100 text-blue-700",
    ai_llm: "bg-violet-100 text-violet-700",
    functional: "bg-amber-100 text-amber-700",
}

/**
 * Default tag styling when no specific mapping exists.
 */
export const DEFAULT_TAG_CLASSNAME = "bg-slate-100 text-slate-700"

/**
 * Returns the base evaluator tag options for tab filtering.
 * The list varies based on whether we're in demo mode.
 */
export const getEvaluatorTags = () => {
    const evaluatorTags = [
        {label: "AI / LLM", value: "ai_llm"},
        {label: "Classifiers", value: "classifiers"},
        {label: "Similarity", value: "similarity"},
        {label: "Custom", value: "custom"},
    ]

    if (isDemo()) {
        evaluatorTags.unshift({label: "RAG", value: "rag"})
    }

    return evaluatorTags
}

/**
 * Extracts tag values from an evaluator object.
 * Tags can come from multiple sources: explicit tags array, flags.tags, or meta.tags.
 * All values are normalized to lowercase strings.
 *
 * @param item - Evaluator or EvaluatorPreview object
 * @returns Array of unique lowercase tag strings
 */
export const getEvaluatorTagValues = (item: EvaluatorPreview | Evaluator): string[] => {
    const registry = new Set<string>()

    // Prefer explicit evaluator tags when available
    const primaryTags = Array.isArray((item as Evaluator).tags) ? (item as Evaluator).tags : []
    primaryTags.filter(Boolean).forEach((tag) => {
        registry.add(String(tag).toLowerCase())
    })

    // Fall back to metadata tags (EvaluatorPreview has flags/meta, Evaluator doesn't)
    const itemAny = item as any
    const rawTags = [
        ...(Array.isArray(itemAny.flags?.tags) ? itemAny.flags.tags : []),
        ...(Array.isArray(itemAny.meta?.tags) ? itemAny.meta.tags : []),
    ].filter(Boolean)

    rawTags.forEach((tag) => registry.add(String(tag).toLowerCase()))

    return Array.from(registry)
}

/**
 * Gets the CSS class name for an evaluator's primary tag badge.
 *
 * @param item - Evaluator or EvaluatorPreview object
 * @returns Tailwind CSS class string for the badge
 */
export const getEvaluatorTagClassName = (item: EvaluatorPreview | Evaluator): string => {
    const primaryTag = getEvaluatorTagValues(item)[0]
    return primaryTag
        ? TAG_CLASSNAME_MAP[primaryTag] || DEFAULT_TAG_CLASSNAME
        : DEFAULT_TAG_CLASSNAME
}

/**
 * Filters evaluators to only include enabled templates.
 *
 * @param evaluators - Array of evaluator objects
 * @returns Filtered array containing only enabled evaluators
 */
export const filterEnabledEvaluators = <T extends {key?: string}>(evaluators: T[]): T[] => {
    return evaluators.filter((item) => item.key && ENABLED_EVALUATORS.includes(item.key as any))
}

/**
 * Filters evaluators by a specific tag.
 *
 * @param evaluators - Array of evaluator objects
 * @param tag - Tag value to filter by (or DEFAULT_TAB_KEY for all)
 * @returns Filtered array of evaluators matching the tag
 */
export const filterEvaluatorsByTag = <T extends EvaluatorPreview | Evaluator>(
    evaluators: T[],
    tag: string,
): T[] => {
    if (tag === DEFAULT_TAB_KEY) {
        return evaluators
    }

    return evaluators.filter((item) => {
        const tags = getEvaluatorTagValues(item)
        return tags.includes(tag)
    })
}

/**
 * Builds tab items for the evaluator filter tabs.
 * Only includes tags that have at least one enabled evaluator.
 *
 * @param evaluators - Array of evaluator objects (should be non-archived)
 * @returns Array of tab items with key and label
 */
export const buildEvaluatorTabItems = (
    evaluators: (EvaluatorPreview | Evaluator)[],
): {key: string; label: string}[] => {
    const items: {key: string; label: string}[] = [{key: DEFAULT_TAB_KEY, label: "All templates"}]

    const enabledEvaluators = filterEnabledEvaluators(evaluators)

    // Create a set of tags that actually have evaluators
    const tagsWithEvaluators = new Set<string>()
    enabledEvaluators.forEach((item) => {
        getEvaluatorTagValues(item).forEach((tag) => {
            tagsWithEvaluators.add(tag)
        })
    })

    // Build available tags map
    const baseTags = getEvaluatorTags()
    const availableTags = new Map<string, string>()

    baseTags.forEach((tag) => {
        availableTags.set(tag.value, tag.label)
    })

    // Add any additional tags found in evaluators
    evaluators.forEach((item) => {
        getEvaluatorTagValues(item).forEach((tag) => {
            if (!availableTags.has(tag)) {
                availableTags.set(tag, capitalize(tag.replace(/[_-]+/g, " ")))
            }
        })
    })

    // Only add tabs for tags that have evaluators
    availableTags.forEach((label, value) => {
        if (tagsWithEvaluators.has(value)) {
            items.push({key: value, label})
        }
    })

    return items
}
