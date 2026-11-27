// @vitest-environment jsdom
import {useState, type KeyboardEvent} from "react"

import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {SearchInput} from "../../src/components/ui/input-composed"

afterEach(cleanup)

const Search = ({initial = ""}: {initial?: string}) => {
    const [value, setValue] = useState(initial)
    return <SearchInput aria-label="search" value={value} onValueChange={setValue} />
}

/** The container a catalog view sits in: it leaves on an Escape nothing else took. */
const renderInContainer = (initial: string) => {
    const leave = vi.fn()
    render(
        <div
            onKeyDown={(event) => {
                if (event.key === "Escape" && !event.defaultPrevented) leave()
            }}
        >
            <Search initial={initial} />
        </div>,
    )
    return leave
}

describe("SearchInput Escape", () => {
    it("the first Escape clears a filled search and the container does not leave", () => {
        const leave = renderInContainer("zzqx")
        const input = screen.getByLabelText("search") as HTMLInputElement
        fireEvent.keyDown(input, {key: "Escape"})
        expect(input.value).toBe("")
        expect(leave).not.toHaveBeenCalled()
    })

    it("Escape in an empty search reaches the container", () => {
        const leave = renderInContainer("")
        fireEvent.keyDown(screen.getByLabelText("search"), {key: "Escape"})
        expect(leave).toHaveBeenCalledTimes(1)
    })

    it("clear then Escape: the second Escape reaches the container", () => {
        const leave = renderInContainer("zzqx")
        const input = screen.getByLabelText("search")
        fireEvent.keyDown(input, {key: "Escape"})
        fireEvent.keyDown(input, {key: "Escape"})
        expect(leave).toHaveBeenCalledTimes(1)
    })

    it("a caller's own onKeyDown that handles Escape runs instead", () => {
        const own = vi.fn((event: KeyboardEvent) => event.preventDefault())
        render(<SearchInput aria-label="search" defaultValue="zzqx" onKeyDown={own} />)
        const input = screen.getByLabelText("search") as HTMLInputElement
        fireEvent.keyDown(input, {key: "Escape"})
        expect(own).toHaveBeenCalledTimes(1)
        expect(input.value).toBe("zzqx")
    })
})
