/**
 * A shared app's snapshot: references resolve only through the server's `refs`, and the file
 * bridge reads from the snapshot and refuses every write.
 */
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => ({}),
    getSharedAppsClient: () => ({}),
}))
vi.mock("@agenta/entities/session", () => ({projectScopedRequest: () => ({})}))

import {FsClientError} from "../../src/drive/htmlApp/fsClient"
import {
    createSnapshotFsClient,
    resolveSnapshotRef,
    snapshotDataUri,
    snapshotFile,
    type SnapshotFile,
} from "../../src/drive/htmlApp/share"

const file = (text: string, contentType = "text/plain"): SnapshotFile => ({
    contentType,
    bytes: new TextEncoder().encode(text),
    base64: btoa(text),
})

const snapshot = {
    files: new Map([
        ["index.html", file("<h1>x</h1>", "text/html")],
        ["data/items.json", file('{"n":1}', "application/json")],
    ]),
    external: new Map([["https://cdn/a.css", file(".a{}", "text/css")]]),
    refs: {
        "file:index.html": {"https://cdn/a.css": {url: "https://cdn/a.css"}, "d.json": {file: "data/items.json"}},
        "url:https://cdn/a.css": {"f.woff2": {url: "https://cdn/f.woff2"}},
    },
}

describe("resolveSnapshotRef", () => {
    it("answers from the refs of the file the reference is written in", () => {
        expect(resolveSnapshotRef(snapshot, "index.html", "d.json")).toBe("data/items.json")
        expect(resolveSnapshotRef(snapshot, "https://cdn/a.css", "f.woff2")).toBe("https://cdn/f.woff2")
    })

    it("drops a reference the server did not record", () => {
        expect(resolveSnapshotRef(snapshot, "index.html", "https://tracker/x.gif")).toBeNull()
    })
})

describe("snapshot files", () => {
    it("serves app files and captured URLs by key", () => {
        expect(snapshotFile(snapshot, "https://cdn/a.css")?.contentType).toBe("text/css")
        expect(snapshotDataUri(snapshot.files.get("index.html") as SnapshotFile)).toBe(
            `data:text/html;base64,${btoa("<h1>x</h1>")}`,
        )
    })
})

describe("createSnapshotFsClient", () => {
    const client = createSnapshotFsClient(snapshot)

    it("reads and lists from the snapshot", async () => {
        expect((await client.readJSON("data/items.json")).result).toEqual({n: 1})
        expect((await client.list("")).result.map((e) => [e.path, e.isFolder])).toEqual([
            ["data", true],
            ["index.html", false],
        ])
        expect((await client.exists("data")).result).toBe(true)
    })

    it("refuses every write as read_only", async () => {
        for (const call of [
            () => client.write("index.html", "x"),
            () => client.writeJSON("data/items.json", "{}"),
            () => client.remove("index.html"),
        ]) {
            await expect(call()).rejects.toMatchObject({code: "read_only"})
        }
    })

    it("reports a missing file as not_found", async () => {
        await expect(client.read("nope.txt")).rejects.toBeInstanceOf(FsClientError)
    })
})
