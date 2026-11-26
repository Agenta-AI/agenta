// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

const router = vi.hoisted(() => ({
    asPath: "/w/x/p/y/nope",
    basePath: "/m",
    back: vi.fn(),
    push: vi.fn(),
}))
vi.mock("next/router", () => ({useRouter: () => router}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))

import {PageNotFound} from "@/components/PageNotFound"

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe("404 page", () => {
    // A link opened in a fresh tab has no history: router.back() did nothing.
    it("Go back goes home when the tab has no history", () => {
        render(<PageNotFound />)
        fireEvent.click(screen.getByRole("button", {name: "Go back"}))
        expect(router.back).not.toHaveBeenCalled()
        expect(router.push).toHaveBeenCalledWith("/")
    })

    it("the logo links home", () => {
        render(<PageNotFound />)
        expect(screen.getByRole("link", {name: "Agenta home"}).getAttribute("href")).toBe("/m/")
    })
})
