/**
 * When does an app ask for file access, and what does the answer leave behind?
 *
 * An app opens running with the stored answer, or none. A call that needs more asks about what it
 * tried: a read asks "read files?", a write asks "change files?". Refusals are remembered, so an app
 * that keeps writing is not asked again; a cancel holds for the run only. The host calls
 * `requestAccess(need)`; these tests play the host and answer through the dialog.
 */

import {act} from "react"

import type {AppAccess, GrantLevel, HtmlAppHost, HtmlAppHostOptions} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {type AssembleIo} from "../../src/drive/htmlApp/assemble"
import {
    createGrantStore,
    HtmlAppBody,
    HtmlAppEnvContext,
    type GrantStore,
} from "../../src/drive/htmlApp/HtmlAppBody"

const MOUNT = {id: "m1"} as never
const DIR = "apps/board"
const ENTRY = "apps/board/index.html"

const stubHost = (): HtmlAppHost => ({
    attach: vi.fn(),
    detach: vi.fn(),
    setVisible: vi.fn(),
    setTheme: vi.fn(),
    notifyChanged: vi.fn(),
    onError: () => () => undefined,
    onNav: () => () => undefined,
    setAccess: vi.fn(),
})

const io: AssembleIo = {
    fetchText: (path: string) =>
        Promise.resolve(
            path.endsWith("app.json") ? JSON.stringify({agenta_app: 1, name: "Board"}) : null,
        ),
    fetchDataUri: () => Promise.resolve(null),
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const settle = () =>
    act(async () => {
        await Promise.resolve()
        await Promise.resolve()
    })

const dialogText = () => document.querySelector("[role=dialog]")?.textContent ?? null

const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy()
    await act(async () => {
        element?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

const dialogButton = (label: string) =>
    [...document.querySelectorAll("[role=dialog] button")].find(
        (el) => el.textContent?.trim() === label,
    )

const open = async (
    opts: {
        grants?: GrantStore
        canEditMounts?: boolean
        path?: string
        io?: AssembleIo
    } = {},
) => {
    const grants = opts.grants ?? createGrantStore()
    const hosts: HtmlAppHost[] = []
    const createHost = vi.fn((_o: HtmlAppHostOptions) => {
        const host = stubHost()
        hosts.push(host)
        return host
    })
    await act(async () =>
        root.render(
            <HtmlAppEnvContext.Provider
                value={{
                    io: opts.io ?? io,
                    createHost,
                    grants,
                    canEditMounts: opts.canEditMounts ?? true,
                    kitCss: "",
                    bridgeStub: "",
                    resolveTokens: () => ({}),
                }}
            >
                <HtmlAppBody mount={MOUNT} path={opts.path ?? ENTRY} content="<html></html>" />
            </HtmlAppEnvContext.Provider>,
        ),
    )
    await settle()
    const built = () => createHost.mock.calls[createHost.mock.calls.length - 1]?.[0]
    const host = () => hosts[hosts.length - 1]
    return {grants, createHost, built, host}
}

/** What the host does when a call needs `need`: ask; the answer settles later. */
const call = async (options: HtmlAppHostOptions | undefined, need: GrantLevel) => {
    expect(options?.requestAccess).toBeTypeOf("function")
    let answer!: Promise<AppAccess>
    act(() => {
        answer = options!.requestAccess!(need)
    })
    await settle()
    // Wrapped: an async function returning the promise would wait for the answer itself.
    return {answer}
}

describe("opening never asks", () => {
    it("runs at once with no access and no dialog", async () => {
        const {built} = await open()
        expect(dialogText()).toBeNull()
        expect(built()?.grant).toBe("none")
    })

    it("runs with the stored level", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read-write", writeRefused: false})
        const {built} = await open({grants})
        expect(built()?.grant).toBe("read-write")
    })

    it("does not start the app before the manifest settles", async () => {
        let resolve!: (value: string) => void
        const waiting = new Promise<string>((done) => {
            resolve = done
        })
        const {createHost} = await open({
            io: {fetchText: () => waiting, fetchDataUri: () => Promise.resolve(null)},
        })
        expect(createHost).not.toHaveBeenCalled()
        await act(async () => resolve(JSON.stringify({agenta_app: 1, name: "Board"})))
        await settle()
        expect(createHost).toHaveBeenCalledTimes(1)
    })
})

describe("a read asks about reading", () => {
    it("Allow gives read and stores it", async () => {
        const {grants, built} = await open()
        const {answer} = await call(built(), "read")
        expect(dialogText()).toContain("Let Board read files in")
        await click(dialogButton("Allow"))
        await expect(answer).resolves.toBe("read")
        expect(grants.get("m1", DIR)).toEqual({level: "read", writeRefused: false})
    })

    it("Don't allow stores none, and a later read does not ask", async () => {
        const {grants, built} = await open()
        const first = await call(built(), "read")
        await click(dialogButton("Don't allow"))
        await expect(first.answer).resolves.toBe("none")
        expect(grants.get("m1", DIR)).toEqual({level: "none", writeRefused: false})

        const again = await call(built(), "read")
        expect(dialogText()).toBeNull()
        await expect(again.answer).resolves.toBe("none")
    })

    it("Cancel leaves no access for this run and stores nothing", async () => {
        const {grants, built} = await open()
        const first = await call(built(), "read")
        await click(document.querySelector('[role=dialog] [data-slot="dialog-close-x"]'))
        await expect(first.answer).resolves.toBe("none")
        expect(grants.get("m1", DIR)).toBeNull()

        const again = await call(built(), "read")
        expect(dialogText(), "not asked again in this run").toBeNull()
        await expect(again.answer).resolves.toBe("none")
    })
})

describe("a write asks about changing files", () => {
    it("read, then write: asks twice, and Allow on the second gives read-write", async () => {
        const {grants, built} = await open()
        const read = await call(built(), "read")
        await click(dialogButton("Allow"))
        await expect(read.answer).resolves.toBe("read")

        const write = await call(built(), "read-write")
        expect(dialogText()).toContain("Let Board change files in")
        await click(dialogButton("Allow"))
        await expect(write.answer).resolves.toBe("read-write")
        expect(grants.get("m1", DIR)).toEqual({level: "read-write", writeRefused: false})
    })

    it("a refused upgrade is remembered: the next write does not ask", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read", writeRefused: false})
        const {built} = await open({grants})
        const first = await call(built(), "read-write")
        await click(dialogButton("Don't allow"))
        await expect(first.answer).resolves.toBe("read")
        expect(grants.get("m1", DIR)).toEqual({level: "read", writeRefused: true})

        const reopened = await open({grants})
        const again = await call(reopened.built(), "read-write")
        expect(dialogText()).toBeNull()
        await expect(again.answer).resolves.toBe("read")
    })

    it("a write before any read asks about writing first", async () => {
        const {grants, built} = await open()
        const write = await call(built(), "read-write")
        expect(dialogText()).toContain("change files")
        await click(dialogButton("Don't allow"))
        await expect(write.answer).resolves.toBe("none")
        expect(grants.get("m1", DIR)).toEqual({level: null, writeRefused: true})

        const read = await call(built(), "read")
        expect(dialogText(), "reading is still its own question").toContain("read files")
        await click(dialogButton("Allow"))
        await expect(read.answer).resolves.toBe("read")
    })

    it("never asks about writing where edits are off", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read", writeRefused: false})
        const {built} = await open({grants, canEditMounts: false})
        const write = await call(built(), "read-write")
        expect(dialogText()).toBeNull()
        await expect(write.answer).resolves.toBe("read")
    })

    it("caps a stored read-write to read where edits are off", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read-write", writeRefused: false})
        const {built} = await open({grants, canEditMounts: false})
        expect(built()?.grant).toBe("read")
    })
})

describe("a stored change reaches the running app", () => {
    it("a downgrade from the setting applies to the live host at once", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read-write", writeRefused: false})
        const {host} = await open({grants})
        act(() => grants.set("m1", DIR, {level: "none", writeRefused: false}))
        expect(host().setAccess).toHaveBeenLastCalledWith("none")
        act(() => grants.set("m1", DIR, {level: "read", writeRefused: true}))
        expect(host().setAccess).toHaveBeenLastCalledWith("read")
    })

    it("a revoke stored while the write question is open wins over Allow", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read", writeRefused: false})
        const {built} = await open({grants})
        const write = await call(built(), "read-write")
        act(() => grants.set("m1", DIR, {level: "none", writeRefused: false}))
        await click(dialogButton("Allow"))
        await expect(write.answer).resolves.toBe("none")
        expect(grants.get("m1", DIR)).toEqual({level: "none", writeRefused: false})
    })

    it("a write refusal stored while the read question is open survives Allow", async () => {
        const {grants, built} = await open()
        const read = await call(built(), "read")
        act(() => grants.set("m1", DIR, {level: null, writeRefused: true}))
        await click(dialogButton("Allow"))
        await expect(read.answer).resolves.toBe("read")
        expect(grants.get("m1", DIR)).toEqual({level: "read", writeRefused: true})
    })

    it("does not carry a question into another folder", async () => {
        const grants = createGrantStore()
        const first = await open({grants})
        void (await call(first.built(), "read"))
        expect(dialogText()).not.toBeNull()
        const other = await open({grants, path: "apps/other/index.html"})
        expect(dialogText(), "switching folders closes the question").toBeNull()
        expect(other.built()?.dir).toBe("apps/other")
        expect(grants.get("m1", DIR)).toBeNull()
    })
})
