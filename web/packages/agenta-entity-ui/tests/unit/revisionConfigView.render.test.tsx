/**
 * The read-only configuration pane of the revision drawer (A10 to A12).
 *
 * The drill-in config section is replaced by a stub that records its props: what is under test
 * is which view mode and which read-only flags the pane hands it, not the editor itself.
 */
import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {sectionProps, serverData} = vi.hoisted(() => ({
    sectionProps: [] as Record<string, unknown>[],
    serverData: new Map<string, unknown>(),
}))

vi.mock("../../src/DrillInView/components/PlaygroundConfigSection/adapters", () => ({
    defaultAdapter: {atoms: {serverData: (id: string) => serverData.get(id)}},
}))
vi.mock("../../src/DrillInView/components/PlaygroundConfigSection", () => ({
    default: (props: Record<string, unknown>) => {
        sectionProps.push(props)
        return <div data-testid="config-section" />
    },
}))

import {RevisionConfigView} from "../../src/variant/RevisionDrawer/RevisionConfigView"
import type {RevisionDrawerKind} from "../../src/variant/RevisionDrawer/types"

let host: HTMLDivElement
let root: Root

const render = async (kind: RevisionDrawerKind, revisionId = "rev-1") => {
    await act(async () => {
        root.render(
            <Provider store={createStore()}>
                <RevisionConfigView revisionId={revisionId} kind={kind} />
            </Provider>,
        )
    })
}

const lastProps = () => sectionProps[sectionProps.length - 1]
const radio = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("[role=radio]")].find(
        (b) => b.textContent === label,
    )

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    sectionProps.length = 0
    serverData.clear()
    serverData.set("rev-1", atom({parameters: {prompt: {messages: []}}}))
    serverData.set("rev-empty", atom({parameters: {}}))
    serverData.set("rev-code", atom({parameters: {}, code: {runtime: "python"}}))
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("RevisionConfigView", () => {
    it("The config view starts in JSON for deployments and Form otherwise", async () => {
        await render("deployment")
        expect(lastProps().viewMode).toBe("json")
        expect(radio("JSON")?.getAttribute("aria-checked")).toBe("true")
        for (const kind of ["variant", "evaluator"] as const) {
            await act(async () => root.unmount())
            root = createRoot(host)
            await render(kind)
            expect(lastProps().viewMode).toBe("form")
        }
    })

    it("Switching to YAML passes the yaml view mode", async () => {
        await render("variant")
        await act(async () => radio("YAML")?.click())
        expect(lastProps().viewMode).toBe("yaml")
    })

    it("The config view never writes to the revision", async () => {
        await render("variant")
        expect(lastProps()).toMatchObject({
            revisionId: "rev-1",
            disabled: true,
            useServerData: true,
        })
    })

    it("A revision without parameters shows No parameters to display", async () => {
        await render("variant", "rev-empty")
        expect(host.textContent).toContain("No parameters to display")
        expect(host.querySelector("[data-testid=config-section]")).toBeNull()
    })

    it("A code evaluator without parameters still shows its code", async () => {
        await render("evaluator", "rev-code")
        expect(host.querySelector("[data-testid=config-section]")).not.toBeNull()
    })
})
