/**
 * MCP servers as views (F03 f4 to f6): "Add MCP server" adds a server and opens its view in
 * place; the server view shows an expired sign-in in its title with "Reconnect" and no banner,
 * and removes the server by its key after the list changed under the view.
 */
import {act, createElement} from "react"

import {
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
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {
    buildMcpAgentItem,
    mcpItemRef,
    readMcpAccountSource,
    removeMcpByRef,
    withMcpAccountSource,
} from "../../src/DrillInView/SchemaControls/agentTemplate/mcpRail"
import {mcpAddView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/mcpAddView"
import {mcpServerView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/mcpServerView"

import {byText, click, findByText} from "./domHelpers"

const {writer, listeners, endpoints, access, toolReads} = vi.hoisted(() => ({
    access: {value: "on"},
    toolReads: {count: 0},
    listeners: new Set<() => void>(),
    endpoints: {rows: [] as unknown[]},
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
vi.mock(
    "../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter",
    async (importOriginal) => {
        const {useSyncExternalStore} = await import("react")
        const subscribe = (listener: () => void) => {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        }
        return {
            ...(await importOriginal<object>()),
            useAgentConfigWriter: () => {
                useSyncExternalStore(subscribe, () => writer.agent)
                return writer
            },
        }
    },
)

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()
    const {atom: jotaiAtom} = await import("jotai")
    const query = jotaiAtom(() => ({data: endpoints.rows, isPending: false}))
    return {
        ...original,
        mcpEndpointsQueryAtom: query,
        refreshMcpEndpointsAtom: jotaiAtom(null, () => undefined),
        listMcpTools: async () => {
            toolReads.count += 1
            return [
                {name: "list_issues", title: "List issues", annotations: {readOnlyHint: true}},
                {name: "create_issue", title: "Create issue", annotations: {readOnlyHint: false}},
            ]
        },
    }
})

vi.mock("@agenta/entities/secret", async (importOriginal) => {
    const {atom: jotaiAtom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/secret")>()),
        personalAccountsAccessAtom: jotaiAtom(() => access.value),
    }
})

// The no-person warning reads the agent's triggers, which this suite does not load.
vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/accounts/useRunsWithoutPerson", () => ({
    useRunsWithoutPerson: () => false,
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/workflow")>()),
    invalidateAgentRequirements: () => undefined,
}))

// The connect step stands in for itself: it shows what it was opened with, and its buttons
// finish the connection as each owner would.
vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/views/McpConnectViewBody", async () => {
    const {createElement: h} = await import("react")
    type Params = {
        reconnect?: {slug: string} | null
        owners?: string[]
        onConnected?: (endpoint: Record<string, string>) => void
    }
    const finish = (params: Params, owner: string) =>
        h(
            "button",
            {
                onClick: () =>
                    params.onConnected?.({id: "id-new", slug: "new-server", name: "new", owner}),
            },
            `finish as ${owner}`,
        )
    return {
        default: ({params}: {params: Params}) =>
            h(
                "div",
                null,
                h("span", null, `connect step: ${params.reconnect?.slug ?? "new"}`),
                h("span", null, `owners: ${params.owners?.join(",") ?? "none"}`),
                finish(params, "user"),
                finish(params, "project"),
            ),
    }
})

const AGENT: ViewTarget = {kind: "agent_draft", revisionId: "rev-1"}

const endpoint = (slug: string, health: "healthy" | "expired") => ({
    id: `id-${slug}`,
    slug,
    name: slug,
    namespace: "custom",
    auth_mode: health === "healthy" ? "none" : "oauth",
    secret_id: health === "healthy" ? null : "secret-1",
    flags: {is_valid: health === "healthy"},
    data: {route: {base_url: `https://${slug}.example.com/mcp`}},
})

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

const openIn = async <P,>(view: ViewDef<P>, params: P) => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <Provider store={createStore()}>
                    <ViewStackHost chrome={Chrome} rootTitle="Agent">
                        {createElement(Opener<P>, {view, params})}
                    </ViewStackHost>
                </Provider>
            </QueryClientProvider>,
        ),
    )
    await click(byText("open"))
}

const mcps = () => (writer.agent.mcps as Record<string, unknown>[]) ?? []
const linear = buildMcpAgentItem({slug: "linear", name: "linear"})
const docs = buildMcpAgentItem({slug: "docs-search", name: "docs-search"})

// The view bodies load lazily; loading them once here keeps each test inside its time limit.
beforeAll(async () => {
    await import("../../src/DrillInView/SchemaControls/agentTemplate/views/McpAddViewBody")
    await import("../../src/DrillInView/SchemaControls/agentTemplate/views/McpServerViewBody")
}, 300_000)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    endpoints.rows = [endpoint("linear", "healthy"), endpoint("docs-search", "healthy")]
    writer.agent = {mcps: [linear]}
    writer.readOnly = false
    access.value = "on"
    writer.update = vi.fn((next) => {
        writer.agent = next(writer.agent)
        listeners.forEach((listener) => listener())
    })
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Add MCP server view", () => {
    it("adds a server with one click and opens its server view in place", async () => {
        await openIn(mcpAddView, {})
        await findByText("crumb:Add MCP server")
        expect(byText("Added")).toBeTruthy()
        await click(await findByText("docs-search", "div"))
        expect(mcps().map((item) => item.name)).toEqual(["linear", "docs_search"])
        await findByText("crumb:docs-search")
        expect(byText("crumb:Add MCP server")).toBeUndefined()
    })
})

describe("Connect server, who can use it", () => {
    const added = () => mcps().find((item) => item.name === "new")

    it("asks for the owner, and an Only me sign-in starts on each person's own", async () => {
        await openIn(mcpAddView, {})
        await click(await findByText("Connect server", "button"))
        await findByText("owners: user,project")
        await click(byText("finish as user"))
        expect(added()?.connection).toEqual({
            type: "gateway",
            namespace: "custom",
            slug: "new-server",
            account_source: "user",
        })
        expect(readMcpAccountSource(added())).toBe("user")
    })

    it("keeps one shared sign-in for Everyone", async () => {
        await openIn(mcpAddView, {})
        await click(await findByText("Connect server", "button"))
        await click(await findByText("finish as project"))
        expect(added()?.connection).toEqual({
            type: "gateway",
            namespace: "custom",
            slug: "new-server",
        })
        expect(readMcpAccountSource(added())).toBe("agent")
    })

    it("does not ask with personal accounts off", async () => {
        access.value = "off"
        await openIn(mcpAddView, {})
        await click(await findByText("Connect server", "button"))
        await findByText("owners: none")
    })
})

describe("Reconnect", () => {
    it("opens the reconnect step for the expired row it was pressed on", async () => {
        endpoints.rows = [endpoint("linear", "healthy"), endpoint("octolens", "expired")]
        await openIn(mcpAddView, {})
        await click(await findByText("", 'button[aria-label="Reconnect octolens"]'))
        await findByText("connect step: octolens")
    })

    it("opens the reconnect step from the server view's title", async () => {
        endpoints.rows = [endpoint("linear", "expired")]
        await openIn(mcpServerView, {item: mcpItemRef(linear, [linear])!})
        await click(await findByText("Reconnect"))
        await findByText("connect step: linear")
    })
})

describe("MCP server view", () => {
    it("shows an expired sign-in in the title with Reconnect, and no banner", async () => {
        endpoints.rows = [endpoint("linear", "expired")]
        await openIn(mcpServerView, {item: mcpItemRef(linear, [linear])!})
        await findByText("crumb:linear")
        await findByText("Login expired")
        expect(byText("Reconnect")).toBeTruthy()
        expect(document.body.textContent).not.toContain("needs a new sign-in")
    })

    it("removes by key after the list changed under the view, and asks first", async () => {
        await openIn(mcpServerView, {item: mcpItemRef(linear, [linear])!})
        await findByText("crumb:linear")
        // A builder save puts another server in front of it.
        writer.agent = {mcps: [docs, linear]}
        await click(byText("Remove from agent"))
        const dialog = await findByText("", '[data-testid="remove-from-agent-dialog"]')
        expect(dialog.textContent).toContain("The connection stays in the project.")
        await click(byText("Remove"))
        expect(mcps().map((item) => item.name)).toEqual(["docs_search"])
    })

    it("says nothing about the project's sign-in on each person's own entry", async () => {
        // "Only me": the person signed in, the project never did.
        endpoints.rows = [
            {
                ...endpoint("linear", "healthy"),
                auth_mode: "oauth",
                secret_id: null,
                user_sign_in: {},
            },
        ]
        const own = withMcpAccountSource(linear, "user")
        writer.agent = {mcps: [own]}
        toolReads.count = 0
        await openIn(mcpServerView, {item: mcpItemRef(own, [own])!})
        await findByText("crumb:linear")
        await findByText("Each person's own")
        expect(byText("Not signed in")).toBeUndefined()
        expect(byText("Reconnect")).toBeUndefined()
        // The project's credential cannot read this server's tools: no list and no error.
        expect(toolReads.count).toBe(0)
        expect(document.body.textContent).not.toContain("Couldn't read this server's tools")
    })

    it("shows the removed state when the server left the agent", async () => {
        writer.agent = {mcps: [docs]}
        await openIn(mcpServerView, {item: mcpItemRef(linear, [linear])!})
        await findByText("This MCP server is no longer in the agent.")
    })
})

describe("two servers with the same name", () => {
    it("are addressed by slug, so the second one never touches the first", () => {
        const us = {...buildMcpAgentItem({slug: "linear-us", name: "linear"})}
        const eu = {...buildMcpAgentItem({slug: "linear-eu", name: "linear"})}
        const mcps = [us, eu]
        const ref = mcpItemRef(eu, mcps)!
        expect(ref).toEqual({list: "mcps", key: "@slug:linear-eu"})
        expect(removeMcpByRef(mcps, ref)).toEqual([us])
        // The name alone is ambiguous here, so it addresses nothing.
        expect(removeMcpByRef(mcps, {list: "mcps", key: "linear"})).toBe(mcps)
        // A slug address is never read as a name, even when another server is named like it.
        const namedLikeSlug = {...buildMcpAgentItem({slug: "other", name: "x"}), name: "linear-eu"}
        expect(removeMcpByRef([us, eu, namedLikeSlug], ref)).toEqual([us, namedLikeSlug])
    })
})

describe("MCP item keys", () => {
    it("use the entry name, the key the change-set engine uses", () => {
        expect(mcpItemRef(linear, [linear])).toEqual({list: "mcps", key: "linear"})
        expect(mcpItemRef({connection: {slug: "x"}}, [])).toBeNull()
        const list = [linear, docs]
        expect(removeMcpByRef(list, {list: "mcps", key: "nope"})).toBe(list)
    })
})
