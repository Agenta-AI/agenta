/**
 * Every surface that offers to repair a login passes the connection to the sheet.
 *
 * D131's remainder. A case that builds its own payload and hands it to the sheet proves the
 * sheet and stays green if a caller stops passing a reconnect, which is what one of them was
 * doing (D132). And a case that reads what the sheet DREW proves only that something opened:
 * the sheet draws the same shell either way, so the assertion has to be on the prop.
 *
 * So the sheet stands in for itself and records the props it is given, one entry per mount,
 * and each case names the connection it expects rather than any connection. The drawers that
 * carry the Reconnect affordance stand in for themselves too, since each reads a tool
 * catalogue on open and this file has no server.
 *
 * The three mounts in this package are here. The Settings row menu and the chat notice card
 * are mounted from their own packages and covered in their own suites, the same way.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

/**
 * Two connections whose logins were revoked, and a third that is fine.
 *
 * More than one on purpose: a mount that hands over the first row it can find, rather than
 * the row the reader asked about, passes every single-row fixture ever written (D154).
 */
const endpoints = [
    {
        id: "mcp-1",
        slug: "linear",
        name: "Linear",
        auth_mode: "oauth" as const,
        namespace: "custom" as const,
        secret_id: "sec-1",
        data: {route: {base_url: "https://mcp.linear.app/mcp"}},
    },
    {
        id: "mcp-9",
        slug: "octolens",
        name: "Octolens",
        auth_mode: "oauth" as const,
        namespace: "custom" as const,
        data: {route: {base_url: "https://app.octolens.com/mcp"}},
    },
]

/** The one every case here asks to repair: the second row, never the first. */
const TARGET = endpoints[1]

const {seen, reported} = vi.hoisted(() => ({
    seen: [] as ({slug?: string; name?: string; id?: string} | null)[],
    /** The success callbacks the mounts handed the sheet, so a case can fire one. */
    reported: [] as ((endpoint: {id: string; slug: string; name: string}) => void)[],
}))

// The barrel re-exports both shapes from this module, so the stub carries both or the
// components that import through it get an undefined element.
vi.mock("../../src/mcpEndpoint/McpConnectJourney", () => {
    const Journey = ({
        reconnect,
        onConnected,
    }: {
        reconnect?: {slug?: string; name?: string; id?: string} | null
        onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
    }) => {
        seen.push(reconnect ?? null)
        if (onConnected) reported.push(onConnected)
        return createElement("div", {"data-testid": "journey"}, reconnect ? "reconnect" : "new")
    }
    return {default: Journey, McpConnectSheet: Journey}
})

vi.mock("../../src/mcpEndpoint/McpPermissionDrawer", () => ({
    default: ({onReconnect}: {onReconnect?: () => void}) =>
        createElement("button", {onClick: onReconnect}, "Reconnect from the drawer"),
}))

vi.mock("../../src/mcpEndpoint/McpAddServerDrawer", () => ({
    default: ({onReconnect}: {onReconnect?: (option: unknown) => void}) =>
        createElement(
            "button",
            {onClick: () => onReconnect?.({slug: "octolens", name: "Octolens"})},
            "Reconnect from the add drawer",
        ),
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    mcpEndpointsQueryAtom: {},
    refreshMcpEndpointsAtom: {},
    listMcpTools: vi.fn(async () => []),
}))

vi.mock("@agenta/entities/secret", () => ({providerConnectionsAtom: {}}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: endpoints}),
    useSetAtom: () => async () => undefined,
    useAtom: () => [false, () => undefined],
}))

import GatewayConnectToolWidget from "../../src/clientTools/GatewayConnectToolWidget"
import {McpServerFormView} from "../../src/DrillInView/SchemaControls/McpServerFormView"
import {McpServersSectionBody} from "../../src/DrillInView/SchemaControls/agentTemplate/McpServersSectionBody"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const settle = async () => {
    for (let i = 0; i < 3; i++) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

const click = async (label: string) => {
    const node = [...host.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === label,
    )
    expect(node, `no button reading "${label}"`).toBeTruthy()
    await act(async () => {
        node?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
    await settle()
}

const show = async (element: ReturnType<typeof createElement>) => {
    await act(async () => {
        root.render(element)
    })
    await settle()
}

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    seen.length = 0
    reported.length = 0
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

/** Each mount in this package, and the press that asks it to repair a login. */
const mounts: [string, () => Promise<void>][] = [
    [
        "the agent's configuration form, from the permission drawer's banner",
        async () => {
            await show(
                createElement(McpServerFormView, {
                    value: {connection: {type: "gateway", namespace: "custom", slug: TARGET.slug}},
                    onChange: vi.fn(),
                }),
            )
            await click("Set permissions")
            await click("Reconnect from the drawer")
        },
    ],
    [
        "the agent rail's section, from the add drawer's row",
        async () => {
            await show(
                createElement(McpServersSectionBody, {
                    items: [],
                    onChangeItems: vi.fn(),
                    openForm: vi.fn(),
                    removeItem: vi.fn(),
                    closeEditor: vi.fn(),
                    statusFor: () => undefined,
                    emptyAdd: null,
                    addOpen: true,
                    onAddClose: vi.fn(),
                }),
            )
            await click("Reconnect from the add drawer")
        },
    ],
    [
        "the in-chat connect request, for a server the tool plane refused",
        async () => {
            await show(
                createElement(GatewayConnectToolWidget, {
                    target: {plane: "mcp", name: TARGET.slug},
                    meta: {settled: false, output: null} as never,
                    settle: vi.fn(),
                } as never),
            )
            await click("Connect")
        },
    ],
]

describe("the mounts that open the sheet to repair a login", () => {
    for (const [name, open] of mounts) {
        it(`passes the selected connection through: ${name}`, async () => {
            await open()

            // The prop, not the shell: the sheet draws the same thing with or without one.
            expect(seen.at(-1)).toMatchObject({slug: TARGET.slug, name: TARGET.name})
            // And the one that was asked about, not whichever row came first (D154).
            expect(seen.at(-1)).not.toMatchObject({slug: endpoints[0].slug})
        })
    }
})

describe("what a reconnect must not do on the way back", () => {
    it("leaves the agent's item alone, prefix and all", async () => {
        // A reconnect renews a login on the connection the item already names. Writing the
        // item again on success would recompute the tool prefix from the display name, and
        // that prefix is frozen at the moment the server was added: an agent whose login
        // lapsed would come back with its tools renamed under it (D154, after D132).
        const onChange = vi.fn()
        await show(
            createElement(McpServerFormView, {
                value: {
                    connection: {type: "gateway", namespace: "custom", slug: TARGET.slug},
                    name: "frozen_prefix",
                },
                onChange,
            }),
        )
        await click("Set permissions")
        await click("Reconnect from the drawer")

        expect(seen.at(-1)).toMatchObject({slug: TARGET.slug})
        onChange.mockClear()

        await act(async () => {
            reported.at(-1)?.({id: TARGET.id, slug: TARGET.slug, name: TARGET.name})
        })
        await settle()

        expect(onChange).not.toHaveBeenCalled()
    })
})
