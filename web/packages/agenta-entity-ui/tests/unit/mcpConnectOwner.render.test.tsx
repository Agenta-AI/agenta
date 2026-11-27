/**
 * "Add MCP server › Connect server" asks for the Owner (F03 f5) with the integration form's
 * switch and texts, under the name and only on the OAuth screen. The choice goes to the journey
 * as the owner of the first sign-in.
 */
import {act, createElement} from "react"

import {
    detectedAuthMode,
    type McpJourneyState,
    type McpJourneyStatus,
} from "@agenta/entities/mcpEndpoint"
import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {
    mcpConnectView,
    type McpConnectViewParams,
} from "../../src/DrillInView/SchemaControls/agentTemplate/views/mcpConnectView"

import {byText, click, findByText} from "./domHelpers"

const {useMcpConnectJourney} = vi.hoisted(() => ({useMcpConnectJourney: vi.fn()}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    useMcpConnectJourney,
}))

vi.mock("@agenta/entities/project", () => ({
    fetchProject: async () => ({project_name: "Support"}),
}))

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/shared/api")>()),
    getAgentaApiUrl: () => "https://api.example.test",
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    // An empty list for the lists, and a present value for the project id.
    useAtomValue: () => [],
    useSetAtom: () => async () => undefined,
}))

class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

const OAUTH_PROBE = {
    reachable: true,
    server_name: "linear",
    auth: {mode: "oauth" as const, scopes_offered: []},
}

const journeyState = (status: McpJourneyStatus): McpJourneyState => ({
    url: "https://mcp.linear.app/mcp",
    name: "linear",
    nameTouched: false,
    probe: OAUTH_PROBE,
    savedUrlProbe: null,
    authMode: detectedAuthMode(OAUTH_PROBE),
    authModeTouched: false,
    oauthOffered: true,
    scopesOffered: [],
    scopesSelected: [],
    oauthClientId: "",
    oauthClientSecretId: null,
    oauthClientAuthMethod: null,
    savedOauthConfig: null,
    scopesSaved: null,
    endpointId: null,
    slug: null,
    createdHere: true,
    failureStatus: null,
    error: null,
    status,
})

const stubJourney = (state: McpJourneyState) =>
    useMcpConnectJourney.mockImplementation(() => ({
        state,
        popupName: "mcp_consent",
        expectsConsent: true,
        setUrl: vi.fn(),
        editUrl: vi.fn(),
        submitUrl: vi.fn(),
        setName: vi.fn(),
        selectAuthMode: vi.fn(),
        submitName: vi.fn(),
        toggleScope: vi.fn(),
        setOauthClient: vi.fn(),
        reloadSavedOauthConfig: vi.fn(),
        submitScopes: vi.fn(),
        startScopeDiscovery: vi.fn(),
        submitManualCredential: vi.fn(),
        skipAuthentication: vi.fn(),
        finish: vi.fn(),
        cancel: vi.fn(),
        cancelConsent: vi.fn(),
        retry: vi.fn(),
        abandonAttempt: vi.fn(),
    }))

const Chrome = ({children, ...actions}: ViewChromeProps) => (
    <div>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Opener = ({params}: {params: McpConnectViewParams}) => {
    const stack = useViewStack()
    return (
        <button onClick={() => void stack.open(mcpConnectView, params, {kind: "project"})}>
            open
        </button>
    )
}

let root: Root
let host: HTMLDivElement

const openWith = async (params: McpConnectViewParams) => {
    await act(async () =>
        root.render(
            <QueryClientProvider client={new QueryClient()}>
                <ViewStackHost chrome={Chrome} rootTitle="Agent">
                    {createElement(Opener, {params})}
                </ViewStackHost>
            </QueryClientProvider>,
        ),
    )
    await click(byText("open"))
}

/** The owner the journey was last asked to sign in for. */
const radio = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find((node) =>
        node.textContent?.startsWith(label),
    )
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ")

const lastOwner = () => useMcpConnectJourney.mock.calls.at(-1)?.[0]?.owner

beforeAll(async () => {
    await import("../../src/DrillInView/SchemaControls/agentTemplate/views/McpConnectViewBody")
}, 300_000)

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    useMcpConnectJourney.mockReset()
})

describe("Connect server, Owner", () => {
    it("asks for the Owner, starts on Personal, and says what it means", async () => {
        stubJourney(journeyState("naming"))
        await openWith({owners: ["user", "project"]})
        await findByText("Owner")
        expect(radio("Personal")?.getAttribute("aria-checked")).toBe("true")
        expect(radio("Project")).toBeTruthy()
        expect(text()).toContain("Only you can use it. It follows you to every project.")
        expect(lastOwner()).toBe("user")
    })

    it("hands Project to the journey as the project's sign-in", async () => {
        stubJourney(journeyState("naming"))
        await openWith({owners: ["user", "project"]})
        await findByText("Owner")
        await click(radio("Project"))
        expect(lastOwner()).toBe("project")
        expect(text()).toContain("Everyone in Support can add it to an agent.")
    })

    it("does not ask where the opener allows one owner", async () => {
        stubJourney(journeyState("naming"))
        await openWith({})
        await findByText("Connect", "button")
        expect(radio("Personal")).toBeUndefined()
        expect(lastOwner()).toBe("project")
    })

    it("uses the one permitted owner without asking", async () => {
        stubJourney(journeyState("naming"))
        await openWith({owners: ["user"]})
        await findByText("Connect", "button")
        expect(radio("Personal")).toBeUndefined()
        expect(lastOwner()).toBe("user")
    })

    it("does not ask on a reconnect, which repairs the project's sign-in", async () => {
        stubJourney(journeyState("naming"))
        await openWith({
            owners: ["user", "project"],
            reconnect: {
                id: "id-linear",
                slug: "linear",
                name: "linear",
                url: "https://mcp.linear.app/mcp",
                authMode: "oauth",
            } as McpConnectViewParams["reconnect"],
        })
        await findByText("", '[data-testid="mcp-connect-journey"]')
        expect(radio("Personal")).toBeUndefined()
        expect(lastOwner()).toBe("project")
    })
})
