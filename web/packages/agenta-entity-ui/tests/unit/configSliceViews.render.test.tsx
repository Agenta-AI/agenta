/**
 * The first configuration slice: the Instructions view (Cancel and Save), the Model view (a pick
 * applies at once), the integration view (removal by key), the connect view (writes the project
 * only), and the drawer container a host without a stack uses.
 */
import {act, createElement, useState} from "react"

import {
    ViewDrawerHost,
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
    type ViewDef,
    type ViewTarget,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    integrationItemRef,
    removeIntegrationByRef,
} from "../../src/DrillInView/SchemaControls/agentTemplate/itemKinds/tool"
import {instructionsView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/instructionsView"
import {integrationConnectView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/integrationConnectView"
import {integrationView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/integrationView"
import {modelView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/modelView"

import {byText, change, click, findByText, keyDown, waitFor} from "./domHelpers"

const {writer, created} = vi.hoisted(() => ({
    writer: {
        agent: {} as Record<string, unknown>,
        schema: null,
        revisionId: "rev-1",
        update: null as unknown as (
            next: (agent: Record<string, unknown>) => Record<string, unknown>,
        ) => void,
    },
    created: {calls: [] as unknown[]},
}))

vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter", () => ({
    useAgentConfigWriter: () => writer,
}))

// The shared Markdown editor is a Lexical editor; a textarea stands in for it here.
vi.mock("../../src/DrillInView/SchemaControls/MarkdownEditor", () => ({
    MarkdownEditor: ({value, onChange}: {value: string; onChange: (next: string) => void}) =>
        createElement("textarea", {
            "aria-label": "AGENTS.md",
            value,
            onChange: (e: {target: {value: string}}) => onChange(e.target.value),
        }),
}))

// Today's model list: one pick button.
vi.mock(
    "../../src/DrillInView/SchemaControls/agentTemplate/sections/ModelHarnessSectionBody",
    () => ({
        ModelHarnessSectionBody: ({
            config,
            onChange,
        }: {
            config: Record<string, unknown>
            onChange: (next: Record<string, unknown>) => void
        }) =>
            createElement(
                "button",
                {onClick: () => onChange({...config, llm: {model: "claude-opus-5-5"}})},
                "Claude Opus 5.5",
            ),
    }),
)

vi.mock("@agenta/entities/gatewayTool", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/gatewayTool")>()),
    useToolIntegrationDetail: (key: string) => ({
        integration: key
            ? {name: key === "github" ? "GitHub" : "Zendesk", auth_schemes: ["oauth"]}
            : null,
    }),
    useToolConnectionsQuery: () => ({connections: []}),
    usePersonalToolConnections: () => ({connections: []}),
    useToolIntegrationCatalog: () => ({actions: [], complete: true, isLoading: false, error: null}),
    createToolConnection: async (body: unknown) => {
        created.calls.push(body)
        return {connection: {id: "c1", data: {}}}
    },
    invalidateToolConnections: () => undefined,
}))

vi.mock("@agenta/entities/project", () => ({fetchProject: async () => ({project_name: "Acme"})}))

const AGENT: ViewTarget = {kind: "agent_draft", revisionId: "rev-1"}
const PROJECT: ViewTarget = {kind: "project"}

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav>
            {crumbs.map((crumb, i) =>
                crumb.onSelect ? (
                    <button key={i} onClick={crumb.onSelect}>{`crumb:${crumb.title}`}</button>
                ) : (
                    <span key={i}>{`here:${crumb.title}`}</span>
                ),
            )}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

/** A root with one button that opens `view` in the stack. */
const Opener = <P,>({view, params, target}: {view: ViewDef<P>; params: P; target: ViewTarget}) => {
    const stack = useViewStack()
    return <button onClick={() => void stack.open(view, params, target)}>open</button>
}

let root: Root
let host: HTMLDivElement
const mount = async (element: ReturnType<typeof createElement>) => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={createStore()}>{element}</Provider>
            </QueryClientProvider>,
        ),
    )
}

const openIn = async <P,>(view: ViewDef<P>, params: P, target: ViewTarget) => {
    await mount(
        <ViewStackHost chrome={Chrome} rootTitle="Agent">
            <Opener view={view} params={params} target={target} />
        </ViewStackHost>,
    )
    await click(byText("open"))
}

const tools = () => (writer.agent.tools as unknown[]) ?? []
const zendesk = {
    type: "gateway_connection",
    connection: {provider: "composio", integration: "zendesk", slug: "acme-support"},
    permissions: {default: "allow"},
}
const github = {
    type: "gateway_connection",
    connection: {provider: "composio", integration: "github", slug: "gh"},
    permissions: {default: "allow"},
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    writer.agent = {instructions: {agents_md: "# Role"}, llm: {model: "claude-sonnet-5-5"}}
    writer.update = vi.fn((next) => {
        writer.agent = next(writer.agent)
    })
    created.calls = []
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Instructions view", () => {
    it("Save applies the text to the agent configuration and goes back", async () => {
        await openIn(instructionsView, {file: "AGENTS.md"}, AGENT)
        const editor = await findByText("", 'textarea[aria-label="AGENTS.md"]')
        expect(byText("here:AGENTS.md")).toBeTruthy()
        await change(editor, "# Role\n\nTriage tickets.")
        await click(byText("Save"))
        expect(writer.update).toHaveBeenCalledTimes(1)
        expect(writer.agent.instructions).toEqual({agents_md: "# Role\n\nTriage tickets."})
        await waitFor(() => expect(document.querySelector("textarea")).toBeNull())
    })

    it("Cancel drops the edits and writes nothing", async () => {
        await openIn(instructionsView, {file: "AGENTS.md"}, AGENT)
        await change(await findByText("", "textarea"), "changed")
        await click(byText("Cancel"))
        expect(writer.update).not.toHaveBeenCalled()
        expect(document.querySelector("textarea")).toBeNull()
    })
})

describe("Model view", () => {
    it("a pick changes the configuration at once; the view has Done and no Save", async () => {
        await openIn(modelView, {}, AGENT)
        expect(byText("Save")).toBeUndefined()
        await click(byText("Claude Opus 5.5"))
        expect(writer.agent.llm).toEqual({model: "claude-opus-5-5"})
        expect(byText("Done")).toBeTruthy()
    })
})

describe("Integration view", () => {
    it("removes by key: a builder save that added another integration above does not matter", async () => {
        writer.agent = {tools: [zendesk]}
        const ref = integrationItemRef({provider: "composio", integration: "zendesk"})
        // The list changed under the open view.
        const changed = [github, zendesk]
        expect(removeIntegrationByRef(changed, ref)).toEqual([github])
        // An unknown key removes nothing.
        expect(
            removeIntegrationByRef(changed, {
                list: "tools",
                key: "gateway_connection:composio:slack",
            }),
        ).toEqual(changed)
        expect(ref).toEqual({list: "tools", key: "gateway_connection:composio:zendesk"})
    })

    it("Remove from agent asks first, removes only this integration and keeps the connection", async () => {
        writer.agent = {tools: [github, zendesk]}
        await openIn(
            integrationView,
            {item: integrationItemRef({provider: "composio", integration: "zendesk"})},
            AGENT,
        )
        await click(await findByText("Remove from agent"))
        const dialog = await findByText("", '[data-testid="remove-from-agent-dialog"]')
        expect(dialog.textContent).toContain("Remove Zendesk from this agent?")
        expect(dialog.textContent).toContain("The connection stays in the project.")
        expect(writer.update).not.toHaveBeenCalled()
        await click(byText("Remove"))
        expect(tools()).toEqual([github])
        expect(created.calls).toEqual([])
    })

    it("shows the removed state when the item left the agent", async () => {
        writer.agent = {tools: [github]}
        await openIn(
            integrationView,
            {item: integrationItemRef({provider: "composio", integration: "zendesk"})},
            AGENT,
        )
        expect(await findByText("This integration is no longer in the agent.")).toBeTruthy()
        expect(byText("GitHub")).toBeUndefined()
    })
})

describe("Connect view", () => {
    it("Connect creates the project connection and writes nothing to an agent", async () => {
        await openIn(integrationConnectView, {integrationKey: "github"}, PROJECT)
        expect(await findByText("Connect GitHub")).toBeTruthy()
        expect(byText("here:GitHub")).toBeTruthy()
        await click(byText("Connect"))
        await waitFor(() => expect(created.calls).toHaveLength(1))
        expect(writer.update).not.toHaveBeenCalled()
    })

    it("in a drawer, the guarded back asks when the name field has text", async () => {
        const Host = () => {
            const [open, setOpen] = useState(true)
            return open ? (
                <ViewDrawerHost
                    request={{
                        view: integrationConnectView,
                        params: {integrationKey: "github"},
                        target: PROJECT,
                    }}
                    onClosed={() => setOpen(false)}
                />
            ) : (
                <span>closed</span>
            )
        }
        await mount(<Host />)
        const name = await findByText("", 'input[placeholder="e.g. My GitHub Account"]')
        await change(name, "Work GitHub")
        await keyDown(name, "Escape")
        expect(await findByText("", '[data-testid="unsaved-changes-dialog"]')).toBeTruthy()
        await click(byText("Discard"))
        await waitFor(() => expect(byText("closed")).toBeTruthy(), 2000)
        expect(created.calls).toEqual([])
    })
})
