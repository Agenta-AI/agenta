// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandShortcut,
} from "../../src/components/ui/command"

// jsdom has no ResizeObserver; cmdk sizes its list with one.
class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver
// cmdk's list scrolls the selected row into view.
Element.prototype.scrollIntoView ??= () => {}

afterEach(cleanup)

const Palette = ({onSelect}: {onSelect?: (value: string) => void}) => (
    <Command>
        <CommandInput placeholder="Type a command" />
        <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup heading="Suggestions">
                <CommandItem value="calendar" onSelect={onSelect}>
                    Calendar
                    <CommandShortcut>⌘C</CommandShortcut>
                </CommandItem>
                <CommandItem value="search emoji" onSelect={onSelect}>
                    Search Emoji
                </CommandItem>
            </CommandGroup>
        </CommandList>
    </Command>
)

describe("Command", () => {
    it("renders the parts with their slots and the group heading", () => {
        render(<Palette />)
        expect(document.querySelector('[data-slot="command"]')).not.toBeNull()
        expect(document.querySelector('[data-slot="command-input"]')).not.toBeNull()
        expect(document.querySelectorAll('[data-slot="command-item"]')).toHaveLength(2)
        expect(screen.getByText("Suggestions")).toBeTruthy()
        expect(screen.getByText("⌘C").getAttribute("data-slot")).toBe("command-shortcut")
    })

    it("filters rows as you type and shows the empty state when nothing matches", () => {
        render(<Palette />)
        const input = screen.getByPlaceholderText("Type a command")
        fireEvent.change(input, {target: {value: "emoji"}})
        expect(screen.queryByText("Calendar")).toBeNull()
        expect(screen.getByText("Search Emoji")).toBeTruthy()
        expect(screen.queryByText("No results")).toBeNull()

        fireEvent.change(input, {target: {value: "zzz"}})
        expect(screen.getByText("No results")).toBeTruthy()
    })

    it("selects a row on click", () => {
        const onSelect = vi.fn()
        render(<Palette onSelect={onSelect} />)
        fireEvent.click(screen.getByText("Search Emoji"))
        expect(onSelect).toHaveBeenCalledWith("search emoji")
    })
})
