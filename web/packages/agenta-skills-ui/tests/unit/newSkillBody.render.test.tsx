/**
 * The new skill view: "Create skill" stays off until the name and the text are valid; Create adds
 * the skill to the registry and hands the agent its reference; a failed create keeps the text and
 * says why; an upload with no SKILL.md says so.
 */
import {act, createElement} from "react"

import {ViewFormActions, ViewStackHost, useViewStack, type ViewChromeProps} from "@agenta/ui/view-stack"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {NewSkillBody, type NewSkillStart} from "../../src/NewSkillBody"

const {createSkillWorkflow} = vi.hoisted(() => ({createSkillWorkflow: vi.fn()}))

vi.mock("@agenta/skills", async (original) => ({
    ...(await original<object>()),
    createSkillWorkflow,
}))
vi.mock("@agenta/skills/state", () => ({invalidateSkillsListCache: vi.fn()}))
// The editor is the skill editor's; here a button fills it with a valid skill.
vi.mock("@agenta/entity-ui/drill-in", async (original) => ({
    ...(await original<object>()),
    SkillFormView: ({onChange}: {onChange: (v: Record<string, unknown>) => void}) =>
        createElement(
            "button",
            {
                onClick: () =>
                    onChange({name: "refund-check", description: "Checks refunds", body: "# Steps"}),
            },
            "fill",
        ),
}))

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        {crumbs.map((crumb, i) => (
            <span key={i}>{`crumb:${crumb.title}`}</span>
        ))}
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const onCreated = vi.fn()

const Opener = ({start}: {start?: NewSkillStart}) => {
    const stack = useViewStack()
    return (
        <button
            onClick={() =>
                void stack.open(
                    {
                        id: "test.new",
                        apply: "on_save",
                        Component: () => <NewSkillBody start={start} onCreated={onCreated} />,
                    },
                    {},
                    {kind: "project"},
                )
            }
        >
            open
        </button>
    )
}

const byText = (text: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>("button, span, div")].find(
        (node) =>
            (node.textContent ?? "").trim() === text &&
            ![...node.children].some((child) => (child.textContent ?? "").trim() === text),
    )

const waitFor = async (check: () => void) => {
    const start = Date.now()
    for (;;) {
        try {
            check()
            return
        } catch (error) {
            if (Date.now() - start > 3000) throw error
            await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
        }
    }
}

const click = async (element: Element | undefined) => {
    if (!element) throw new Error("no element")
    await act(async () => (element as HTMLElement).click())
}

let root: Root
let host: HTMLDivElement

const open = async (start?: NewSkillStart) => {
    await act(async () =>
        root.render(
            <ViewStackHost chrome={Chrome} rootTitle="Agent">
                <Opener start={start} />
            </ViewStackHost>,
        ),
    )
    await click(byText("open"))
}

const createButton = () => byText("Create skill") as HTMLButtonElement | undefined

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    onCreated.mockReset()
    createSkillWorkflow.mockReset()
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("new skill", () => {
    it("shows the three ways with the agent line", async () => {
        await open()
        await waitFor(() => expect(byText("Write from scratch")).toBeTruthy())
        expect(byText("Upload")).toBeTruthy()
        expect(byText("Import from a repo")).toBeTruthy()
        expect(byText("The new skill is added to your skill registry and to this agent.")).toBeTruthy()
        expect(byText("crumb:New skill")).toBeTruthy()
    })

    it("Create skill is off until the skill is valid, then adds it to the registry and the agent", async () => {
        createSkillWorkflow.mockResolvedValue({slug: "refund-check-7c1d", workflowId: "wf-1"})
        await open()
        await waitFor(() => expect(byText("Write from scratch")).toBeTruthy())
        await click(byText("Write from scratch"))
        await waitFor(() => expect(byText("Not saved yet")).toBeTruthy())
        expect(byText("crumb:New skill › Write")).toBeTruthy()
        expect(createButton()?.disabled).toBe(true)
        await click(byText("fill"))
        await waitFor(() => expect(createButton()?.disabled).toBe(false))
        await click(createButton())
        await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
        const [entries] = onCreated.mock.calls[0] as [Record<string, unknown>[]]
        expect(entries[0].name).toBe("refund-check")
        expect(JSON.stringify(entries[0])).toContain("refund-check-7c1d")
    })

    it("a failed create says why and keeps the text", async () => {
        createSkillWorkflow.mockRejectedValue(new Error("name taken"))
        await open({step: "write"})
        await click(byText("fill"))
        await waitFor(() => expect(createButton()?.disabled).toBe(false))
        await click(createButton())
        await waitFor(() => expect(byText("Create failed: name taken")).toBeTruthy())
        expect(onCreated).not.toHaveBeenCalled()
        expect(createButton()?.disabled).toBe(false)
    })

    it("an upload with no SKILL.md says so", async () => {
        await open({step: "upload", scan: Promise.resolve({candidates: [], fileCount: 0})})
        await waitFor(() => expect(byText("No SKILL.md found in the upload.")).toBeTruthy())
    })
})
