/**
 * Shared utilities for filtering and displaying evaluator templates.
 * Used by both SelectEvaluatorModalContent and EvaluatorTemplateDropdown.
 *
 * Supports both catalog templates (EvaluatorCatalogTemplate with `categories`)
 * and legacy EvaluatorPreview/Evaluator types (with `tags`).
 */

import type {EvaluatorCatalogTemplate, Workflow} from "@agenta/entities/workflow"

import {capitalize} from "@/oss/lib/helpers/utils"
import {isDemo} from "@/oss/lib/helpers/utils"

import type {EvaluatorPreview} from "./types"

/**
 * Union type for items accepted by filtering utilities.
 * Supports catalog templates, Workflow entities, and legacy EvaluatorPreview.
 */
export type FilterableEvaluator = EvaluatorCatalogTemplate | Workflow | EvaluatorPreview

/**
 * Evaluator template keys supported in the "Create new evaluator" picker flow.
 *
 * This is NOT equivalent to `archived: false` — some templates may be
 * non-archived in the backend but not supported for creation in this UI flow
 * (e.g., `field_match_test` is archived in the backend registry but was
 * historically included here).
 *
 * After the evaluator key consolidation (see docs/designs/runnables/managed-workflows.md),
 * these keys will be replaced by canonical family keys: match, code, hook, prompt, agent.
 * See docs/designs/runnables/frontend/evaluator-key-dependencies.md for details.
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
 * Tailwind CSS class mappings for evaluator category badges.
 * Each category has a distinct color scheme.
 */
export const TAG_CLASSNAME_MAP: Record<string, string> = {
    rag: "bg-sky-100 text-sky-700",
    classifiers: "bg-orange-100 text-orange-700",
    similarity: "bg-blue-100 text-blue-700",
    ai_llm: "bg-violet-100 text-violet-700",
    functional: "bg-amber-100 text-amber-700",
}

/**
 * Default category styling when no specific mapping exists.
 */
export const DEFAULT_TAG_CLASSNAME = "bg-slate-100 text-slate-700"

/**
 * Returns the base evaluator category options for tab filtering.
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
 * Extracts category/tag values from an evaluator object.
 *
 * For catalog templates: reads `categories` array.
 * For legacy types: reads `tags`, `flags.tags`, and `meta.tags`.
 * All values are normalized to lowercase strings.
 */
export const getEvaluatorTagValues = (item: FilterableEvaluator): string[] => {
    const registry = new Set<string>()

    // Catalog templates use `categories`
    const categories = (item as EvaluatorCatalogTemplate).categories
    if (Array.isArray(categories)) {
        categories.filter(Boolean).forEach((cat) => {
            registry.add(String(cat).toLowerCase())
        })
    }

    // Legacy Evaluator type uses `tags`
    const legacyTags = (item as Evaluator).tags
    if (Array.isArray(legacyTags)) {
        legacyTags.filter(Boolean).forEach((tag) => {
            registry.add(String(tag).toLowerCase())
        })
    }

    // Fall back to metadata tags (EvaluatorPreview has flags/meta)
    const itemAny = item as any
    const rawTags = [
        ...(Array.isArray(itemAny.flags?.tags) ? itemAny.flags.tags : []),
        ...(Array.isArray(itemAny.meta?.tags) ? itemAny.meta.tags : []),
    ].filter(Boolean)

    rawTags.forEach((tag) => registry.add(String(tag).toLowerCase()))

    return Array.from(registry)
}

/**
 * Gets the CSS class name for an evaluator's primary category badge.
 */
export const getEvaluatorTagClassName = (item: FilterableEvaluator): string => {
    const primaryTag = getEvaluatorTagValues(item)[0]
    return primaryTag
        ? TAG_CLASSNAME_MAP[primaryTag] || DEFAULT_TAG_CLASSNAME
        : DEFAULT_TAG_CLASSNAME
}

/**
 * Filters evaluators to only include templates ready for users.
 *
 * Uses `flags.is_recommended` from the catalog when available.
 * Falls back to the legacy ENABLED_EVALUATORS allowlist + !archived check.
 */
export const filterEnabledEvaluators = <T extends Record<string, unknown>>(
    evaluators: T[],
): T[] => {
    return evaluators.filter((item) => {
        const key = (item as any)?.key as string | undefined
        if (!key) return false
        if ((item as any)?.archived) return false

        // If catalog explicitly recommends, include regardless of allowlist
        const flags = (item as any)?.flags as Record<string, unknown> | undefined
        if (flags?.is_recommended === true) return true

        // Otherwise use the curated allowlist
        return (ENABLED_EVALUATORS as readonly string[]).includes(key)
    })
}

/**
 * Filters evaluators by a specific category.
 *
 * @param evaluators - Array of evaluator objects
 * @param category - Category value to filter by (or DEFAULT_TAB_KEY for all)
 * @returns Filtered array of evaluators matching the category
 */
export const filterEvaluatorsByTag = <T extends FilterableEvaluator>(
    evaluators: T[],
    category: string,
): T[] => {
    if (category === DEFAULT_TAB_KEY) {
        return evaluators
    }

    return evaluators.filter((item) => {
        const tags = getEvaluatorTagValues(item)
        return tags.includes(category)
    })
}

/**
 * Builds tab items for the evaluator filter tabs.
 * Only includes categories that have at least one evaluator.
 */
export const buildEvaluatorTabItems = (
    evaluators: FilterableEvaluator[],
): {key: string; label: string}[] => {
    const items: {key: string; label: string}[] = [{key: DEFAULT_TAB_KEY, label: "All templates"}]

    const enabledEvaluators = filterEnabledEvaluators(evaluators)

    // Create a set of categories that actually have evaluators
    const categoriesWithEvaluators = new Set<string>()
    enabledEvaluators.forEach((item) => {
        getEvaluatorTagValues(item).forEach((tag) => {
            categoriesWithEvaluators.add(tag)
        })
    })

    // Build available categories map
    const baseTags = getEvaluatorTags()
    const availableCategories = new Map<string, string>()

    baseTags.forEach((tag) => {
        availableCategories.set(tag.value, tag.label)
    })

    // Add any additional categories found in evaluators
    evaluators.forEach((item) => {
        getEvaluatorTagValues(item).forEach((tag) => {
            if (!availableCategories.has(tag)) {
                availableCategories.set(tag, capitalize(tag.replace(/[_-]+/g, " ")))
            }
        })
    })

    // Only add tabs for categories that have evaluators
    availableCategories.forEach((label, value) => {
        if (categoriesWithEvaluators.has(value)) {
            items.push({key: value, label})
        }
    })

    return items
}
