import {describe, expect, it} from "vitest"

import type {EvaluatorCatalogTemplate} from "../../src/workflow/api/templates"
import {
    ALL_EVALUATOR_TEMPLATES_TAB,
    buildEvaluatorTemplateTabs,
    filterEvaluatorTemplates,
    selectCreatableEvaluatorTemplates,
} from "../../src/workflow/core/evaluatorTemplateCatalog"

const template = (
    key: string,
    categories: string[],
    extra: Partial<EvaluatorCatalogTemplate> = {},
): EvaluatorCatalogTemplate => ({key, name: key, description: `About ${key}`, categories, ...extra})

// The catalog as the API returns it: internal entries first, then the user templates.
const catalog = [
    template("feedback", []),
    template("mock", ["custom"]),
    template("echo", ["builtin"]),
    template("auto_exact_match", ["classifiers"], {name: "Exact Match"}),
    template("auto_regex_test", ["classifiers"], {name: "Regex Test"}),
    template("auto_webhook_test", ["custom"], {name: "Webhook test"}),
    template("auto_ai_critique", ["ai_llm"], {
        name: "LLM-as-a-judge",
        description: "Uses a model to grade the output",
    }),
    template("auto_levenshtein_distance", ["similarity"], {name: "Levenshtein Distance"}),
]

describe("selectCreatableEvaluatorTemplates", () => {
    it("offers the user templates and leaves out the internal catalog entries", () => {
        expect(selectCreatableEvaluatorTemplates(catalog).map((t) => t.key)).toEqual([
            "auto_exact_match",
            "auto_regex_test",
            "auto_webhook_test",
            "auto_ai_critique",
            "auto_levenshtein_distance",
        ])
    })

    it("offers a recommended template outside the list and hides an archived one", () => {
        const result = selectCreatableEvaluatorTemplates([
            template("rag_faithfulness", ["rag"], {flags: {is_recommended: true}}),
            template("auto_exact_match", ["classifiers"], {archived: true}),
        ])
        expect(result.map((t) => t.key)).toEqual(["rag_faithfulness"])
    })
})

describe("buildEvaluatorTemplateTabs", () => {
    it("lists every used category in the fixed order after All templates", () => {
        expect(buildEvaluatorTemplateTabs(catalog)).toEqual([
            {key: ALL_EVALUATOR_TEMPLATES_TAB, label: "All templates"},
            {key: "ai_llm", label: "AI / LLM"},
            {key: "classifiers", label: "Classifiers"},
            {key: "similarity", label: "Similarity"},
            {key: "custom", label: "Custom"},
        ])
    })

    it("adds an unknown category of a creatable template with a readable label", () => {
        const tabs = buildEvaluatorTemplateTabs([
            template("rag_faithfulness", ["rag_checks"], {flags: {is_recommended: true}}),
        ])
        expect(tabs.map((tab) => tab.label)).toEqual(["All templates", "Rag checks"])
    })

    it("has no tab for a category only internal entries use", () => {
        const keys = buildEvaluatorTemplateTabs(catalog).map((tab) => tab.key)
        expect(keys).not.toContain("builtin")
    })
})

describe("filterEvaluatorTemplates", () => {
    const creatable = selectCreatableEvaluatorTemplates(catalog)

    it("keeps one category in its tab", () => {
        const result = filterEvaluatorTemplates(creatable, {tab: "classifiers", search: ""})
        expect(result.map((t) => t.key)).toEqual(["auto_exact_match", "auto_regex_test"])
    })

    it("matches the search in the name, the description and the category label", () => {
        const byName = filterEvaluatorTemplates(creatable, {tab: "all", search: "regex"})
        const byDescription = filterEvaluatorTemplates(creatable, {tab: "all", search: "GRADE"})
        const byCategory = filterEvaluatorTemplates(creatable, {tab: "all", search: "similar"})
        expect(byName.map((t) => t.key)).toEqual(["auto_regex_test"])
        expect(byDescription.map((t) => t.key)).toEqual(["auto_ai_critique"])
        expect(byCategory.map((t) => t.key)).toEqual(["auto_levenshtein_distance"])
    })
})
