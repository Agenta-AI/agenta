// @vitest-environment jsdom
// The author line of an annotation: "By NAME, TIME", "By you, TIME" for the current user.
import {act} from "react"

import {setUserAtoms, UserAuthorLabel} from "@agenta/entities/shared"
import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeAll(() => {
    setUserAtoms({
        membersAtom: atom([
            {user: {id: "u-dana", username: "Dana"}},
            {user: {id: "u-me", username: "Sam"}},
        ]),
        currentUserAtom: atom({id: "u-me", username: "Sam"}),
    })
})

const clear = () => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
}

afterEach(() => {
    clear()
    vi.useRealTimers()
})

const draw = (node: React.ReactNode) => {
    clear()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(node))
    return host.textContent
}

it("reads By NAME, TIME with at, By you for the current user, and ignores the prefix", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-27T12:00:00Z"))
    expect(draw(<UserAuthorLabel userId="u-dana" at="2026-11-27T11:58:00Z" showPrefix />)).toBe(
        "By Dana, 2m ago",
    )
    expect(draw(<UserAuthorLabel userId="u-me" at="2026-11-27T11:59:50Z" />)).toBe(
        "By you, just now",
    )
    // Without at, the label is as before.
    expect(draw(<UserAuthorLabel userId="u-dana" />)).toBe("Dana")
})
