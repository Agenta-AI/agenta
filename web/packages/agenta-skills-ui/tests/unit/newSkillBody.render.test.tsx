/**
 * The new skill view: "Create skill" stays off until the name and the text are valid; Create adds
 * the skill to the registry and hands the agent its reference; a failed create keeps the text and
 * says why; an upload with no SKILL.md says so.
 */
import {act, createElement} from "react"

import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {NewSkillBody, type NewSkillStart} from "../../src/NewSkillBody"

const {createSkillWorkflow, scanSkillSource, importSkillSource, querySkills} = vi.hoisted(() => ({
    createSkillWorkflow: vi.fn(),
    scanSkillSource: vi.fn(),
    importSkillSource: vi.fn(),
    querySkills: vi.fn(),
}))

vi.mock("@agenta/skills", async (original) => ({
    ...(await original<object>()),
    createSkillWorkflow,
    scanSkillSource,
    importSkillSource,
    querySkills,
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
                    onChange({
                        name: "refund-check",
                        description: "Checks refunds",
                        body: "# Steps",
                    }),
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
    scanSkillSource.mockReset()
    importSkillSource.mockReset()
    querySkills.mockReset()
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
        expect(
            byText("The new skill is added to your skill registry and to this agent."),
        ).toBeTruthy()
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

    it("an upload with several skills imports the picked ones and adds them to the agent", async () => {
        createSkillWorkflow
            .mockResolvedValueOnce({slug: "a-1", workflowId: "wf-a"})
            .mockResolvedValueOnce({slug: "b-1", workflowId: "wf-b"})
        const candidate = (name: string) => ({
            dir: name,
            skill: {name, description: `${name} skill`, body: "# Steps", files: []},
        })
        await open({
            step: "upload",
            scan: Promise.resolve({
                candidates: [candidate("alpha"), candidate("beta")],
                fileCount: 2,
            }),
        })
        await waitFor(() => expect(byText("Import 2 skills")).toBeTruthy())
        await click(byText("Import 2 skills"))
        await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
        const [entries] = onCreated.mock.calls[0] as [Record<string, unknown>[]]
        expect(entries.map((e) => e.name)).toEqual(["alpha", "beta"])
    })

    it("a repo import adds the imported skills to the agent by the slugs the import names", async () => {
        scanSkillSource.mockResolvedValue({
            already_imported_paths: ["skills/old"],
            scan: {
                candidates: [
                    {path_in_repo: "skills/old", valid: true, skill: {name: "old"}},
                    {path_in_repo: "skills/pdf", valid: true, skill: {name: "pdf-reader"}},
                    {path_in_repo: "skills/ref", valid: true, skill: {name: "refund-check"}},
                ],
            },
        })
        importSkillSource.mockResolvedValue({
            imported: [
                {
                    path_in_repo: "skills/pdf",
                    workflow_id: "wf-pdf",
                    workflow_slug: "pdf-reader-2b9e",
                    name: "pdf-reader",
                    description: "Reads PDF files.",
                },
                {
                    path_in_repo: "skills/ref",
                    workflow_id: "wf-ref",
                    workflow_slug: "refund-check-7c1d",
                    name: "refund-check",
                },
            ],
            skipped: [],
        })
        await open({step: "import"})
        const input = document.querySelector("input") as HTMLInputElement
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, "https://github.com/acme/agent-skills")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await click(byText("Scan"))
        await waitFor(() => expect(byText("Already imported")).toBeTruthy())
        expect(byText("Skills found · 3")).toBeTruthy()
        await click(byText("Import 2 skills"))
        await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
        const [entries] = onCreated.mock.calls[0] as [Record<string, unknown>[]]
        expect(entries).toHaveLength(2)
        expect(JSON.stringify(entries)).toContain("pdf-reader-2b9e")
        expect(JSON.stringify(entries)).toContain("refund-check-7c1d")
        // The import answer is enough: no registry lookup after it.
        expect(querySkills).not.toHaveBeenCalled()
    })

    it("an imported skill the answer gives no slug for is named as not added", async () => {
        scanSkillSource.mockResolvedValue({
            already_imported_paths: [],
            scan: {
                candidates: [
                    {path_in_repo: "skills/pdf", valid: true, skill: {name: "pdf-reader"}},
                ],
            },
        })
        importSkillSource.mockResolvedValue({
            imported: [{path_in_repo: "skills/pdf", workflow_id: "wf-pdf", name: "pdf-reader"}],
            skipped: [],
        })
        await open({step: "import"})
        const input = document.querySelector("input") as HTMLInputElement
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, "https://github.com/acme/agent-skills")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await click(byText("Scan"))
        await waitFor(() => expect(byText("Import 1 skill")).toBeTruthy())
        await click(byText("Import 1 skill"))
        await waitFor(() =>
            expect(
                byText("Imported to the skill registry, but not added to this agent: pdf-reader."),
            ).toBeTruthy(),
        )
        expect(onCreated).not.toHaveBeenCalled()
        expect(importSkillSource).toHaveBeenCalledTimes(1)
        expect(byText("Already imported")).toBeTruthy()
    })
})
