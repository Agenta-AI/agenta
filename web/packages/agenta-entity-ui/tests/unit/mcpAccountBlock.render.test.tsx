/**
 * The Account part of an MCP server view (F03 f6, f7): the switch "Each person's own" or "One
 * shared sign-in", "Your sign-in" with the account name when the server gave one (task 39.2), and
 * the cases where the switch or the sign-in must not show.
 */
import {act, createElement} from "react"

import type {MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {access, runsWithoutPerson} = vi.hoisted(() => ({
    access: {value: "on"},
    runsWithoutPerson: {value: false},
}))

vi.mock("@agenta/entities/mcpEndpoint", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/mcpEndpoint")>()),
    usePersonalMcpSignIn: () => ({
        pendingId: null,
        error: null,
        signIn: vi.fn(),
        signInWithToken: vi.fn(),
        signOut: vi.fn(),
    }),
}))

vi.mock("jotai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("jotai")>()),
    useAtomValue: () => access.value,
}))

vi.mock("../../src/DrillInView/SchemaControls/agentTemplate/accounts/useRunsWithoutPerson", () => ({
    useRunsWithoutPerson: () => runsWithoutPerson.value,
}))

vi.mock("../../src/accounts/useItemAccount", () => ({useItemWorkflowId: () => "wf-1"}))

import {McpAccountBlock} from "../../src/DrillInView/SchemaControls/agentTemplate/accounts/McpAccountBlock"

const endpoint = (over: Partial<MCPEndpoint> = {}) =>
    ({
        id: "endpoint-1",
        slug: "linear",
        name: "linear",
        namespace: "custom",
        auth_mode: "oauth",
        user_sign_in: null,
        ...over,
    }) as unknown as MCPEndpoint

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let onChange: ReturnType<typeof vi.fn>

const render = async ({
    server = endpoint(),
    source = "user",
    disabled = false,
}: {server?: MCPEndpoint; source?: "user" | "agent"; disabled?: boolean} = {}) => {
    onChange = vi.fn()
    await act(async () => {
        root.render(
            createElement(McpAccountBlock, {
                endpoint: server,
                source,
                onChange,
                context: {revisionId: "rev-1", agent: {}},
                disabled,
            }),
        )
    })
}

const text = () => document.body.textContent ?? ""
const radio = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) =>
        (node.textContent ?? "").includes(label),
    )

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    access.value = "on"
    runsWithoutPerson.value = false
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

describe("the account switch", () => {
    it("offers each person's own and one shared sign-in, and writes the pick at once", async () => {
        await render({source: "agent"})
        expect(text()).toContain("Choose whose linear sign-in the agent uses")
        expect(text()).toContain("Everyone uses their own linear sign-in.")
        expect(text()).toContain("Everyone uses the sign-in of the project.")
        expect(text()).toContain("Shared sign-in")
        expect(text()).toContain("The project's sign-in")
        await act(async () => radio("Each person's own")!.click())
        expect(onChange).toHaveBeenCalledWith("user")
    })

    it("is hidden with personal accounts off, for a server with no sign-in, and with no server", async () => {
        access.value = "off"
        await render({source: "agent"})
        expect(radio("Each person's own")).toBeUndefined()
        expect(text()).toContain("Shared sign-in")

        access.value = "on"
        await render({server: endpoint({auth_mode: "none"}), source: "agent"})
        expect(radio("Each person's own")).toBeUndefined()

        await render({server: null as unknown as MCPEndpoint, source: "agent"})
        expect(radio("Each person's own")).toBeUndefined()
    })

    it("keeps a saved each person's own visible when personal accounts are off", async () => {
        access.value = "off"
        await render({source: "user"})
        expect(radio("Each person's own")?.getAttribute("aria-checked")).toBe("true")
    })

    it("warns about runs without a person only when the agent has them", async () => {
        await render()
        expect(text()).not.toContain("have no person")
        runsWithoutPerson.value = true
        await render()
        expect(text()).toContain("so this server is not available to them")
    })
})

describe("your sign-in", () => {
    it("asks a reader who has not signed in to sign in to the server", async () => {
        await render()
        expect(text()).toContain("Your sign-in")
        expect(text()).toContain("The linear sign-in your own runs use")
        expect(text()).toContain("Not signed in yet")
        expect(text()).toContain("Sign in to linear")
    })

    it("names the account the server gave, with Sign out", async () => {
        await render({
            server: endpoint({user_sign_in: {is_ready: true, account_name: "Lena at Acme"}}),
        })
        expect(text()).toContain("Your sign-in: Lena at Acme")
        expect(text()).toContain("Sign out")
    })

    it("says Signed in when the server gave no name", async () => {
        await render({server: endpoint({user_sign_in: {is_ready: true}})})
        expect(text()).toContain("Signed in")
        expect(text()).not.toContain("Your sign-in:")
        expect(text()).toContain("Sign out")
    })

    it("shows an expired own sign-in with the sign-in button", async () => {
        await render({server: endpoint({user_sign_in: {is_ready: false}})})
        expect(text()).toContain("When you run it: your sign-in expired")
        expect(text()).toContain("Sign in to linear")
    })

    it("asks nothing of a reader who may not edit the agent", async () => {
        await render({disabled: true})
        expect(text()).not.toContain("Sign in to linear")
        expect(text()).not.toContain("Not signed in yet")
    })
})
