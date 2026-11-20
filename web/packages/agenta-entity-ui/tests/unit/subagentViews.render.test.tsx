/**
 * Subagents as views (F03 f1 to f3): "Add subagents" adds with one click and removes with a
 * second, says when agents could not load; the subagent view saves only the description, removes
 * by key and shows the removed state and the configuration load error.
 */
import {act, createElement, useMemo} from "react"

import {DrillInUIProvider, type WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
    type ViewDef,
    type ViewTarget,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {subagentsSection} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/SubagentsSection"
import {
    removeSubagentByRef,
    subagentItemRef,
} from "../../src/DrillInView/SchemaControls/agentTemplate/subagentReference"
import {subagentAddView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/subagentAddView"
import {subagentView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/subagentView"

import {byText, change, click, findByText, waitFor} from "./domHelpers"

const {writer, listeners} = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
    writer: {
        agent: {} as Record<string, unknown>,
        schema: null,
        revisionId: "rev-1",
        readOnly: false,
        update: null as unknown as (
            next: (agent: Record<string, unknown>) => Record<string, unknown>,
        ) => void,
    },
}))

// A writer that renders again on each write, as the real draft atom does.
vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter", async () => {
    const {useSyncExternalStore} = await import("react")
    const subscribe = (listener: () => void) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
    }
    return {
        useAgentConfigWriter: () => {
            useSyncExternalStore(subscribe, () => writer.agent)
            return writer
        },
    }
})

// Names come from the workflow artifacts: only "Email writer" (wf-email) resolves here; icons do not.
const empty = atom("")
const currentName = atom("Email writer")
const nameOf = (workflowId: string) => (workflowId === "wf-email" ? currentName : empty)
const noIcon = atom(null)
vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    agentIconAtomFamily: () => noIcon,
    workflowMolecule: {
        selectors: {artifactName: (id: string) => nameOf(id), workflowId: () => empty},
    },
}))

const AGENT: ViewTarget = {kind: "agent_draft", revisionId: "rev-1"}

const AGENTS = [
    {id: "wf-email", slug: "email-writer", name: "Email writer", description: "Writes emails"},
    {id: "wf-lead", slug: "lead-finder", name: "Lead finder", description: "Finds leads"},
    {id: "wf-week", slug: "weekly-report", name: "Weekly report", description: ""},
]

const retries = {catalog: 0, detail: 0}

const bridge = (options: {failedSlugs?: string[]; detailFailed?: boolean} = {}) =>
    ({
        enabled: true,
        workflows: AGENTS,
        workflowsLoading: false,
        activate: () => undefined,
        resolveInputSchema: async () => ({type: "object", properties: {q: {type: "string"}}}),
        // Stable per set of slugs, as the real query atoms are.
        useWorkflowReferenceCatalog: (slugs: string[]) => {
            const key = slugs.join("\n")
            return useMemo(
                () => ({
                    bySlug: Object.fromEntries(
                        slugs
                            .filter((slug) => !options.failedSlugs?.includes(slug))
                            .map((slug) => [
                                slug,
                                {
                                    type: "agent",
                                    workflowId: AGENTS.find((agent) => agent.slug === slug)?.id,
                                    integrations: [],
                                },
                            ]),
                    ),
                    failedSlugs: slugs.filter((slug) => options.failedSlugs?.includes(slug)),
                    loading: false,
                    retry: () => void (retries.catalog += 1),
                }),
                [key],
            )
        },
        useSubagentDetail: () => ({
            detail: options.detailFailed
                ? null
                : {model: "gpt-5.5-mini", integrations: [], skills: ["cold-email"]},
            loading: false,
            failed: Boolean(options.detailFailed),
            retry: () => void (retries.detail += 1),
        }),
    }) as unknown as WorkflowReferenceBridge

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav>
            {crumbs.map((crumb, i) => (
                <span key={i}>{`crumb:${crumb.title}`}</span>
            ))}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Opener = <P,>({view, params}: {view: ViewDef<P>; params: P}) => {
    const stack = useViewStack()
    return <button onClick={() => void stack.open(view, params, AGENT)}>open</button>
}

let root: Root
let host: HTMLDivElement

const openIn = async <P,>(
    view: ViewDef<P>,
    params: P,
    workflowReference: WorkflowReferenceBridge = bridge(),
) => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={createStore()}>
                    <DrillInUIProvider components={{workflowReference}}>
                        <ViewStackHost chrome={Chrome} rootTitle="Agent">
                            {createElement(Opener<P>, {view, params})}
                        </ViewStackHost>
                    </DrillInUIProvider>
                </Provider>
            </QueryClientProvider>,
        ),
    )
    await click(byText("open"))
}

const tools = () => (writer.agent.tools as Record<string, unknown>[]) ?? []
const reference = (slug: string, description = "") => ({
    type: "reference",
    ref_by: "variant",
    slug,
    description,
    input_schema: {type: "object", properties: {}},
})
const integration = {
    type: "gateway_connection",
    connection: {provider: "composio", integration: "gmail", slug: "gmail"},
}

// The view bodies load lazily; loading them once here keeps each test inside its time limit.
beforeAll(async () => {
    await import("../../src/DrillInView/SchemaControls/agentTemplate/views/SubagentAddViewBody")
    await import("../../src/DrillInView/SchemaControls/agentTemplate/views/SubagentViewBody")
}, 300_000)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    writer.agent = {tools: [reference("email-writer", "Writes a first email")]}
    writer.readOnly = false
    writer.update = vi.fn((next) => {
        writer.agent = next(writer.agent)
        listeners.forEach((listener) => listener())
    })
    retries.catalog = 0
    retries.detail = 0
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Add subagents view", () => {
    it("adds an agent with one click and removes it with a second click", async () => {
        await openIn(subagentAddView, {})
        await findByText("crumb:Add subagents")
        await click(await findByText("Lead finder"))
        await waitFor(() =>
            expect(tools().map((tool) => tool.slug)).toEqual(["email-writer", "lead-finder"]),
        )
        // The added row says so; the schema came from the agent's latest revision.
        expect(tools()[1].input_schema).toEqual({type: "object", properties: {q: {type: "string"}}})
        expect(tools()[1].name).toBeUndefined()
        await waitFor(() =>
            expect(
                document.querySelector('[aria-label="Remove Lead finder as a subagent"]'),
            ).toBeTruthy(),
        )
        await click(byText("Lead finder"))
        await waitFor(() => expect(tools().map((tool) => tool.slug)).toEqual(["email-writer"]))
        // A picker: Done, no Save.
        expect(byText("Done")).toBeTruthy()
        expect(byText("Save")).toBeUndefined()
    })

    it("ends the list with the agents that could not load, and Retry loads again", async () => {
        await openIn(subagentAddView, {}, bridge({failedSlugs: ["weekly-report"]}))
        await findByText("1 agent could not be loaded, so it is not listed.")
        expect(byText("Weekly report")).toBeUndefined()
        expect(byText("Added")).toBeTruthy()
        await click(byText("Retry"))
        expect(retries.catalog).toBe(1)
    })
})

describe("Subagent view", () => {
    const item = {list: "tools", key: "email-writer"}

    it("Save writes only the description and goes back; Cancel writes nothing", async () => {
        await openIn(subagentView, {item})
        const field = await findByText("", 'textarea[aria-label="Subagent description"]')
        await change(field, "Writes a short first email")
        await click(byText("Save"))
        expect(tools()).toEqual([reference("email-writer", "Writes a short first email")])
        await waitFor(() => expect(document.querySelector("textarea")).toBeNull())

        await click(byText("open"))
        await change(await findByText("", "textarea"), "changed")
        await click(byText("Cancel"))
        expect(writer.update).toHaveBeenCalledTimes(1)
    })

    it("removes by key after the list changed under the view, and asks first", async () => {
        await openIn(subagentView, {item})
        await findByText("", "textarea")
        // A builder save puts other entries in front of the subagent.
        writer.agent = {tools: [integration, reference("lead-finder"), ...tools()]}
        await click(byText("Remove from agent"))
        const dialog = await findByText("", '[data-testid="remove-from-agent-dialog"]')
        expect(dialog.textContent).toContain("The agent stays in the project.")
        expect(writer.update).not.toHaveBeenCalled()
        await click(byText("Remove"))
        expect(tools().map((tool) => tool.slug ?? tool.type)).toEqual([
            "gateway_connection",
            "lead-finder",
        ])
    })

    it("shows the removed state when the subagent left the agent", async () => {
        writer.agent = {tools: [reference("lead-finder")]}
        await openIn(subagentView, {item})
        await findByText("This subagent is no longer in the agent.")
        expect(byText("Save")?.hasAttribute("disabled")).toBe(true)
    })

    it("keeps the description editable when the configuration cannot load", async () => {
        await openIn(subagentView, {item}, bridge({detailFailed: true}))
        await findByText("Couldn't load this agent's configuration.")
        expect(document.querySelector("textarea")?.hasAttribute("disabled")).toBe(false)
        await click(byText("Try again"))
        expect(retries.detail).toBe(1)
    })
})

describe("Subagents section", () => {
    it("the row bin asks with the name the row shows, then removes by key", async () => {
        const removed: unknown[] = []
        const tool = reference("email-writer")
        const section = subagentsSection({
            t: ((key: string) => key) as never,
            hasTools: true,
            sectionIndicator: () => undefined,
            openAddSubagents: undefined,
            subagentCount: 1,
            workflowReference: bridge(),
            subagentTools: [{item: tool, index: 0}],
            openSubagent: () => undefined,
            removeSubagent: (item) => removed.push(item),
            toolStatusFor: () => undefined,
        })
        if (!section) throw new Error("no section")
        await act(async () =>
            root.render(
                <QueryClientProvider client={new QueryClient()}>
                    <Provider store={createStore()}>{section.content}</Provider>
                </QueryClientProvider>,
            ),
        )
        const bin = await findByText("", 'button[aria-label^="Remove"]')
        await click(bin)
        const dialog = await findByText("", '[data-testid="remove-from-agent-dialog"]')
        expect(dialog.textContent).toContain("Remove Email writer from this agent?")
        expect(removed).toEqual([])
        await click(byText("Remove"))
        expect(removed).toEqual([{list: "tools", key: "email-writer"}])
    })
})

describe("subagent keys", () => {
    it("use the engine's key: the entry name, else the slug", () => {
        expect(subagentItemRef(reference("lead-finder"))).toEqual({
            list: "tools",
            key: "lead-finder",
        })
        expect(subagentItemRef({...reference("lead-finder"), name: "Leads"})).toEqual({
            list: "tools",
            key: "Leads",
        })
        expect(subagentItemRef(integration)).toBeNull()
        const list = [reference("a"), reference("b")]
        expect(removeSubagentByRef(list, {list: "tools", key: "c"})).toBe(list)
    })
})
