/**
 * Shared pieces of the playground run pane tests: a completion revision for a prompt, the HTTP
 * answers for the workflow queries, and the DOM helpers. The `vi.mock` calls stay in each test
 * file, because vitest hoists them there.
 */
import {act} from "react"

import {expect, vi} from "vitest"

export const completionRevision = (content: string) => ({
    id: "rev-1",
    version: 3,
    name: "default",
    workflow_id: "app-1",
    workflow_variant_id: "app-1-variant",
    flags: {is_application: true},
    created_at: "2026-11-01T00:00:00Z",
    data: {
        uri: "agenta:builtin:completion:v0",
        parameters: {
            prompt: {
                messages: [{role: "user", content}],
                llm_config: {model: "gpt-4o-mini"},
            },
        },
    },
})

/** Makes the mocked axios answer the two workflow queries the playground opens with. */
export const answerWorkflowQueries = (
    http: {post: {mockImplementation: (fn: (url: string) => Promise<unknown>) => unknown}},
    revision: ReturnType<typeof completionRevision>,
) =>
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/workflows/query")) {
            return {data: {count: 1, workflows: [{id: "app-1", name: "Capitals", flags: {}}]}}
        }
        if (url.endsWith("/workflows/revisions/query")) {
            return {data: {count: 1, workflow_revisions: [revision]}}
        }
        return {data: {}}
    })

export const settle = async () => {
    for (let i = 0; i < 12; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}

export const button = (scope: ParentNode, label: string) =>
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    )

export const click = async (scope: ParentNode, label: string) => {
    const target = button(scope, label)
    expect(target, `a button named ${label}`).toBeDefined()
    await act(async () => target!.click())
    await settle()
}

export const typeInto = async (field: HTMLTextAreaElement | HTMLInputElement, value: string) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!
    await act(async () => {
        setter.call(field, value)
        field.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

/** jsdom has no ResizeObserver, and the tooltip and menu primitives need one. */
export const stubResizeObserver = () =>
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe = () => undefined
            unobserve = () => undefined
            disconnect = () => undefined
        },
    )
