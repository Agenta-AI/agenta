/** Declared `access` asks once for both; a read-only app that needs write gets the chip. */

import {act} from "react"

import {
    createHtmlAppHost,
    type FsClient,
    type Hello,
    type HtmlAppBridgeHost,
    type HtmlAppHostOptions,
    type ParentToIframe,
} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {type AssembleIo} from "../../src/drive/htmlApp/assemble"
import {HtmlAppBody} from "../../src/drive/htmlApp/HtmlAppBody"
import {
    createGrantStore,
    HtmlAppEnvContext,
    type GrantStore,
} from "../../src/drive/htmlApp/htmlAppEnv"

const MOUNT = {id: "m1"} as never
const DIR = "apps/board"
const DATA = "data/tasks.json"

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

const wait = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
    })

const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy()
    await act(async () => {
        element?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
}

const button = (label: string) =>
    [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label)

const dialogTitle = () =>
    document.querySelector("[role=dialog] [data-slot=dialog-title]")?.textContent ??
    document.querySelector("[role=dialog] h2")?.textContent ??
    null

/** The drive: one data file; writes are recorded by mount-relative path. */
const fakeClient = () => {
    const writes: string[] = []
    const client = {
        readJSON: async () => ({result: "[]", etag: "e1"}),
        writeJSON: async (path: string, body: string) => {
            writes.push(path)
            return {result: {path, size: body.length, mtime: null, etag: "e2"}, etag: "e2"}
        },
    } as unknown as FsClient
    return {client, writes}
}

/** Mounts the body with the real host; `attach` is driven by the test, not the iframe. */
const open = async (opts: {
    manifest: Record<string, unknown>
    grants?: GrantStore
    canEditMounts?: boolean
    openAccessSetting?: () => void
}) => {
    const grants = opts.grants ?? createGrantStore()
    const drive = fakeClient()
    const hosts: HtmlAppBridgeHost[] = []
    const io: AssembleIo = {
        fetchText: (path) =>
            Promise.resolve(
                path.endsWith("app.json")
                    ? JSON.stringify({agenta_app: 1, name: "Board", ...opts.manifest})
                    : null,
            ),
        fetchDataUri: () => Promise.resolve(null),
    }
    const createHost = (o: HtmlAppHostOptions) => {
        const real = createHtmlAppHost(o, {client: drive.client})
        hosts.push(real)
        return {...real, attach: () => undefined, detach: () => undefined}
    }
    await act(async () =>
        root.render(
            <HtmlAppEnvContext.Provider
                value={{
                    io,
                    createHost,
                    grants,
                    canEditMounts: opts.canEditMounts ?? true,
                    kitCss: "",
                    bridgeStub: "",
                    resolveTokens: () => ({}),
                    openAccessSetting: opts.openAccessSetting,
                }}
            >
                <HtmlAppBody mount={MOUNT} path={`${DIR}/index.html`} content="<html></html>" />
            </HtmlAppEnvContext.Provider>,
        ),
    )
    await wait()
    return {grants, drive, host: () => hosts[hosts.length - 1]}
}

/** A rule-following app: it reads its data, then saves only while `canWrite` is true. */
const runApp = (host: HtmlAppBridgeHost) => {
    let hello: Hello | null = null
    let port: MessagePort | null = null
    host.attach({
        contentWindow: {
            postMessage(msg: Hello, _origin: string, transfer: MessagePort[]) {
                hello = msg
                port = transfer[0]
            },
        },
    } as unknown as HTMLIFrameElement)
    const app = {canWrite: (hello as Hello | null)?.canWrite === true, saved: false}
    const replies = new Map<number, () => void>()
    const channel = port as unknown as MessagePort
    channel.onmessage = (event: MessageEvent) => {
        const msg = event.data as ParentToIframe & {id?: number}
        if ("type" in msg && msg.type === "access") app.canWrite = msg.canWrite
        else if (typeof msg.id === "number") replies.get(msg.id)?.()
    }
    const send = (id: number, method: string, body?: string) =>
        new Promise<void>((resolve) => {
            replies.set(id, resolve)
            channel.postMessage({v: 1, id, method, path: DATA, body})
        })
    const done = (async () => {
        await send(1, "readJSON")
        if (!app.canWrite) return
        await send(2, "writeJSON", "[]")
        app.saved = true
    })()
    return {app, done, close: () => channel.close()}
}

describe("a manifest that declares read-write", () => {
    it("asks once for both; Allow read and write lets the app's save reach the drive", async () => {
        const {grants, drive, host} = await open({manifest: {access: "read-write"}})
        const run = runApp(host())
        await wait()
        expect(dialogTitle()).toContain("Let Board read and change files in")
        expect(document.body.textContent).toContain("This app needs to save your edits.")

        await click(button("Allow read and write"))
        await run.done
        await wait()

        expect(drive.writes).toEqual([`${DIR}/${DATA}`])
        expect(grants.get("m1", DIR)).toEqual({level: "read-write", writeRefused: false})
        expect(button("Read only · Allow editing")).toBeUndefined()
        run.close()
    })

    it("Read only stores read, refuses write, and shows the chip that opens File access", async () => {
        const openAccessSetting = vi.fn()
        const {grants, drive, host} = await open({
            manifest: {access: "read-write"},
            openAccessSetting,
        })
        const run = runApp(host())
        await wait()

        await click(button("Read only"))
        await run.done
        await wait()

        expect(drive.writes).toEqual([])
        expect(grants.get("m1", DIR)).toEqual({level: "read", writeRefused: true})
        await click(button("Read only · Allow editing"))
        expect(openAccessSetting).toHaveBeenCalledOnce()
        run.close()
    })

    it("a stored read that never refused write: the chip asks for write and the app can write", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read", writeRefused: false})
        const {host} = await open({manifest: {access: "read-write"}, grants})
        const run = runApp(host())
        await run.done
        expect(run.app.canWrite).toBe(false)

        await click(button("Read only · Allow editing"))
        expect(dialogTitle()).toContain("Let Board change files in")
        expect(button("Read only")).toBeUndefined()
        await click(button("Allow"))
        await wait()

        expect(run.app.canWrite).toBe(true)
        expect(button("Read only · Allow editing")).toBeUndefined()
        run.close()
    })

    it("Don't allow from the chip keeps read and refuses write", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read", writeRefused: false})
        const {host} = await open({manifest: {access: "read-write"}, grants})
        const run = runApp(host())
        await run.done

        await click(button("Read only · Allow editing"))
        await click(button("Don't allow"))
        await wait()

        expect(grants.get("m1", DIR)).toEqual({level: "read", writeRefused: true})
        run.close()
    })

    it("where edits are off: the read question says the app needs write, and no chip", async () => {
        const {host} = await open({manifest: {access: "read-write"}, canEditMounts: false})
        const run = runApp(host())
        await wait()
        expect(dialogTitle()).toContain("Let Board read files in")
        expect(document.body.textContent).toContain(
            "This app needs write access, but you can only read here.",
        )
        await click(button("Allow"))
        await run.done
        await wait()
        expect(button("Read only · Allow editing")).toBeUndefined()
        run.close()
    })
})

describe("a manifest without access", () => {
    it("a write refused for read-only access shows the chip", async () => {
        const grants = createGrantStore()
        grants.set("m1", DIR, {level: "read", writeRefused: true})
        const {host} = await open({manifest: {}, grants})
        expect(button("Read only · Allow editing")).toBeUndefined()

        const res = await host().handle({v: 1, id: 9, method: "writeJSON", path: DATA, body: "[]"})
        await wait()

        expect(res).toMatchObject({ok: false, error: {code: "read_only"}})
        expect(button("Read only · Allow editing")).toBeTruthy()
    })
})
