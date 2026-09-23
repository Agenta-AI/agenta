import {describe, expect, it} from "vitest"

import * as driveBarrel from "../../src/drive"
import {
    APP_DEFAULT_ENTRY,
    APP_MANIFEST_FILENAME,
    isAppFolderListing,
    parseManifest,
} from "../../src/drive/htmlApp/manifest"

describe("@agenta/entities/drive barrel", () => {
    it("re-exports the htmlApp contracts", () => {
        expect(driveBarrel.parseManifest).toBe(parseManifest)
        expect(driveBarrel.APP_MANIFEST_FILENAME).toBe(APP_MANIFEST_FILENAME)
        expect(typeof driveBarrel.createMockHtmlAppHost).toBe("function")
        expect(driveBarrel.BRIDGE_VERSION).toBe(1)
        expect(driveBarrel.AGENT_APPS_FLAG).toBe("agent-apps")
    })
})

const minimal = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({agenta_app: 1, name: "Board", ...overrides})

describe("parseManifest", () => {
    it("returns null for bad JSON or a non-object", () => {
        expect(parseManifest("{not json")).toBeNull()
        expect(parseManifest("")).toBeNull()
        expect(parseManifest("42")).toBeNull()
        expect(parseManifest("null")).toBeNull()
        expect(parseManifest("[1, 2]")).toBeNull()
    })

    it("returns null unless agenta_app === 1", () => {
        expect(parseManifest(JSON.stringify({name: "x"}))).toBeNull()
        expect(parseManifest(JSON.stringify({agenta_app: 2, name: "x"}))).toBeNull()
        expect(parseManifest(JSON.stringify({agenta_app: "1", name: "x"}))).toBeNull()
        expect(parseManifest(JSON.stringify({agenta_app: true, name: "x"}))).toBeNull()
    })

    it("returns null without a name", () => {
        expect(parseManifest(JSON.stringify({agenta_app: 1}))).toBeNull()
        expect(parseManifest(JSON.stringify({agenta_app: 1, name: ""}))).toBeNull()
        expect(parseManifest(JSON.stringify({agenta_app: 1, name: 7}))).toBeNull()
    })

    it("applies the defaults for a minimal manifest", () => {
        expect(parseManifest(minimal())).toEqual({
            agenta_app: 1,
            name: "Board",
            entry: APP_DEFAULT_ENTRY,
            access: "read",
            kit: true,
        })
        expect(APP_DEFAULT_ENTRY).toBe("index.html")
    })

    it("keeps a flat entry and rejects one that leaves the folder", () => {
        expect(parseManifest(minimal({entry: "main.html"}))?.entry).toBe("main.html")
        expect(parseManifest(minimal({entry: "sub/index.html"}))).toBeNull()
        expect(parseManifest(minimal({entry: "../index.html"}))).toBeNull()
        expect(parseManifest(minimal({entry: "..index.html"}))).toBeNull()
        expect(parseManifest(minimal({entry: "/index.html"}))).toBeNull()
        expect(parseManifest(minimal({entry: ""}))).toBeNull()
        expect(parseManifest(minimal({entry: 3}))).toBeNull()
    })

    it("falls back to read when access is missing or invalid", () => {
        expect(parseManifest(minimal())?.access).toBe("read")
        expect(parseManifest(minimal({access: "read-write"}))?.access).toBe("read-write")
        expect(parseManifest(minimal({access: "write"}))?.access).toBe("read")
        expect(parseManifest(minimal({access: "admin"}))?.access).toBe("read")
        expect(parseManifest(minimal({access: true}))?.access).toBe("read")
    })

    it("defaults kit to true and honours an explicit boolean only", () => {
        expect(parseManifest(minimal())?.kit).toBe(true)
        expect(parseManifest(minimal({kit: false}))?.kit).toBe(false)
        expect(parseManifest(minimal({kit: "no"}))?.kit).toBe(true)
    })

    it("keeps data and tools only when they are string arrays", () => {
        const good = parseManifest(minimal({data: ["cards.json"], tools: ["drive.read"]}))
        expect(good?.data).toEqual(["cards.json"])
        expect(good?.tools).toEqual(["drive.read"])

        const mixed = parseManifest(minimal({data: ["a.json", 1], tools: "drive.read"}))
        expect(mixed?.data).toBeUndefined()
        expect(mixed?.tools).toBeUndefined()

        expect(parseManifest(minimal({data: {}}))?.data).toBeUndefined()
    })

    it("keeps refresh only as {prompt: string}", () => {
        expect(parseManifest(minimal({refresh: {prompt: "Refresh the board"}}))?.refresh).toEqual({
            prompt: "Refresh the board",
        })
        expect(parseManifest(minimal({refresh: {prompt: 1}}))?.refresh).toBeUndefined()
        expect(parseManifest(minimal({refresh: "Refresh"}))?.refresh).toBeUndefined()
        expect(parseManifest(minimal({refresh: {}}))?.refresh).toBeUndefined()
        expect(parseManifest(minimal({refresh: {prompt: "p", extra: 1}}))?.refresh).toEqual({
            prompt: "p",
        })
    })

    it("keeps icon, config and template (including null)", () => {
        const parsed = parseManifest(
            minimal({icon: "📋", config: "config.json", template: "board@1"}),
        )
        expect(parsed?.icon).toBe("📋")
        expect(parsed?.config).toBe("config.json")
        expect(parsed?.template).toBe("board@1")
        expect(parseManifest(minimal({template: null}))?.template).toBeNull()
        expect(parseManifest(minimal({template: 4}))?.template).toBeUndefined()
        expect(parseManifest(minimal({icon: 1, config: false}))).toMatchObject({
            agenta_app: 1,
            name: "Board",
        })
        expect(parseManifest(minimal({icon: 1}))?.icon).toBeUndefined()
    })

    it("preserves unknown top-level fields in extra", () => {
        const parsed = parseManifest(minimal({author: "agent", version: 3, nested: {a: 1}}))
        expect(parsed?.extra).toEqual({author: "agent", version: 3, nested: {a: 1}})
        expect(parseManifest(minimal())?.extra).toBeUndefined()
    })

    it("does not leak known keys into extra", () => {
        const parsed = parseManifest(minimal({entry: "index.html", kit: false, data: []}))
        expect(parsed?.extra).toBeUndefined()
    })
})

describe("isAppFolderListing", () => {
    it("is true when app.json is a file in the listing", () => {
        expect(isAppFolderListing([{path: APP_MANIFEST_FILENAME, isFolder: false}])).toBe(true)
        expect(
            isAppFolderListing([
                {path: "apps/board/index.html", isFolder: false},
                {path: "apps/board/app.json", isFolder: false},
            ]),
        ).toBe(true)
    })

    it("is false without it, or when app.json is a folder", () => {
        expect(isAppFolderListing([])).toBe(false)
        expect(isAppFolderListing([{path: "index.html", isFolder: false}])).toBe(false)
        expect(isAppFolderListing([{path: "app.json", isFolder: true}])).toBe(false)
        expect(isAppFolderListing([{path: "app.json.bak", isFolder: false}])).toBe(false)
    })
})
