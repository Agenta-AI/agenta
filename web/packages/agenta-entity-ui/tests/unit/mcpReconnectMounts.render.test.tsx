/**
 * Every surface that offers to repair a login opens the sheet as a reconnect.
 *
 * D131's remainder. A case that builds its own payload and hands it to the sheet proves the
 * sheet, and stays green if every caller stops passing a reconnect — which is exactly what
 * one of them was doing (D132). So this mounts the components themselves and records what
 * reaches the sheet.
 *
 * The sheet stands in for itself, because what is under test is the prop it is given, not
 * what it draws with it; the drawers that carry the Reconnect affordance stand in for
 * themselves too, since each reads a tool catalogue on open and this file has no server.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const endpoints = [
    {
        // A connection whose login was revoked: no stored credential, which is what every
        // surface reads as "Login expired".
        id: "mcp-9",
        slug: "octolens",
        name: "Octolens",
        auth_mode: "oauth" as const,
        namespace: "custom" as const,
        data: {route: {base_url: "https://app.octolens.com/mcp"}},
    },
]

const {seen} = vi.hoisted(() => ({seen: [] as ({slug?: string; name?: string} | null)[]}))

// The barrel re-exports both shapes from this module, so the stub has to carry both or the
// components that import through it get an undefined element.
vi.mock("../../src/mcpEndpoint/McpConnectJourney", () => {
    const Journey = ({reconnect}: {reconnect?: {slug?: string; name?: string} | null}) => {
        seen.push(reconnect ?? null)
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

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => ({data: endpoints}),
    useSetAtom: () => async () => undefined,
}))

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

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    seen.length = 0
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

/** What the sheet was last handed. */
const lastReconnect = () => seen.at(-1)

describe("the mounts that offer to repair a login", () => {
    it("the agent's configuration form, from the permission drawer's banner", async () => {
        await act(async () => {
            root.render(
                createElement(McpServerFormView, {
                    value: {connection: {type: "gateway", namespace: "custom", slug: "octolens"}},
                    onChange: vi.fn(),
                }),
            )
        })
        await settle()

        await click("Set permissions")
        await click("Reconnect from the drawer")

        expect(lastReconnect()).toMatchObject({slug: "octolens", name: "Octolens"})
    })

    it("the agent rail's section, from the add drawer's row", async () => {
        await act(async () => {
            root.render(
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
        })
        await settle()

        await click("Reconnect from the add drawer")

        expect(lastReconnect()).toMatchObject({slug: "octolens", name: "Octolens"})
    })
})
