/**
 * The MCP drawer's Account block, for a reader who may not edit the agent.
 *
 * The API refuses such a reader the server's tools (`can_sign_in: false`), so a "Sign in" here
 * would lead nowhere. The drawer's own "no access" answer is what they should read.
 */
import {act, createElement} from "react"

import type {MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

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
    useAtomValue: () => "on",
}))

import {McpAccountBlock} from "../../src/DrillInView/SchemaControls/agentTemplate/accounts/McpAccountBlock"

const endpoint = {
    id: "endpoint-1",
    slug: "linear",
    name: "Linear",
    auth_mode: "oauth",
    user_sign_in: null,
} as unknown as MCPEndpoint

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const render = async (disabled: boolean) => {
    await act(async () => {
        root.render(
            createElement(McpAccountBlock, {
                endpoint,
                source: "user",
                onChange: vi.fn(),
                disabled,
            }),
        )
    })
}

const text = () => document.body.textContent ?? ""

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

describe("each person's own sign-in", () => {
    it("asks the reader who may edit the agent to sign in", async () => {
        await render(false)

        expect(text()).toContain("When you run it: not signed in")
        expect(text()).toContain("Sign in")
    })

    it("asks nothing of a reader who may not edit the agent", async () => {
        await render(true)

        expect(text()).not.toContain("When you run it")
        expect(text()).not.toContain("Sign in")
    })
})
