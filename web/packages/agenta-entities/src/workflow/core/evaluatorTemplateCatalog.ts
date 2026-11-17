/**
 * Which evaluator templates a "Create evaluator" picker offers, and how it groups them.
 *
 * Pure rules over the catalog (`GET /evaluators/catalog/templates/`), shared by every surface
 * that creates an evaluator from a template.
 */

import type {EvaluatorCatalogTemplate} from "../api/templates"

/**
 * The templates a user can create from. The catalog also lists internal entries (`feedback`,
 * `hook`, `code`, `mock`, `match`, `llm`, `echo`); a template the catalog marks as recommended
 * is offered too.
 */
export const CREATABLE_EVALUATOR_TEMPLATE_KEYS: readonly string[] = [
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
]

/** The tab that shows every template. */
export const ALL_EVALUATOR_TEMPLATES_TAB = "all"

/** The known categories, in tab order, with their labels. */
const CATEGORY_LABELS: readonly {key: string; label: string}[] = [
    {key: "ai_llm", label: "AI / LLM"},
    {key: "classifiers", label: "Classifiers"},
    {key: "similarity", label: "Similarity"},
    {key: "custom", label: "Custom"},
]

export interface EvaluatorTemplateTab {
    key: string
    label: string
}

/** A template's categories, lower case. */
export const evaluatorTemplateCategories = (template: EvaluatorCatalogTemplate): string[] =>
    (template.categories ?? []).filter(Boolean).map((category) => String(category).toLowerCase())

/** The templates a user can create from, in catalog order. Archived templates are left out. */
export const selectCreatableEvaluatorTemplates = (
    templates: readonly EvaluatorCatalogTemplate[],
): EvaluatorCatalogTemplate[] =>
    templates.filter((template) => {
        if (!template.key || template.archived) return false
        if (template.flags?.is_recommended === true) return true
        return CREATABLE_EVALUATOR_TEMPLATE_KEYS.includes(template.key)
    })

const labelOf = (key: string): string => {
    const known = CATEGORY_LABELS.find((category) => category.key === key)
    if (known) return known.label
    const words = key.replace(/[_-]+/g, " ").trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * The picker tabs: "All templates", then each category that has a creatable template. Known
 * categories come first, in their fixed order; other categories follow in catalog order.
 */
export const buildEvaluatorTemplateTabs = (
    templates: readonly EvaluatorCatalogTemplate[],
): EvaluatorTemplateTab[] => {
    const used = new Set(
        selectCreatableEvaluatorTemplates(templates).flatMap(evaluatorTemplateCategories),
    )
    const known = CATEGORY_LABELS.filter((category) => used.has(category.key))
    const knownKeys = new Set(known.map((category) => category.key))
    const other = [...used]
        .filter((key) => !knownKeys.has(key))
        .map((key) => ({key, label: labelOf(key)}))
    return [{key: ALL_EVALUATOR_TEMPLATES_TAB, label: "All templates"}, ...known, ...other]
}

/**
 * The templates in one tab whose name, description or category matches the search. The search
 * ignores case; an empty search matches every template.
 */
export const filterEvaluatorTemplates = (
    templates: readonly EvaluatorCatalogTemplate[],
    {tab, search}: {tab: string; search: string},
): EvaluatorCatalogTemplate[] => {
    const term = search.trim().toLowerCase()
    return templates.filter((template) => {
        const categories = evaluatorTemplateCategories(template)
        if (tab !== ALL_EVALUATOR_TEMPLATES_TAB && !categories.includes(tab)) return false
        if (!term) return true
        return [template.name, template.description, ...categories.map(labelOf)]
            .filter(Boolean)
            .some((text) => String(text).toLowerCase().includes(term))
    })
}
