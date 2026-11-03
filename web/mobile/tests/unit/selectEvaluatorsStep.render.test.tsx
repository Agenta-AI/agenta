// @vitest-environment jsdom
/**
 * The Select Evaluators step of the trace annotate sheet, and the selection it keeps per project
 * in local storage (the same key the old app uses).
 */
import {act, useState} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next/link", () => ({
    default: ({href, children}: {href: string; children: React.ReactNode}) => (
        <a href={href}>{children}</a>
    ),
}))

import {SelectEvaluatorsStep} from "@/features/observability/annotate/SelectEvaluatorsStep"
import {useAnnotateEvaluatorSelection} from "@/features/observability/annotate/useAnnotateEvaluatorSelection"

const EVALUATORS = [
    {id: "wf-tone", slug: "tone", name: "Tone check", description: "How friendly the reply is"},
    {id: "wf-facts", slug: "facts", name: "Fact check", description: "Whether the facts hold"},
] as Workflow[]

let host: HTMLDivElement
let root: Root

const render = async (node: React.ReactNode) => {
    await act(async () => root.render(node))
}
const rows = () =>
    Array.from(host.querySelectorAll("[data-testid=evaluator-row]")).map((row) => row.textContent)
const checkbox = (name: string) =>
    host.querySelector<HTMLButtonElement>(`[role=checkbox][aria-label="${name}"]`)

const typeSearch = async (value: string) => {
    const input = host.querySelector<HTMLInputElement>("input[placeholder=Search]")
    if (!input) throw new Error("no search box")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const Step = (props: {
    evaluators?: Workflow[]
    isLoading?: boolean
    lockedSlugs?: string[]
    evaluatorsHref?: string | null
}) => {
    const [selected, setSelected] = useState<string[]>([])
    return (
        <SelectEvaluatorsStep
            evaluators={props.evaluators ?? EVALUATORS}
            isLoading={props.isLoading ?? false}
            selected={selected}
            lockedSlugs={props.lockedSlugs ?? []}
            onChange={setSelected}
            evaluatorsHref={props.evaluatorsHref ?? null}
        />
    )
}

beforeEach(() => {
    window.localStorage.clear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
})

describe("select evaluators step", () => {
    it("Search filters evaluators by name", async () => {
        await render(<Step />)
        expect(rows()).toHaveLength(2)

        await typeSearch("FACT")

        expect(rows()).toEqual([expect.stringContaining("Fact check")])
        expect(rows()[0]).toContain("Metric")

        await typeSearch("nothing like this")
        expect(host.textContent).toContain("No results found")
    })

    it("An evaluator with an own annotation is checked and disabled", async () => {
        await render(<Step lockedSlugs={["tone"]} />)

        const tone = checkbox("Tone check")
        expect(tone?.getAttribute("data-state")).toBe("checked")
        expect(tone?.disabled).toBe(true)
        expect(checkbox("Fact check")?.disabled).toBe(false)
    })

    it("Checking a row selects its evaluator", async () => {
        await render(<Step />)
        await act(async () => checkbox("Fact check")?.click())

        expect(checkbox("Fact check")?.getAttribute("data-state")).toBe("checked")
    })

    it("No evaluators shows There are no available evaluators", async () => {
        await render(<Step evaluators={[]} />)
        expect(host.textContent).toContain("There are no available evaluators")
        expect(host.querySelector("a")).toBeNull()

        await render(<Step evaluators={[]} evaluatorsHref="/w/ws-1/p/p-1/evaluators?tab=human" />)
        expect(host.querySelector("a")?.textContent).toBe("Open evaluators")
    })

    it("Loading shows a skeleton list", async () => {
        await render(<Step evaluators={[]} isLoading />)
        expect(host.querySelector("[aria-label='Loading evaluators']")).not.toBeNull()
        expect(host.textContent).not.toContain("There are no available evaluators")
    })
})

describe("annotate evaluator selection", () => {
    let latest: ReturnType<typeof useAnnotateEvaluatorSelection>
    const Probe = ({projectId}: {projectId: string}) => {
        latest = useAnnotateEvaluatorSelection(projectId)
        return null
    }

    it("The selection survives a reopen through localStorage", async () => {
        await render(<Probe projectId="project-1" />)
        expect(latest.selected).toEqual([])
        await act(async () => latest.setSelected(["tone"]))
        expect(window.localStorage.getItem("project-1-evaluator")).toBe('["tone"]')

        await act(async () => root.unmount())
        root = createRoot(host)
        await render(<Probe projectId="project-1" />)
        expect(latest.selected).toEqual(["tone"])
    })

    it("A blocked localStorage gives an empty selection without an error", async () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked")
        })
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked")
        })

        await render(<Probe projectId="project-1" />)
        expect(latest.selected).toEqual([])
        await act(async () => latest.setSelected(["facts"]))
        expect(latest.selected).toEqual(["facts"])
    })

    it("A stored value that is not a list of names gives an empty selection", async () => {
        window.localStorage.setItem("project-1-evaluator", '{"tone": true}')
        await render(<Probe projectId="project-1" />)
        expect(latest.selected).toEqual([])
    })
})
