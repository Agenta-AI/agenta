/**
 * A chat mention becomes a file link without reading the file's content (#7522): known files come
 * from the record log, the rest from an existence check on the parent folder's listing.
 */
import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({
    records: [] as string[],
    listed: new Set<string>(),
    existsCalls: [] as {mountId: string; path: string}[],
    contentCalls: [] as {mountId: string; path: string}[],
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/session")>()
    const mounts = atom({data: [{id: "m1", name: "cwd"}]})
    const recency = atom(() => new Map(state.records.map((p) => [p, 1])))
    const exists = new Map<string, ReturnType<typeof atom<boolean | null>>>()
    const empty = atom({data: undefined})
    return {
        ...actual,
        sessionMountsQueryFamily: () => mounts,
        sessionRecordFileRecencyAtomFamily: () => recency,
        mountFileExistsAtomFamily: (params: {mountId: string; path: string}) => {
            const key = `${params.mountId}:${params.path}`
            if (!exists.has(key)) {
                state.existsCalls.push(params)
                exists.set(key, atom(params.mountId ? state.listed.has(params.path) : null))
            }
            return exists.get(key)
        },
        mountFileContentQueryFamily: (params: {mountId: string; path: string}) => {
            state.contentCalls.push(params)
            return empty
        },
    }
})

import {chatFileResolver} from "../../src/drive/chatFileRefs"
import {DriveSessionProvider} from "../../src/drive/driveSessionContext"

class InViewObserver {
    constructor(private callback: IntersectionObserverCallback) {}
    observe() {
        this.callback([{isIntersecting: true} as IntersectionObserverEntry], this as never)
    }
    disconnect() {}
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", InViewObserver)
    state.records = []
    state.listed = new Set()
    state.existsCalls = []
    state.contentCalls = []
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
})

const render = (text: string) =>
    act(async () => {
        root.render(
            <Provider store={createStore()}>
                <DriveSessionProvider sessionId="s1">
                    {chatFileResolver.renderCode(text, <code>{text}</code>)}
                </DriveSessionProvider>
            </Provider>,
        )
    })

const link = (name: string) => {
    const base = name.split("/").pop()
    return (
        Array.from(container.querySelectorAll("button")).find((b) => b.textContent === base) ?? null
    )
}
const checkedPaths = () => state.existsCalls.filter((c) => c.mountId).map((c) => c.path)

describe("chat file mentions", () => {
    it("links clip.mp4 through the listing check and never reads its content", async () => {
        state.listed.add("clip.mp4")

        await render("clip.mp4")

        expect(link("clip.mp4")).not.toBeNull()
        expect(checkedPaths()).toEqual(["clip.mp4"])
        expect(state.contentCalls).toHaveLength(0)
    })

    it("keeps plain code when the listing lacks the file", async () => {
        await render("media/clip.mp4")

        expect(link("media/clip.mp4")).toBeNull()
        expect(container.textContent).toBe("media/clip.mp4")
        expect(checkedPaths()).toEqual(["media/clip.mp4"])
        expect(state.contentCalls).toHaveLength(0)
    })

    it("links a bare name the agent wrote at the cwd root with no check", async () => {
        state.records = ["clip.mp4"]

        await render("clip.mp4")

        expect(link("clip.mp4")).not.toBeNull()
        expect(state.existsCalls).toHaveLength(0)
    })
})
