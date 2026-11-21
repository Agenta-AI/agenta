// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {pageSessionIdAtom, usePublishPageSessionId} from "@/features/chat/pageSessionId"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const SessionPage = ({sessionId}: {sessionId: string}) => {
    usePublishPageSessionId(sessionId)
    return null
}

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>

beforeEach(() => {
    store = createStore()
    host = document.createElement("div")
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
})

const render = (node: React.ReactNode) =>
    act(async () => root.render(<Provider store={store}>{node}</Provider>))

describe("pageSessionIdAtom", () => {
    it("names the session the page shows, follows a switch and clears off the page", async () => {
        await render(<SessionPage sessionId="s1" />)
        expect(store.get(pageSessionIdAtom)).toBe("s1")

        await render(<SessionPage sessionId="s2" />)
        expect(store.get(pageSessionIdAtom)).toBe("s2")

        await render(null)
        expect(store.get(pageSessionIdAtom)).toBeNull()
    })
})
