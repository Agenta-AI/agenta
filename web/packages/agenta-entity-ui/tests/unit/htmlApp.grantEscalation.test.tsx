/**
 * Choosing Run with a grant already on file: when does the sheet come back?
 *
 * The rule every design doc states is "ask again when the app needs a higher level than granted",
 * and the trap is the other half nobody writes down: a user who was OFFERED read-write and
 * deliberately picked read must not be asked again every time they open the app. The grant record
 * carries both levels so the two cases separate — this file is the four combinations.
 *
 * Everything the body touches from the outside (flag, mount io, host factory, grant store, the
 * upload permission) arrives through `HtmlAppEnvContext`, so no network, no jotai store and no
 * real bridge is needed here.
 */

import {act} from "react"

import type {GrantLevel, HtmlAppHost} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

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

/** Mount the body, let the manifest read settle, then click Run. Returns the grant store. */
const runWithStoredGrant = async (opts: {
    manifestAccess: GrantLevel
    stored?: {level: GrantLevel; asked: GrantLevel}
    canEditMounts?: boolean
}): Promise<GrantStore> => {
    const grants = createGrantStore()
    if (opts.stored) grants.set("m1", DIR, opts.stored.level, opts.stored.asked)

    await act(async () => {
        root.render(
            <HtmlAppEnvContext.Provider
                value={{
                    enabled: true,
                    io: manifestIo(opts.manifestAccess),
                    createHost: stubHost,
                    grants,
                    canEditMounts: opts.canEditMounts ?? true,
                    kitCss: "",
                    bridgeStub: "",
                    resolveTokens: () => ({}),
                }}
            >
                <HtmlAppBody mount={MOUNT} path={ENTRY} content="<html></html>" />
            </HtmlAppEnvContext.Provider>,
        )
    })
    // Let the manifest fetch resolve so `access` is known before Run is chosen.
    await act(async () => {
        await Promise.resolve()
    })

    const run = [...container.querySelectorAll("*")].find(
        (el) => el.children.length === 0 && el.textContent?.trim() === "Run",
    )
    expect(run, "the Run segment should be offered with the flag on").toBeTruthy()
    await act(async () => {
        run?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })
    return grants
}

/** The sheet is a dialog; its heading names the app. */
const sheetIsOpen = () => document.body.textContent?.includes("Run Board?") === true

describe("Run: when a stored grant sends you back to the sheet", () => {
    it("asks when the app now wants read-write and only read was ever offered", async () => {
        await runWithStoredGrant({
            manifestAccess: "read-write",
            stored: {level: "read", asked: "read"},
        })
        expect(sheetIsOpen()).toBe(true)
    })

    it("does NOT ask when read was chosen over an offered read-write", async () => {
        await runWithStoredGrant({
            manifestAccess: "read-write",
            stored: {level: "read", asked: "read-write"},
        })
        expect(sheetIsOpen()).toBe(false)
    })

    it("does NOT ask when the grant already covers what the app wants", async () => {
        await runWithStoredGrant({
            manifestAccess: "read-write",
            stored: {level: "read-write", asked: "read-write"},
        })
        expect(sheetIsOpen()).toBe(false)
    })

    it("does NOT ask when the user cannot be offered write anyway", async () => {
        // No EDIT_MOUNTS: the sheet has no write option, so re-prompting would only loop.
        await runWithStoredGrant({
            manifestAccess: "read-write",
            stored: {level: "read", asked: "read"},
            canEditMounts: false,
        })
        expect(sheetIsOpen()).toBe(false)
    })

    it("asks the first time, and records what the app asked for", async () => {
        const grants = await runWithStoredGrant({manifestAccess: "read-write"})
        expect(sheetIsOpen()).toBe(true)
        expect(grants.get("m1", DIR)).toBeNull()
    })
})
