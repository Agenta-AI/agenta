/**
 * When does an app ask for file access, and what does the answer leave behind?
 *
 * An app opens running with no access. Its first file call asks (the host calls `requestAccess`),
 * unless an answer is on file. The trap is escalation: a user who was OFFERED read-write and
 * deliberately picked read must not be asked again, while an app whose manifest later grows to
 * read-write asks once more. The grant record carries both levels so the two cases separate.
 *
 * Everything the body touches from the outside (mount io, host factory, grant store, the
 * upload permission) arrives through `HtmlAppEnvContext`, so no network, no jotai store and no
 * real bridge is needed here.
 */

import {act} from "react"

import type {
    AppAccess,
    GrantLevel,
    HtmlAppHost,
    HtmlAppHostOptions,
} from "@agenta/entities/drive"
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

/** A host that does nothing: the test never reaches the iframe. */
const stubHost = (): HtmlAppHost => ({
    attach: vi.fn(),
    detach: vi.fn(),
    setVisible: vi.fn(),
    setTheme: vi.fn(),
    notifyChanged: vi.fn(),
    onError: () => () => undefined,
    onNav: () => () => undefined,
})

/** Serves one `app.json` declaring `access`, and nothing else. */
const manifestIo = (access: GrantLevel) => ({
    fetchText: (path: string) =>
        Promise.resolve(
            path.endsWith("app.json")
                ? JSON.stringify({agenta_app: 1, name: "Board", access})
                : null,
        ),
    fetchDataUri: () => Promise.resolve(null),
})

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

const sheetIsOpen = () => document.body.textContent?.includes("Let Board use files?") === true

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

const renderBody = async (opts: {
    grants: GrantStore
    io: AssembleIo
    createHost: (o: HtmlAppHostOptions) => HtmlAppHost
    path?: string
    canEditMounts?: boolean
}) => {
    await act(async () =>
        root.render(
            <HtmlAppEnvContext.Provider
                value={{
                    io: opts.io,
                    createHost: opts.createHost,
                    grants: opts.grants,
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
}

/** Open the app with an optional stored answer; returns what the host was built with. */
const open = async (opts: {
    manifestAccess: GrantLevel
    stored?: {level: AppAccess; asked: GrantLevel}
    canEditMounts?: boolean
}) => {
    const grants = createGrantStore()
    if (opts.stored) grants.set("m1", DIR, opts.stored.level, opts.stored.asked)
    const createHost = vi.fn((_o: HtmlAppHostOptions) => stubHost())
    await renderBody({
        grants,
        io: manifestIo(opts.manifestAccess),
        createHost,
        canEditMounts: opts.canEditMounts,
    })
    const built = () => createHost.mock.calls[createHost.mock.calls.length - 1]?.[0]
    return {grants, createHost, built}
}

/** What the host does on the app's first file call: ask; the answer settles later. */
const firstFileCall = async (options: HtmlAppHostOptions | undefined) => {
    expect(options?.requestAccess).toBeTypeOf("function")
    let answer!: Promise<AppAccess>
    act(() => {
        answer = options!.requestAccess!()
    })
    await settle()
    // Wrapped: an async function returning the promise would wait for the answer itself.
    return {answer}
}

describe("Run: opening never asks", () => {
    it("runs at once with no access and no sheet", async () => {
        const {built} = await open({manifestAccess: "read-write"})
        expect(sheetIsOpen()).toBe(false)
        expect(built()?.grant).toBe("none")
    })

    it("does not start the app before the manifest settles", async () => {
        let resolve!: (value: string) => void
        const waiting = new Promise<string>((done) => {
            resolve = done
        })
        const createHost = vi.fn((_o: HtmlAppHostOptions) => stubHost())
        await renderBody({
            grants: createGrantStore(),
            io: {fetchText: () => waiting, fetchDataUri: () => Promise.resolve(null)},
            createHost,
        })
        expect(createHost).not.toHaveBeenCalled()
        await act(async () =>
            resolve(JSON.stringify({agenta_app: 1, name: "Board", access: "read"})),
        )
        await settle()
        expect(createHost).toHaveBeenCalledTimes(1)
        expect(sheetIsOpen()).toBe(false)
    })
})

describe("Run: the first file call asks", () => {
    it("Allow stores the answer and hands it to the running host", async () => {
        const {grants, built, createHost} = await open({manifestAccess: "read-write"})
        const {answer} = await firstFileCall(built())
        expect(sheetIsOpen()).toBe(true)
        await click(dialogButton("Allow"))
        await expect(answer).resolves.toBe("read-write")
        expect(grants.get("m1", DIR)).toEqual({level: "read-write", asked: "read-write"})
        expect(createHost).toHaveBeenCalledTimes(1)
    })

    it("Don't allow is stored, so the next open does not ask", async () => {
        const {grants, built} = await open({manifestAccess: "read"})
        const {answer} = await firstFileCall(built())
        await click(document.querySelector('[role=radio][value="none"]'))
        await click(dialogButton("Don't allow"))
        await expect(answer).resolves.toBe("none")
        expect(grants.get("m1", DIR)).toEqual({level: "none", asked: "read"})

        const again = await open({manifestAccess: "read", stored: {level: "none", asked: "read"}})
        expect(again.built()?.grant).toBe("none")
        expect(again.built()?.requestAccess).toBeUndefined()
    })

    it("Cancel leaves no access for this run and stores nothing", async () => {
        const {grants, built, createHost} = await open({manifestAccess: "read"})
        const {answer} = await firstFileCall(built())
        await click(dialogButton("Cancel"))
        await expect(answer).resolves.toBe("none")
        expect(grants.get("m1", DIR)).toBeNull()
        expect(sheetIsOpen()).toBe(false)
        expect(createHost).toHaveBeenCalledTimes(1)
    })

    it("never records write access when write permission is off", async () => {
        const {grants, built} = await open({manifestAccess: "read-write", canEditMounts: false})
        const {answer} = await firstFileCall(built())
        await click(dialogButton("Allow"))
        await expect(answer).resolves.toBe("read")
        expect(grants.get("m1", DIR)).toEqual({level: "read", asked: "read-write"})
    })

    it("does not carry a selection into a different app's request", async () => {
        const grants = createGrantStore()
        const createHost = vi.fn((_o: HtmlAppHostOptions) => stubHost())
        const io = manifestIo("read-write")
        await renderBody({grants, io, createHost})
        await firstFileCall(createHost.mock.calls[0][0])
        await click(document.querySelector('[role=radio][value="read"]'))
        await renderBody({grants, io, createHost, path: "apps/other/index.html"})
        const other = createHost.mock.calls.find(([o]) => o.dir === "apps/other")?.[0]
        await firstFileCall(other)
        await click(dialogButton("Allow"))
        expect(grants.get("m1", DIR)).toBeNull()
        expect(grants.get("m1", "apps/other")).toEqual({level: "read-write", asked: "read-write"})
    })
})

describe("Run: when a stored answer asks again", () => {
    it("asks when the app now wants read-write and only read was ever offered", async () => {
        const {built} = await open({
            manifestAccess: "read-write",
            stored: {level: "read", asked: "read"},
        })
        expect(built()?.grant).toBe("none")
        expect(built()?.requestAccess).toBeTypeOf("function")
    })

    it("does NOT ask when read was chosen over an offered read-write", async () => {
        const {built} = await open({
            manifestAccess: "read-write",
            stored: {level: "read", asked: "read-write"},
        })
        expect(built()?.grant).toBe("read")
        expect(built()?.requestAccess).toBeUndefined()
    })

    it("does NOT ask when the grant already covers what the app wants", async () => {
        const {built} = await open({
            manifestAccess: "read-write",
            stored: {level: "read-write", asked: "read-write"},
        })
        expect(built()?.grant).toBe("read-write")
        expect(built()?.requestAccess).toBeUndefined()
    })

    it("does NOT ask when the user cannot be offered write anyway", async () => {
        // No EDIT_MOUNTS: the sheet has no write option, so re-prompting would only loop.
        const {built} = await open({
            manifestAccess: "read-write",
            stored: {level: "read", asked: "read"},
            canEditMounts: false,
        })
        expect(built()?.grant).toBe("read")
        expect(built()?.requestAccess).toBeUndefined()
    })
})
