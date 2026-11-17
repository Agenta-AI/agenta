// @vitest-environment jsdom
// The "Create evaluator" template picker: every template, its tabs and its whole description.
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const catalog = vi.hoisted(() => ({
    state: {
        isPending: false,
        isError: false,
        data: {count: 0, templates: [] as unknown[]},
        refetch: () => undefined,
    },
}))

vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    return {
        ...(await original<object>()),
        evaluatorTemplatesQueryAtom: atom(() => catalog.state),
    }
})

import {EvaluatorTemplatePicker} from "@/features/evaluators/create/EvaluatorTemplatePicker"

const LONG =
    "Uses a model to grade the output against the criteria you write, and returns a score with a reason. Good for tone, helpfulness and correctness checks."

const template = (key: string, categories: string[], description = `About ${key}`) => ({
    key,
    name: key,
    description,
    categories,
})

const TEMPLATES = [
    template("feedback", []),
    template("echo", ["builtin"]),
    template("auto_exact_match", ["classifiers"]),
    template("auto_regex_test", ["classifiers"]),
    template("json_multi_field_match", ["classifiers"]),
    template("auto_webhook_test", ["custom"]),
    template("auto_custom_code_run", ["custom"]),
    template("auto_ai_critique", ["ai_llm"], LONG),
    template("auto_contains_json", ["classifiers"]),
    template("auto_json_diff", ["classifiers"]),
    template("auto_levenshtein_distance", ["similarity"]),
    template("auto_similarity_match", ["similarity"]),
    template("auto_semantic_similarity", ["similarity"]),
]

let host: HTMLDivElement
let root: Root
const onPick = vi.fn()

const mount = async (pendingKey: string | null = null) => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(EvaluatorTemplatePicker, {
                    open: true,
                    pendingKey,
                    onOpenChange: () => undefined,
                    onPick,
                }),
            ),
        )
    })
}

const tags = () =>
    [...document.querySelectorAll('[data-slot="template-name"]')].map((t) => t.textContent)
const tab = (label: string) =>
    [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent === label)

beforeEach(() => {
    catalog.state = {
        isPending: false,
        isError: false,
        data: {count: TEMPLATES.length, templates: TEMPLATES},
        refetch: () => undefined,
    }
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("EvaluatorTemplatePicker", () => {
    it("lists the 11 templates /w offers, with the whole description", async () => {
        await mount()
        expect(tags()).toHaveLength(11)
        expect(tags()).not.toContain("feedback")
        expect(tags()).not.toContain("echo")
        expect(document.body.textContent).toContain(LONG)
    })

    it("has one tab per category, all visible, and a tab shows its templates only", async () => {
        await mount()
        expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
            "All templates",
            "AI / LLM",
            "Classifiers",
            "Similarity",
            "Custom",
        ])
        await act(async () => {
            tab("Similarity")?.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}))
        })
        expect(tags()).toEqual([
            "auto_levenshtein_distance",
            "auto_similarity_match",
            "auto_semantic_similarity",
        ])
    })

    it("filters by search and picks the first match on Enter", async () => {
        await mount()
        const search = document.querySelector(
            'input[aria-label="Search templates"]',
        ) as HTMLInputElement
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(search, "grade")
            search.dispatchEvent(new Event("input", {bubbles: true}))
        })
        expect(tags()).toEqual(["auto_ai_critique"])
        await act(async () => {
            search.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })
        expect(onPick).toHaveBeenCalledWith(expect.objectContaining({key: "auto_ai_critique"}))
    })

    it("waits on a picked template: every row is disabled", async () => {
        await mount("auto_regex_test")
        const rows = [...document.querySelectorAll("li button")] as HTMLButtonElement[]
        expect(rows.every((row) => row.disabled)).toBe(true)
    })

    it("shows a retry when the catalog fails", async () => {
        catalog.state = {...catalog.state, isError: true}
        await mount()
        expect(document.body.textContent).toContain("Could not load templates")
    })
})
