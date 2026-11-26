// @vitest-environment jsdom
/**
 * MCPs → a person's own sign-in to a project server, as a status cell. Each case is a way the
 * cell could mislead: a server that needs no sign-in offered one, a missing sign-in read as
 * ready, or a held sign-in that still accepts clicks.
 */
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {McpSignInCell, asksForSignIn, isSignedIn} from "../../src/mcp/McpSignInCell"

interface Server {
    id: string
    slug: string
    name: string
    auth_mode: "oauth" | "api_key" | "none"
    user_sign_in?: {is_ready: boolean; account_name?: string} | null
    data: {route: {base_url: string}}
}

const server = (over: Partial<Server> & Pick<Server, "id" | "name">): Server => ({
    slug: over.id,
    auth_mode: "oauth",
    data: {route: {base_url: `https://mcp.${over.id}.example/mcp`}},
    ...over,
})

afterEach(cleanup)

describe("asksForSignIn", () => {
    it("is false only for a server with no auth", () => {
        expect(asksForSignIn(server({id: "a", name: "A"}) as never)).toBe(true)
        expect(asksForSignIn(server({id: "a", name: "A", auth_mode: "api_key"}) as never)).toBe(
            true,
        )
        expect(asksForSignIn(server({id: "a", name: "A", auth_mode: "none"}) as never)).toBe(false)
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

describe("McpSignInCell", () => {
    it("says Signed in as You for a ready sign-in, with no Sign in button", () => {
        render(
            <McpSignInCell
                endpoint={server({id: "l", name: "L", user_sign_in: {is_ready: true}}) as never}
                pending={false}
                onSignIn={vi.fn()}
            />,
        )
        expect(screen.getByTestId("mcp-personal-status").textContent).toBe("Signed in as You")
        expect(screen.queryByRole("button", {name: "Sign in"})).toBeNull()
    })

    it("offers Sign in without a ready sign-in, and passes the server", () => {
        const onSignIn = vi.fn()
        const endpoint = server({id: "n", name: "N", user_sign_in: null})
        render(<McpSignInCell endpoint={endpoint as never} pending={false} onSignIn={onSignIn} />)
        fireEvent.click(screen.getByRole("button", {name: "Sign in"}))
        expect(onSignIn).toHaveBeenCalledWith(endpoint)
    })

    it("holds Sign in while another sign-in runs", () => {
        render(
            <McpSignInCell
                endpoint={server({id: "n", name: "N", user_sign_in: null}) as never}
                pending
                onSignIn={vi.fn()}
            />,
        )
        expect((screen.getByRole("button", {name: "Sign in"}) as HTMLButtonElement).disabled).toBe(
            true,
        )
    })

    it("shows nothing for a server that asks for no sign-in", () => {
        render(
            <McpSignInCell
                endpoint={server({id: "o", name: "O", auth_mode: "none"}) as never}
                pending={false}
                onSignIn={vi.fn()}
            />,
        )
        expect(screen.queryByTestId("mcp-personal-status")).toBeNull()
        expect(screen.queryByRole("button")).toBeNull()
    })
})
