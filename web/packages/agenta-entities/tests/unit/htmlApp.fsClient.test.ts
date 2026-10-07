/**
 * The eight fs operations against a mocked transport. Every call now goes through the Fern mounts
 * client, write included: the endpoint declares its body in the spec, so there is no hand-built
 * URL left here. Asserts the arguments each generated method receives, If-Match present/absent,
 * result mapping and the HTTP → bridge error mapping.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const fern = vi.hoisted(() => ({
    getMountFiles: vi.fn(),
    deleteMountFile: vi.fn(),
    writeMountFile: vi.fn(),
}))

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => fern,
}))

vi.mock("@agenta/entities/session", () => ({
    getMountsClient: () => fern,
    projectScopedRequest: (projectId: string) => ({queryParams: {project_id: projectId}}),
}))

import {createFsClient, FsClientError, toFsClientError} from "../../src/drive/htmlApp/fsClient"
import {READ_CAP, WRITE_CAP} from "../../src/drive/htmlApp/protocol"

const client = () => createFsClient({mountId: "m1", projectId: "p1"})

/** What Fern throws on a non-2xx: an `AgentaApiError` with `statusCode` and the parsed `body`. */
const fernError = (statusCode: number, body?: unknown) =>
    Object.assign(new Error(`Status code: ${statusCode}`), {statusCode, body})

/** What axios throws: an error carrying `response.status` and `response.data`. */
const axiosError = (status: number, data?: unknown) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
        response: {status, data},
    })

const expectCode = async (promise: Promise<unknown>, code: string): Promise<FsClientError> => {
    let caught: unknown
    try {
        await promise
    } catch (error) {
        caught = error
    }
    expect(caught).toBeInstanceOf(FsClientError)
    expect((caught as FsClientError).code).toBe(code)
    return caught as FsClientError
}

beforeEach(() => {
    fern.getMountFiles.mockReset()
    fern.deleteMountFile.mockReset()
    fern.writeMountFile.mockReset()
})

describe("read / readJSON", () => {
    it("reads through Fern with ?read=<path> and returns content + etag", async () => {
        fern.getMountFiles.mockResolvedValueOnce({
            path: "apps/b/data.json",
            content: '{"a":1}',
            etag: "e1",
        })
        const res = await client().read("apps/b/data.json")
        expect(res).toEqual({result: '{"a":1}', etag: "e1"})
        expect(fern.getMountFiles).toHaveBeenCalledWith(
            {mount_id: "m1", read: "apps/b/data.json"},
            {queryParams: {project_id: "p1"}, headers: {}},
        )
    })

    it("etag is null when the server does not send one yet", async () => {
        fern.getMountFiles.mockResolvedValueOnce({path: "x", content: "hi"})
        expect(await client().read("x")).toEqual({result: "hi", etag: null})
    })

    it("readJSON parses, and rejects a non-JSON file with bad_request", async () => {
        fern.getMountFiles.mockResolvedValueOnce({content: '[{"id":1}]', etag: "e"})
        expect(await client().readJSON("x")).toEqual({result: [{id: 1}], etag: "e"})
        fern.getMountFiles.mockResolvedValueOnce({content: "<h1>", etag: "e"})
        await expectCode(client().readJSON("x"), "bad_request")
    })

    it("refuses a read whose content exceeds READ_CAP", async () => {
        fern.getMountFiles.mockResolvedValueOnce({content: "x".repeat(READ_CAP + 1)})
        await expectCode(client().read("big"), "too_large")
    })

    it("an unexpected response shape is unavailable, not a crash", async () => {
        fern.getMountFiles.mockResolvedValueOnce({nope: true})
        await expectCode(client().read("x"), "unavailable")
    })
})

describe("list / exists / stat", () => {
    const listing = {
        files: [
            {path: "apps/b/app.json", size: 12, is_folder: false, mtime: 1700, etag: "ea"},
            {path: "apps/b/data/", size: 0, is_folder: true, mtime: null, etag: null},
            {path: "apps/b/index.html", size: 5, is_folder: false, mtime: 1701, etag: "ei"},
        ],
    }

    it("lists one level (depth 1) and maps entries to FileEntry", async () => {
        fern.getMountFiles.mockResolvedValueOnce(listing)
        const res = await client().list("apps/b")
        expect(fern.getMountFiles).toHaveBeenCalledWith(
            {mount_id: "m1", path: "apps/b", depth: 1},
            {queryParams: {project_id: "p1"}, headers: {}},
        )
        expect(res.result).toEqual([
            {path: "apps/b/app.json", size: 12, mtime: 1700, etag: "ea", isFolder: false},
            {path: "apps/b/data", size: 0, mtime: null, etag: null, isFolder: true},
            {path: "apps/b/index.html", size: 5, mtime: 1701, etag: "ei", isFolder: false},
        ])
    })

    it("lists the mount root with no path param, and a missing folder as empty", async () => {
        fern.getMountFiles.mockResolvedValueOnce({files: []})
        await client().list("")
        expect(fern.getMountFiles.mock.calls[0][0]).toEqual({
            mount_id: "m1",
            path: undefined,
            depth: 1,
        })
        fern.getMountFiles.mockRejectedValueOnce(fernError(404))
        expect((await client().list("apps/nothing")).result).toEqual([])
    })

    it("exists lists the parent and covers files and folders", async () => {
        fern.getMountFiles.mockResolvedValue(listing)
        expect((await client().exists("apps/b/index.html")).result).toBe(true)
        expect((await client().exists("apps/b/data")).result).toBe(true)
        expect((await client().exists("apps/b/zzz")).result).toBe(false)
        expect(fern.getMountFiles).toHaveBeenLastCalledWith(
            {mount_id: "m1", path: "apps/b", depth: 1},
            expect.anything(),
        )
    })

    it("stat returns the file's FileStat + etag; folders and missing files are not_found", async () => {
        fern.getMountFiles.mockResolvedValue(listing)
        expect(await client().stat("apps/b/app.json")).toEqual({
            result: {path: "apps/b/app.json", size: 12, mtime: 1700, etag: "ea"},
            etag: "ea",
        })
        await expectCode(client().stat("apps/b/data"), "not_found")
        await expectCode(client().stat("apps/b/nope"), "not_found")
    })
})

describe("write / writeJSON", () => {
    it("writes through the generated client, path unencoded in the typed field", async () => {
        // The path is a typed request field now: no hand-built URL, so no manual encoding to get
        // wrong — the generated client owns it.
        fern.writeMountFile.mockResolvedValueOnce({path: "apps/b/a b.txt", size: 6, etag: "e2"})
        const res = await client().write("apps/b/a b.txt", "héllo")
        expect(fern.writeMountFile).toHaveBeenCalledTimes(1)
        const [uploadable, mountId, request, options] = fern.writeMountFile.mock.calls[0]
        expect(uploadable).toBeInstanceOf(Blob)
        expect(await (uploadable as Blob).text()).toBe("héllo")
        expect(mountId).toBe("m1")
        expect(request).toEqual({path: "apps/b/a b.txt"})
        expect(options.queryParams).toEqual({project_id: "p1"})
        expect(res).toEqual({result: {path: "apps/b/a b.txt", size: 6, etag: "e2"}, etag: "e2"})
    })

    it("sends If-Match when the host resolved one", async () => {
        fern.writeMountFile.mockResolvedValueOnce({path: "x", size: 1, etag: "e3"})
        await client().write("x", "a", {ifMatch: "e1"})
        expect(fern.writeMountFile.mock.calls[0][3].headers).toEqual({"If-Match": "e1"})
    })

    it("sends no If-Match when the host has none", async () => {
        fern.writeMountFile.mockResolvedValueOnce({path: "x", size: 1, etag: "e3"})
        await client().write("x", "a")
        expect(fern.writeMountFile.mock.calls[0][3].headers).toEqual({})
    })

    // A first write used to go out unconditional, so two Run sessions could both create the same
    // path and the later one overwrote the earlier without a 412.
    it("sends If-None-Match: * for a create-only write", async () => {
        fern.writeMountFile.mockResolvedValueOnce({path: "x", size: 1, etag: "e3"})
        await client().write("x", "a", {ifNoneMatch: true})
        expect(fern.writeMountFile.mock.calls[0][3].headers).toEqual({"If-None-Match": "*"})
    })

    it("prefers If-Match over create-only when it holds an etag", async () => {
        fern.writeMountFile.mockResolvedValueOnce({path: "x", size: 1, etag: "e3"})
        await client().write("x", "a", {ifMatch: "e1", ifNoneMatch: true})
        expect(fern.writeMountFile.mock.calls[0][3].headers).toEqual({"If-Match": "e1"})
    })

    it("fills in path/size locally when the server omits them (pre-lane-B)", async () => {
        fern.writeMountFile.mockResolvedValueOnce({})
        expect(await client().write("x", "héllo")).toEqual({
            result: {path: "x", size: 6, etag: null},
            etag: null,
        })
    })

    it("refuses a body over WRITE_CAP before any request", async () => {
        await expectCode(client().write("x", "x".repeat(WRITE_CAP + 1)), "too_large")
        expect(fern.writeMountFile).not.toHaveBeenCalled()
    })

    it("writeJSON validates the body before sending", async () => {
        await expectCode(client().writeJSON("x", "{oops"), "bad_request")
        expect(fern.writeMountFile).not.toHaveBeenCalled()
        fern.writeMountFile.mockResolvedValueOnce({path: "x", size: 7, etag: "e"})
        await client().writeJSON("x", '{"a":1}', {ifMatch: "old"})
        expect(await (fern.writeMountFile.mock.calls[0][0] as Blob).text()).toBe('{"a":1}')
        expect(fern.writeMountFile.mock.calls[0][3].headers["If-Match"]).toBe("old")
    })

    it("maps a 412 to conflict with the server's etag", async () => {
        fern.writeMountFile.mockRejectedValueOnce(
            fernError(412, {detail: {code: "conflict", etag: "server-etag"}}),
        )
        const err = await expectCode(client().write("x", "a", {ifMatch: "stale"}), "conflict")
        expect(err.etag).toBe("server-etag")
        expect(err.status).toBe(412)
    })
})

describe("remove", () => {
    it("deletes through Fern with If-Match as the typed request field", async () => {
        fern.deleteMountFile.mockResolvedValueOnce({deleted: true})
        const res = await client().remove("apps/b/x.txt", {ifMatch: "e1"})
        expect(res).toEqual({result: {deleted: true}})
        expect(fern.deleteMountFile).toHaveBeenCalledWith(
            {mount_id: "m1", path: "apps/b/x.txt", "if-match": "e1"},
            {queryParams: {project_id: "p1"}, headers: {}},
        )
    })

    it("sends no If-Match header when none was resolved (force / never read)", async () => {
        fern.deleteMountFile.mockResolvedValueOnce({deleted: true})
        await client().remove("x")
        expect(fern.deleteMountFile.mock.calls[0][0]).toEqual({mount_id: "m1", path: "x"})
        expect(fern.deleteMountFile.mock.calls[0][1]).toEqual({
            queryParams: {project_id: "p1"},
            headers: {},
        })
    })

    it("maps a 412 on delete to conflict with etag null when the file is gone", async () => {
        fern.deleteMountFile.mockRejectedValueOnce(
            fernError(412, {detail: {code: "conflict", etag: null}}),
        )
        const err = await expectCode(client().remove("x", {ifMatch: "e1"}), "conflict")
        expect(err.etag).toBeNull()
    })
})

describe("error mapping", () => {
    // The server refuses a path outside the folder and a write above the level with the same
    // status. Only the body separates them, and mapping every 403 to `read_only` named the wrong
    // cause for the one that matters — the SERVER-side folder boundary.
    it("tells a scope refusal apart from a read-only one, on the same status", async () => {
        const scoped = {detail: {code: "scope", message: "path is outside the app folder"}}
        expect(toFsClientError(fernError(403, scoped)).code).toBe("scope")
        expect(toFsClientError(axiosError(403, scoped)).code).toBe("scope")
        // A level refusal carries no scope code, and still reads as read-only.
        expect(toFsClientError(fernError(403, {detail: {code: "forbidden"}})).code).toBe(
            "read_only",
        )
        expect(toFsClientError(fernError(403)).code).toBe("read_only")
    })

    it.each([
        [404, "not_found"],
        [412, "conflict"],
        [413, "too_large"],
        [403, "read_only"],
        [500, "unavailable"],
        [401, "unavailable"],
    ])("HTTP %s → %s for Fern and axios errors alike", async (status, code) => {
        expect(toFsClientError(fernError(status)).code).toBe(code)
        expect(toFsClientError(axiosError(status)).code).toBe(code)
        fern.getMountFiles.mockRejectedValueOnce(fernError(status))
        await expectCode(client().read("x"), code)
        fern.writeMountFile.mockRejectedValueOnce(fernError(status))
        await expectCode(client().write("x", "a"), code)
    })

    it("a network failure with no status is unavailable and keeps the message", () => {
        const err = toFsClientError(new Error("Network Error"))
        expect(err.code).toBe("unavailable")
        expect(err.message).toBe("Network Error")
        expect(err.status).toBeUndefined()
    })

    it("a 412 without a detail body still reports conflict with etag null", () => {
        const err = toFsClientError(fernError(412, "Precondition Failed"))
        expect(err.code).toBe("conflict")
        expect(err.etag).toBeNull()
    })

    it("an FsClientError passes through unchanged", () => {
        const original = new FsClientError("too_large", "cap")
        expect(toFsClientError(original)).toBe(original)
    })
})
