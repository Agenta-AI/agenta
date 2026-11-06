// @vitest-environment jsdom
// The human evaluator create and edit sheet, with the real save atoms. Only HTTP is faked.
import {act, createElement} from "react"

import type {EvaluatorEntry} from "@agenta/entities/workflow"
import {setProjectIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {HumanEvaluatorSheet} from "@/features/evaluators/human/HumanEvaluatorSheet"

import {WithQueryClient} from "../support/queryClient"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const http = vi.hoisted(() => ({
    post: vi.fn(),
    put: vi.fn(),
    get: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: {post: http.post, put: http.put, get: http.get},
    getAgentaApiUrl: () => "http://api.test",
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: http.success, error: http.error}}))

let host: HTMLDivElement
let root: Root
const onClose = vi.fn()

const flush = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const mount = async (editing: EvaluatorEntry | null) => {
    const store = createStore()
    store.set(setProjectIdAtom, "pr")
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    WithQueryClient,
                    null,
                    createElement(HumanEvaluatorSheet, {open: true, editing, onClose}),
                ),
            ),
        )
    })
    await flush()
}

const byLabel = (label: string) => {
    const element = [...document.querySelectorAll("label")].find(
        (item) => item.textContent?.replace("*", "").trim() === label,
    )
    const id = element?.getAttribute("for")
    return (id ? document.getElementById(id) : null) as HTMLInputElement
}

const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(input) as object,
            "value",
        )?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const button = (text: string) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === text) as
        | HTMLButtonElement
        | undefined

const click = async (element: Element | undefined) => {
    await act(async () => {
        ;(element as HTMLElement).click()
    })
    await flush()
}

// Radix Select opens from the keyboard in jsdom; an option is picked with Enter.
const pick = async (trigger: Element, label: string) => {
    await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })
    const option = [...document.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent === label,
    )
    await act(async () => {
        option?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    })
    await flush()
}

const submit = async () => {
    await act(async () => {
        document.querySelector("form")?.requestSubmit()
    })
    await flush()
    await flush()
}

class NoResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
}

beforeEach(() => {
    globalThis.ResizeObserver ??= NoResizeObserver
    Element.prototype.scrollIntoView ??= () => undefined
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.scrollTo ??= () => undefined
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/workflows/"))
            return {data: {workflow: {id: "w-new", slug: "answer-quality"}}}
        if (url.endsWith("/workflows/variants/"))
            return {data: {workflow_variant: {id: "v-new", workflow_id: "w-new"}}}
        return {data: {workflow_revision: {id: "r-new", workflow_id: "w-new"}}}
    })
    http.put.mockResolvedValue({data: {workflow: {id: "w1"}}})
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("HumanEvaluatorSheet", () => {
    it("creates a human evaluator with the feedback fields as its outputs schema", async () => {
        await mount(null)
        await type(byLabel("Evaluator name"), "Answer quality")
        expect(byLabel("Evaluator slug").value).toBe("answer-quality")
        await type(byLabel("Feedback name"), "score")
        await pick(
            document.querySelector('[aria-label="Feedback type"]') as Element,
            "Integer (Discrete)",
        )
        await type(byLabel("Minimum"), "1")
        await type(byLabel("Maximum"), "5")
        await submit()

        const workflowCall = http.post.mock.calls.find(([url]) =>
            String(url).endsWith("/workflows/"),
        )
        expect(workflowCall?.[1]).toEqual({
            workflow: {
                slug: "answer-quality",
                name: "Answer quality",
                description: undefined,
                flags: {is_evaluator: true},
                tags: undefined,
                meta: undefined,
            },
        })
        const dataCommit = http.post.mock.calls.find(
            ([url, body]) =>
                String(url).endsWith("/workflows/revisions/commit") &&
                (body as {workflow_revision: {data?: unknown}}).workflow_revision.data,
        )
        expect(
            (dataCommit?.[1] as {workflow_revision: {data: unknown}}).workflow_revision.data,
        ).toEqual({
            uri: "agenta:custom:feedback:v0",
            schemas: {
                outputs: {
                    type: "object",
                    properties: {score: {type: "integer", minimum: 1, maximum: 5}},
                    required: ["score"],
                },
            },
        })
        expect(http.success).toHaveBeenCalledWith("Evaluator created")
        expect(onClose).toHaveBeenCalled()
    })

    it("shows the errors and sends nothing while the form is incomplete", async () => {
        await mount(null)
        await submit()
        expect(document.body.textContent).toContain("Enter a name.")
        expect(document.body.textContent).toContain("Pick a feedback type.")
        expect(http.post).not.toHaveBeenCalled()
    })

    it("puts a taken slug under the slug field", async () => {
        http.post.mockRejectedValueOnce({response: {status: 409}})
        await mount(null)
        await type(byLabel("Evaluator name"), "Answer quality")
        await type(byLabel("Feedback name"), "approved")
        await pick(
            document.querySelector('[aria-label="Feedback type"]') as Element,
            "Boolean (True/False)",
        )
        await submit()
        expect(document.body.textContent).toContain("An evaluator with this slug exists.")
        expect(onClose).not.toHaveBeenCalled()
    })

    it("edits an evaluator: the form is filled, Update waits for a change, the save commits a revision", async () => {
        const entry = {
            workflow: {
                id: "w1",
                name: "Helpfulness",
                slug: "helpfulness",
                description: "",
                meta: {owner: "team"},
                tags: {area: "support"},
            },
            latestRevision: {
                id: "r2",
                workflow_variant_id: "v1",
                data: {
                    uri: "agenta:custom:feedback:v0",
                    schemas: {
                        outputs: {
                            type: "object",
                            properties: {score: {type: "integer", minimum: 1, maximum: 5}},
                            required: ["score"],
                        },
                    },
                },
            },
        } as unknown as EvaluatorEntry
        await mount(entry)
        expect(byLabel("Evaluator name").value).toBe("Helpfulness")
        expect(byLabel("Evaluator name").disabled).toBe(true)
        expect(byLabel("Feedback name").value).toBe("score")
        expect(button("Update")?.disabled).toBe(true)

        await click(button("Add feedback"))
        const names = [...document.querySelectorAll("label")]
            .filter((item) => item.textContent?.includes("Feedback name"))
            .map(
                (item) =>
                    document.getElementById(item.getAttribute("for") ?? "") as HTMLInputElement,
            )
        await type(names[1], "comment")
        const triggers = document.querySelectorAll('[aria-label="Feedback type"]')
        await pick(triggers[1], "String (Free note)")
        expect(button("Update")?.disabled).toBe(false)
        await submit()

        expect(http.put).toHaveBeenCalledWith(
            "http://api.test/workflows/w1",
            {
                workflow: {
                    id: "w1",
                    name: "Helpfulness",
                    description: "",
                    flags: {is_evaluator: true},
                    tags: {area: "support"},
                    meta: {owner: "team"},
                },
            },
            {params: {project_id: "pr"}},
        )
        const commit = http.post.mock.calls.find(([url]) =>
            String(url).endsWith("/workflows/revisions/commit"),
        )
        expect(commit?.[1]).toMatchObject({
            workflow_revision: {
                workflow_id: "w1",
                workflow_variant_id: "v1",
                data: {
                    uri: "agenta:custom:feedback:v0",
                    schemas: {
                        outputs: {
                            properties: {
                                score: {type: "integer", minimum: 1, maximum: 5},
                                comment: {type: "string"},
                            },
                            required: ["score", "comment"],
                        },
                    },
                },
            },
        })
        expect(http.success).toHaveBeenCalledWith("Evaluator updated")
    })
})
