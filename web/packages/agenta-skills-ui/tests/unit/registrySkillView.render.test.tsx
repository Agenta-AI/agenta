/**
 * The registry skill body: found by its workflow slug, and Save commits a new registry revision
 * with the revision the edit started from as its base. The agent configuration is not touched.
 */
import {act, createElement} from "react"

import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {commit, resolveAtom} = vi.hoisted(() => ({
    commit: vi.fn(async (_args: Record<string, unknown>) => ({revision_id: "rev-4"})),
    resolveAtom: {current: null as unknown},
}))

vi.mock("@agenta/skills", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/skills")>()),
    commitSkillRevision: commit,
    fetchSkillRevisions: async () => [
        {
            id: "rev-3",
            version: "3",
            skill: {name: "plain-writing", description: "Plain words", body: "# Write plainly"},
        },
    ],
    querySkillReferencedBy: async () => ({referenced_by: []}),
}))
vi.mock("@agenta/skills/state", () => ({
    get skillsResolveQueryAtom() {
        return resolveAtom.current
    },
    invalidateSkillsListCache: () => undefined,
}))
vi.mock("@agenta/shared/api", () => ({
    getHostQueryClient: () => ({invalidateQueries: async () => undefined}),
}))
vi.mock("@agenta/shared/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/state")>()),
    projectIdAtom: (await import("jotai")).atom("proj-1"),
}))
vi.mock("@agenta/entity-ui/agent", () => ({AgentChip: () => null}))
// The editor is the entity-ui form; a textarea for the description stands in for it.
vi.mock("@agenta/entity-ui/drill-in", () => ({
    SKILL_ACTION_ROW: "",
    SkillFormSkeleton: () => null,
    firstBadFile: () => undefined,
    skillFilesOf: () => [],
    useSkillDownloadAction: () => [],
    SkillViewHeader: ({name}: {name: string}) => createElement("h2", null, name),
    SkillFormView: ({
        value,
        onChange,
        valuesAsText,
    }: {
        value: Record<string, unknown>
        onChange: (next: Record<string, unknown>) => void
        valuesAsText?: boolean
    }) =>
        createElement("textarea", {
            "aria-label": "Description",
            "data-read-only": String(Boolean(valuesAsText)),
            value: String(value.description ?? ""),
            onChange: (e: {target: {value: string}}) =>
                onChange({...value, description: e.target.value}),
        }),
}))

import RegistrySkillViewBody from "../../src/RegistrySkillViewBody"

const Chrome = ({children, ...actions}: ViewChromeProps) => (
    <div>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Opener = ({readOnlyOnPhone = false}: {readOnlyOnPhone?: boolean}) => {
    const stack = useViewStack()
    return (
        <button
            onClick={() =>
                void stack.open(
                    {
                        id: "skill.registry",
                        apply: "on_save",
                        readOnlyOnPhone,
                        Component: RegistrySkillViewBody,
                    },
                    {slug: "plain-writing-4k2p"},
                    {kind: "agent_draft", revisionId: "agent-rev"},
                )
            }
        >
            open
        </button>
    )
}

let root: Root
let host: HTMLDivElement

const find = async (selector: string): Promise<HTMLElement> => {
    for (let i = 0; i < 1000; i++) {
        const el = document.querySelector<HTMLElement>(selector)
        if (el) return el
        await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    }
    throw new Error(`not found: ${selector} in ${document.body.innerHTML.slice(0, 400)}`)
}
const buttonByText = (text: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    resolveAtom.current = atom({
        data: {
            skills: [
                // A skill whose NAME equals the slug of another must not be taken for it.
                {
                    workflow_id: "wf-other",
                    workflow_slug: "other-1",
                    skill_name: "plain-writing-4k2p",
                },
                {
                    workflow_id: "wf-1",
                    workflow_slug: "plain-writing-4k2p",
                    skill_name: "plain-writing",
                },
            ],
            builtin: [],
        },
        isPending: false,
        refetch: () => undefined,
    })
    commit.mockClear()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("registry skill body", () => {
    it("Save commits a registry revision on the revision the edit started from", async () => {
        await act(async () =>
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <ViewStackHost chrome={Chrome}>
                        <Opener />
                    </ViewStackHost>
                </QueryClientProvider>,
            ),
        )
        await act(async () => buttonByText("open")?.click())
        const description = (await find(
            'textarea[aria-label="Description"]',
        )) as HTMLTextAreaElement
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set
            setter?.call(description, "Writes replies in plain words")
            description.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => buttonByText("Save")?.click())
        expect(commit).toHaveBeenCalledTimes(1)
        expect(commit.mock.calls[0][0]).toMatchObject({
            projectId: "proj-1",
            workflowId: "wf-1",
            baseRevisionId: "rev-3",
            skill: {name: "plain-writing", description: "Writes replies in plain words"},
        })
        // A busy machine needs more than the default.
    }, 30_000)

    it("a read-only view on a phone draws the form as text rows", async () => {
        await act(async () =>
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <ViewStackHost chrome={Chrome} phone>
                        <Opener readOnlyOnPhone />
                    </ViewStackHost>
                </QueryClientProvider>,
            ),
        )
        await act(async () => buttonByText("open")?.click())
        const form = await find('textarea[aria-label="Description"]')
        expect(form.dataset.readOnly).toBe("true")
    }, 30_000)

    it("an editable view draws the form with its fields", async () => {
        await act(async () =>
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <ViewStackHost chrome={Chrome}>
                        <Opener />
                    </ViewStackHost>
                </QueryClientProvider>,
            ),
        )
        await act(async () => buttonByText("open")?.click())
        const form = await find('textarea[aria-label="Description"]')
        expect(form.dataset.readOnly).toBe("false")
    }, 30_000)
})
