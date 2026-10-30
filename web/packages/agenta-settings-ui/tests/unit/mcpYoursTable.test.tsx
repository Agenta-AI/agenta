// @vitest-environment jsdom
/**
 * MCPs → "Yours": a person's own sign-ins to the project's servers. Each case is a way the
 * group could mislead: a server that needs no sign-in listed as one to sign in to, a missing
 * sign-in read as ready, or a token server sent to an OAuth popup.
 */
import {cleanup, fireEvent, render, screen, within} from "@testing-library/react"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {McpYoursTable, isSignedIn, personalSignInServers} from "../../src/mcp/McpYoursTable"

const hook = vi.hoisted(() => ({
    pendingId: null as string | null,
    signIn: vi.fn(),
    signInWithToken: vi.fn(async () => true),
    signOut: vi.fn(async () => undefined),
}))

vi.mock("@agenta/entities/mcpEndpoint", () => ({
    usePersonalMcpSignIn: () => ({error: null, ...hook}),
}))

interface Server {
    id: string
    slug: string
    name: string
    auth_mode: "oauth" | "api_key" | "none"
    user_sign_in?: {is_ready: boolean} | null
    data: {route: {base_url: string}}
}

const server = (over: Partial<Server> & Pick<Server, "id" | "name">): Server => ({
    slug: over.id,
    auth_mode: "oauth",
    data: {route: {base_url: `https://mcp.${over.id}.example/mcp`}},
    ...over,
})

const renderTable = (servers: Server[], confirm = vi.fn()) =>
    render(
        <McpYoursTable
            servers={servers as never}
            collapsed={false}
            onToggle={() => undefined}
            confirm={confirm}
        />,
    )

beforeEach(() => {
    hook.pendingId = null
    hook.signIn.mockClear()
    hook.signInWithToken.mockClear()
    hook.signOut.mockClear()
})
afterEach(cleanup)

describe("personalSignInServers", () => {
    it("leaves out a server that needs no sign-in", () => {
        const servers = [
            server({id: "linear", name: "Linear"}),
            server({id: "open", name: "Open", auth_mode: "none"}),
            server({id: "gh", name: "GitHub", auth_mode: "api_key"}),
        ]
        expect(personalSignInServers(servers as never).map((s) => s.id)).toEqual(["linear", "gh"])
    })
})

describe("isSignedIn", () => {
    it("is true only for a ready sign-in", () => {
        expect(
            isSignedIn(server({id: "a", name: "A", user_sign_in: {is_ready: true}}) as never),
        ).toBe(true)
        expect(
            isSignedIn(server({id: "a", name: "A", user_sign_in: {is_ready: false}}) as never),
        ).toBe(false)
        expect(isSignedIn(server({id: "a", name: "A", user_sign_in: null}) as never)).toBe(false)
    })
})

describe("McpYoursTable", () => {
    it("shows the person's state per server", () => {
        renderTable([
            server({id: "linear", name: "Linear", user_sign_in: {is_ready: true}}),
            server({id: "notion", name: "Notion", user_sign_in: null}),
        ])
        const statuses = screen.getAllByTestId("mcp-personal-status")
        expect(statuses[0]?.textContent).toContain("Signed in as you")
        expect(within(statuses[0] as HTMLElement).queryByText("Sign in")).toBeNull()
        expect(statuses[1]?.textContent).toContain("Not signed in")
        expect(within(statuses[1] as HTMLElement).getByText("Sign in")).toBeTruthy()
    })

    it("opens the OAuth sign-in inside the click", () => {
        renderTable([server({id: "notion", name: "Notion", user_sign_in: null})])
        fireEvent.click(screen.getByText("Sign in"))
        expect(hook.signIn).toHaveBeenCalledTimes(1)
    })

    it("asks a token server for the person's token instead of a popup", () => {
        renderTable([server({id: "gh", name: "GitHub", auth_mode: "api_key", user_sign_in: null})])
        fireEvent.click(screen.getByText("Sign in"))
        expect(hook.signIn).not.toHaveBeenCalled()
        expect(screen.getByText("Sign in to GitHub")).toBeTruthy()
    })

    it("holds every Sign in while one sign-in runs, since the hook tracks one", () => {
        hook.pendingId = "linear"
        renderTable([
            server({id: "linear", name: "Linear", user_sign_in: null}),
            server({id: "notion", name: "Notion", user_sign_in: null}),
        ])
        for (const button of screen.getAllByRole("button", {name: "Sign in"})) {
            expect((button as HTMLButtonElement).disabled).toBe(true)
        }
    })

    it("offers Sign out only where the person has a sign-in", () => {
        renderTable([server({id: "notion", name: "Notion", user_sign_in: null})])
        expect(screen.queryByRole("button", {name: "Sign-in actions"})).toBeNull()
    })
})
