/**
 * The real host against a fake fs client. Part 1 is the SAME behavioural table as
 * `htmlApp.mockHost.test.ts` (minus the mock-only knobs `failWith` / `latencyMs` / `log`), so the
 * mock and the real host provably agree. Part 2 covers what only the real host does: If-Match
 * forwarding, `force`, cache updates from every result, `onWrite`, scope-before-network,
 * `notifyChanged` invalidation, and detach dropping late messages.
 */
import {describe, expect, it, vi} from "vitest"

// The host module pulls in the real fs client, whose transport imports must not touch env/auth.
vi.mock("@agenta/sdk/resources", () => ({getMountsClient: () => ({})}))
vi.mock("@agenta/shared/api", () => ({axios: {}, getAgentaApiUrl: () => "https://api.test"}))
vi.mock("@agenta/entities/session", () => ({projectScopedRequest: () => ({})}))

import {
    FsClientError,
    type FsClient,
    type FsClientResult,
    type FsWriteOptions,
} from "../../src/drive/htmlApp/fsClient"
import {createHtmlAppHost} from "../../src/drive/htmlApp/host"
import {computeEtag} from "../../src/drive/htmlApp/mockHost"
import {
    READ_CAP,
    WRITE_CAP,
    type FileEntry,
    type FsFailure,
    type FsRequest,
    type FsResponse,
    type GrantLevel,
    type Hello,
    type ParentToIframe,
} from "../../src/drive/htmlApp/protocol"

// ---------------------------------------------------------------------------------------------
// Fake transport: a Map of MOUNT-relative paths that behaves like the API with lane B's deltas.
// ---------------------------------------------------------------------------------------------

interface FakeCall {
    method: string
    path: string
    ifMatch?: string | null
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

const fakeClient = (initial: Record<string, string>) => {
    const files = new Map<string, string>(Object.entries(initial))
    const mtimes = new Map<string, number>()
    for (const key of files.keys()) mtimes.set(key, Date.now())
    const calls: FakeCall[] = []

    const record = (method: string, path: string, opts?: FsWriteOptions) => {
        const call: FakeCall = {method, path}
        if (opts && "ifMatch" in opts) call.ifMatch = opts.ifMatch
        calls.push(call)
    }

    const precondition = (path: string, opts?: FsWriteOptions) => {
        if (typeof opts?.ifMatch !== "string") return
        const current = files.get(path)
        const now = current === undefined ? null : computeEtag(current)
        if (now !== opts.ifMatch) {
            throw new FsClientError("conflict", "file changed since it was last read", {
                etag: now,
                status: 412,
            })
        }
    }

    const listFolder = (folder: string): FileEntry[] => {
        const prefix = folder === "" ? "" : `${folder}/`
        const seen = new Set<string>()
        const out: FileEntry[] = []
        for (const key of [...files.keys()].sort()) {
            if (!key.startsWith(prefix)) continue
            const rest = key.slice(prefix.length)
            const slash = rest.indexOf("/")
            if (slash === -1) {
                const text = files.get(key) as string
                out.push({
                    path: key,
                    size: byteLength(text),
                    mtime: mtimes.get(key) ?? null,
                    etag: computeEtag(text),
                    isFolder: false,
                })
            } else {
                const name = rest.slice(0, slash)
                if (seen.has(name)) continue
                seen.add(name)
                out.push({
                    path: `${prefix}${name}`,
                    size: 0,
                    mtime: null,
                    etag: null,
                    isFolder: true,
                })
            }
        }
        return out
    }

    const read = async (path: string): Promise<FsClientResult<"read">> => {
        record("read", path)
        const text = files.get(path)
        if (text === undefined) throw new FsClientError("not_found", "no such file")
        if (byteLength(text) > READ_CAP) throw new FsClientError("too_large", "cap")
        return {result: text, etag: computeEtag(text)}
    }

    const write = async (
        path: string,
        body: string,
        opts?: FsWriteOptions,
    ): Promise<FsClientResult<"write">> => {
        record("write", path, opts)
        const size = byteLength(body)
        if (size > WRITE_CAP) throw new FsClientError("too_large", "cap")
        precondition(path, opts)
        files.set(path, body)
        mtimes.set(path, Date.now())
        const etag = computeEtag(body)
        return {result: {path, size, etag}, etag}
    }

    const client: FsClient = {
        read,
        async readJSON(path) {
            const {result, etag} = await read(path)
            try {
                return {result: JSON.parse(result), etag}
            } catch {
                throw new FsClientError("bad_request", "file is not valid JSON")
            }
        },
        write,
        async writeJSON(path, body, opts) {
            try {
                JSON.parse(body)
            } catch {
                throw new FsClientError("bad_request", "body is not valid JSON")
            }
            return write(path, body, opts)
        },
        async list(folder) {
            record("list", folder)
            return {result: listFolder(folder)}
        },
        async exists(path) {
            record("exists", path)
            return {result: files.has(path) || listFolder(path).length > 0}
        },
        async stat(path) {
            record("stat", path)
            const text = files.get(path)
            if (text === undefined) throw new FsClientError("not_found", "no such file")
            const etag = computeEtag(text)
            return {
                result: {path, size: byteLength(text), mtime: mtimes.get(path) ?? null, etag},
                etag,
            }
        },
        async remove(path, opts) {
            record("remove", path, opts)
            if (!files.has(path)) throw new FsClientError("not_found", "no such file")
            precondition(path, opts)
            files.delete(path)
            mtimes.delete(path)
            return {result: {deleted: true}}
        },
    }

    return {
        client,
        files,
        calls,
        /** The agent edits a file underneath the app: content changes, the host's cache does not. */
        externalWrite(path: string, text: string) {
            files.set(path, text)
            mtimes.set(path, Date.now())
        },
    }
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

const DIR = "app"

let nextId = 1
const req = (partial: Omit<FsRequest, "v" | "id"> & {id?: number}): FsRequest => ({
    v: 1,
    id: partial.id ?? nextId++,
    ...partial,
})

const seed = {
    "index.html": "<h1>hi</h1>",
    "app.json": JSON.stringify({agenta_app: 1, name: "Board"}),
    "data/cards.json": JSON.stringify([{id: 1}]),
    "data/notes.txt": "n",
    "data/deep/x.txt": "x",
}

/** Seed keys are app-relative (like the mock); the fake client stores them mount-relative. */
const mounted = (files: Record<string, string>, dir = DIR) => {
    const base = dir.replace(/^\/+|\/+$/g, "")
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [`${base}/${k}`, v]))
}

const make = (
    files: Record<string, string>,
    opts: {
        grant?: GrantLevel
        dir?: string
        tokens?: Record<string, string>
        onWrite?: () => void
    } = {},
) => {
    const dir = opts.dir ?? DIR
    const fake = fakeClient(mounted(files, dir))
    const host = createHtmlAppHost(
        {
            mountId: "m1",
            projectId: "p1",
            dir,
            grant: opts.grant ?? "read",
            tokens: opts.tokens ?? {},
            onWrite: opts.onWrite,
        },
        {client: fake.client},
    )
    const base = dir.replace(/^\/+|\/+$/g, "")
    return {host, fake, full: (rel: string) => `${base}/${rel}`}
}

const rw = () => make(seed, {grant: "read-write"})

const expectFailure = (res: FsResponse | FsFailure, code: string): FsFailure => {
    expect(res.ok).toBe(false)
    const failed = res as FsFailure
    expect(failed.error.code).toBe(code)
    return failed
}

const expectOk = (res: FsResponse | FsFailure): FsResponse => {
    expect(res.ok, JSON.stringify(res)).toBe(true)
    return res as FsResponse
}

// ---------------------------------------------------------------------------------------------
// Part 1 — the mock's behavioural table
// ---------------------------------------------------------------------------------------------

describe("createHtmlAppHost.handle (mock parity)", () => {
    it("echoes the request id", async () => {
        const {host} = rw()
        const res = await host.handle(req({id: 42, method: "exists", path: "index.html"}))
        expect(res.id).toBe(42)
        expect(res.v).toBe(1)
    })

    it("rejects out-of-scope paths on every method", async () => {
        const {host} = rw()
        for (const method of [
            "read",
            "readJSON",
            "write",
            "writeJSON",
            "exists",
            "stat",
            "remove",
        ] as const) {
            expectFailure(await host.handle(req({method, path: "../x", body: "{}"})), "scope")
            expectFailure(await host.handle(req({method, path: "/x", body: "{}"})), "scope")
            expectFailure(await host.handle(req({method, path: "", body: "{}"})), "scope")
            expectFailure(await host.handle(req({method, path: "%2e%2e/x", body: "{}"})), "scope")
        }
        expectFailure(await host.handle(req({method: "list", path: "../"})), "scope")
    })

    it("read returns the text and etag; missing files are not_found", async () => {
        const {host} = rw()
        const res = expectOk(await host.handle(req({method: "read", path: "index.html"})))
        expect(res.result).toBe("<h1>hi</h1>")
        expect(res.etag).toBe(computeEtag("<h1>hi</h1>"))
        expect(host.etags.get("index.html")).toBe(res.etag)

        expectFailure(await host.handle(req({method: "read", path: "nope.txt"})), "not_found")
        expectFailure(await host.handle(req({method: "stat", path: "nope.txt"})), "not_found")
        expectFailure(await host.handle(req({method: "remove", path: "nope.txt"})), "not_found")
    })

    it("readJSON parses, and rejects invalid JSON with bad_request", async () => {
        const {host} = rw()
        const res = expectOk(await host.handle(req({method: "readJSON", path: "data/cards.json"})))
        expect(res.result).toEqual([{id: 1}])
        expectFailure(
            await host.handle(req({method: "readJSON", path: "index.html"})),
            "bad_request",
        )
    })

    it("read of an oversized file is too_large", async () => {
        const {host} = make({"big.txt": "x".repeat(READ_CAP + 1)})
        expectFailure(await host.handle(req({method: "read", path: "big.txt"})), "too_large")
    })

    it("write methods are read_only under the default grant", async () => {
        const {host, fake, full} = make(seed)
        expectFailure(
            await host.handle(req({method: "write", path: "a.txt", body: "a"})),
            "read_only",
        )
        expectFailure(
            await host.handle(req({method: "writeJSON", path: "a.json", body: "{}"})),
            "read_only",
        )
        expectFailure(await host.handle(req({method: "remove", path: "index.html"})), "read_only")
        expect(fake.files.has(full("index.html"))).toBe(true)
        expect(fake.files.has(full("a.txt"))).toBe(false)
        // Grant enforcement happens before the transport is touched.
        expect(fake.calls).toEqual([])
    })

    it("write stores the body and returns {path, size, etag}", async () => {
        const {host, fake, full} = rw()
        const res = expectOk(
            await host.handle(req({method: "write", path: "new.txt", body: "héllo"})),
        )
        expect(res.result).toEqual({path: "new.txt", size: 6, etag: computeEtag("héllo")})
        expect(res.etag).toBe(computeEtag("héllo"))
        expect(fake.files.get(full("new.txt"))).toBe("héllo")
        expect(host.etags.get("new.txt")).toBe(computeEtag("héllo"))
    })

    it("writeJSON validates the body and write requires one", async () => {
        const {host, fake, full} = rw()
        expectFailure(
            await host.handle(req({method: "writeJSON", path: "a.json", body: "{oops"})),
            "bad_request",
        )
        expectFailure(await host.handle(req({method: "write", path: "a.txt"})), "bad_request")
        expectOk(await host.handle(req({method: "writeJSON", path: "a.json", body: '{"a":1}'})))
        expect(fake.files.get(full("a.json"))).toBe('{"a":1}')
    })

    it("write of an oversized body is too_large", async () => {
        const {host, fake, full} = rw()
        expectFailure(
            await host.handle(
                req({method: "write", path: "big.txt", body: "x".repeat(WRITE_CAP + 1)}),
            ),
            "too_large",
        )
        expect(fake.files.has(full("big.txt"))).toBe(false)
    })

    it("a write without a prior read is unconditional", async () => {
        const {host, fake, full} = rw()
        expectOk(await host.handle(req({method: "write", path: "index.html", body: "v2"})))
        expect(fake.files.get(full("index.html"))).toBe("v2")
        expect(fake.calls.at(-1)).toEqual({
            method: "write",
            path: full("index.html"),
            ifMatch: undefined,
        })
    })

    it("externalWrite after a read makes the next write conflict; force bypasses", async () => {
        const {host, fake, full} = rw()
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))

        fake.externalWrite(full("data/notes.txt"), "agent edit")
        const conflict = expectFailure(
            await host.handle(req({method: "write", path: "data/notes.txt", body: "mine"})),
            "conflict",
        )
        expect(conflict.error.etag).toBe(computeEtag("agent edit"))
        expect(fake.files.get(full("data/notes.txt"))).toBe("agent edit")

        const forced = expectOk(
            await host.handle(
                req({method: "write", path: "data/notes.txt", body: "mine", force: true}),
            ),
        )
        expect(forced.etag).toBe(computeEtag("mine"))
        expect(fake.files.get(full("data/notes.txt"))).toBe("mine")

        // The forced write refreshed the cache, so the next plain write goes through.
        expectOk(await host.handle(req({method: "write", path: "data/notes.txt", body: "again"})))
    })

    it("re-reading after an external change clears the conflict", async () => {
        const {host, fake, full} = rw()
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        fake.externalWrite(full("data/notes.txt"), "agent edit")
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        expectOk(await host.handle(req({method: "write", path: "data/notes.txt", body: "ok"})))
    })

    it("remove honours If-Match too and reports the current etag (null when gone)", async () => {
        const {host, fake, full} = rw()
        expectOk(await host.handle(req({method: "stat", path: "data/notes.txt"})))
        fake.externalWrite(full("data/notes.txt"), "changed")
        const conflict = expectFailure(
            await host.handle(req({method: "remove", path: "data/notes.txt"})),
            "conflict",
        )
        expect(conflict.error.etag).toBe(computeEtag("changed"))

        const removed = expectOk(
            await host.handle(req({method: "remove", path: "data/notes.txt", force: true})),
        )
        expect(removed.result).toEqual({deleted: true})
        expect(fake.files.has(full("data/notes.txt"))).toBe(false)
        expect(host.etags.get("data/notes.txt")).toBeUndefined()

        // A cached etag for a file that vanished underneath the app conflicts with etag null.
        expectOk(await host.handle(req({method: "read", path: "index.html"})))
        fake.files.delete(full("index.html"))
        const gone = expectFailure(
            await host.handle(req({method: "write", path: "index.html", body: "x"})),
            "conflict",
        )
        expect(gone.error.etag).toBeNull()
    })

    it("list returns direct children (app-relative) with folders derived from deeper keys", async () => {
        const {host} = rw()
        const root = expectOk(await host.handle(req({method: "list", path: ""})))
        expect(root.result).toEqual([
            {
                path: "app.json",
                size: seed["app.json"].length,
                mtime: expect.any(Number),
                etag: computeEtag(seed["app.json"]),
                isFolder: false,
            },
            {path: "data", size: 0, mtime: null, etag: null, isFolder: true},
            {
                path: "index.html",
                size: seed["index.html"].length,
                mtime: expect.any(Number),
                etag: computeEtag(seed["index.html"]),
                isFolder: false,
            },
        ])
        // list caches etags for the files it returned.
        expect(host.etags.get("app.json")).toBe(computeEtag(seed["app.json"]))
        expect(host.etags.get("data")).toBeUndefined()

        const data = expectOk(await host.handle(req({method: "list", path: "data/"})))
        expect((data.result as {path: string}[]).map((e) => e.path)).toEqual([
            "data/cards.json",
            "data/deep",
            "data/notes.txt",
        ])

        const empty = expectOk(await host.handle(req({method: "list", path: "nothing"})))
        expect(empty.result).toEqual([])
    })

    it("stat returns a FileStat and exists covers files and folders", async () => {
        const {host} = rw()
        const stat = expectOk(await host.handle(req({method: "stat", path: "data/cards.json"})))
        expect(stat.result).toEqual({
            path: "data/cards.json",
            size: 10,
            mtime: expect.any(Number),
            etag: computeEtag(seed["data/cards.json"]),
        })
        expect(stat.etag).toBe(computeEtag(seed["data/cards.json"]))

        expect(
            expectOk(await host.handle(req({method: "exists", path: "index.html"}))).result,
        ).toBe(true)
        expect(expectOk(await host.handle(req({method: "exists", path: "data"}))).result).toBe(true)
        expect(expectOk(await host.handle(req({method: "exists", path: "zzz"}))).result).toBe(false)
    })

    it("reports bridge failures through onError and stops after unsubscribe", async () => {
        const {host} = make(seed)
        const seen: string[] = []
        const off = host.onError((e) => seen.push(`${e.kind}:${e.method}:${e.path}`))
        await host.handle(req({method: "read", path: "missing.txt"}))
        off()
        await host.handle(req({method: "read", path: "missing.txt"}))
        expect(seen).toEqual(["bridge:read:missing.txt"])
    })
})

// ---------------------------------------------------------------------------------------------
// Part 2 — real-host specifics
// ---------------------------------------------------------------------------------------------

describe("createHtmlAppHost.handle (transport contract)", () => {
    it("resolves the app dir into mount-relative paths for the client", async () => {
        const {host, fake} = make(seed, {dir: "/apps/board/", grant: "read-write"})
        expectOk(await host.handle(req({method: "read", path: "data/cards.json"})))
        expectOk(await host.handle(req({method: "list", path: ""})))
        expectOk(await host.handle(req({method: "write", path: "new.txt", body: "x"})))
        expect(fake.calls.map((c) => [c.method, c.path])).toEqual([
            ["read", "apps/board/data/cards.json"],
            ["list", "apps/board"],
            ["write", "apps/board/new.txt"],
        ])
    })

    it("a scope failure never reaches the transport", async () => {
        const {host, fake} = rw()
        expectFailure(await host.handle(req({method: "read", path: "../secret"})), "scope")
        expectFailure(await host.handle(req({method: "write", path: "/x", body: "a"})), "scope")
        expect(fake.calls).toEqual([])
    })

    it("forwards the cached etag as If-Match on write and remove, and none on force", async () => {
        const {host, fake, full} = rw()
        const etag = computeEtag(seed["data/notes.txt"])
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        expectOk(await host.handle(req({method: "write", path: "data/notes.txt", body: "v2"})))
        expect(fake.calls.at(-1)).toEqual({
            method: "write",
            path: full("data/notes.txt"),
            ifMatch: etag,
        })

        // The write's own result refreshed the cache: the next write carries the new etag.
        expectOk(await host.handle(req({method: "remove", path: "data/notes.txt"})))
        expect(fake.calls.at(-1)).toEqual({
            method: "remove",
            path: full("data/notes.txt"),
            ifMatch: computeEtag("v2"),
        })

        expectOk(await host.handle(req({method: "stat", path: "index.html"})))
        expectOk(
            await host.handle(req({method: "write", path: "index.html", body: "f", force: true})),
        )
        expect(fake.calls.at(-1)).toEqual({
            method: "write",
            path: full("index.html"),
            ifMatch: undefined,
        })
    })

    it("maps a client conflict onto the failure with the server's etag", async () => {
        const {host, fake, full} = rw()
        expectOk(await host.handle(req({method: "read", path: "index.html"})))
        fake.externalWrite(full("index.html"), "theirs")
        const failed = expectFailure(
            await host.handle(req({method: "writeJSON", path: "index.html", body: "{}"})),
            "conflict",
        )
        expect(failed.error.etag).toBe(computeEtag("theirs"))
        // The cache is left alone on conflict: a re-read is what clears it.
        expect(host.etags.get("index.html")).toBe(computeEtag(seed["index.html"]))
    })

    it("a non-bridge transport failure is unavailable", async () => {
        const {host, fake} = rw()
        fake.client.read = async () => {
            throw new Error("socket hang up")
        }
        const failed = expectFailure(
            await host.handle(req({method: "read", path: "index.html"})),
            "unavailable",
        )
        expect(failed.error.message).toBe("socket hang up")
    })

    it("a write result without an etag forgets the cached one (server has not shipped etags)", async () => {
        const {host, fake} = rw()
        expectOk(await host.handle(req({method: "read", path: "index.html"})))
        expect(host.etags.get("index.html")).toBeDefined()
        fake.client.write = async (path, body) => ({
            result: {path, size: body.length},
        })
        expectOk(await host.handle(req({method: "write", path: "index.html", body: "v2"})))
        expect(host.etags.get("index.html")).toBeUndefined()
    })

    it("fires onWrite after write/writeJSON/remove succeed, never on failure or reads", async () => {
        const onWrite = vi.fn()
        const {host} = make(seed, {grant: "read-write", onWrite})
        await host.handle(req({method: "read", path: "index.html"}))
        await host.handle(req({method: "list", path: ""}))
        expect(onWrite).not.toHaveBeenCalled()
        await host.handle(req({method: "write", path: "a.txt", body: "a"}))
        await host.handle(req({method: "writeJSON", path: "a.json", body: "{}"}))
        await host.handle(req({method: "remove", path: "a.txt"}))
        expect(onWrite).toHaveBeenCalledTimes(3)
        await host.handle(req({method: "remove", path: "a.txt"})) // not_found
        await host.handle(req({method: "writeJSON", path: "b.json", body: "{oops"}))
        expect(onWrite).toHaveBeenCalledTimes(3)
    })

    it("notifyChanged keeps the cached etag, so an un-merged write conflicts", async () => {
        const {host, fake, full} = rw()
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        fake.externalWrite(full("data/notes.txt"), "agent")
        const seen: string[][] = []
        const off = host.onChanged?.((paths) => seen.push(paths))
        host.notifyChanged(["data/notes.txt"])
        off?.()
        host.notifyChanged(["data/notes.txt"])
        expect(seen).toEqual([["data/notes.txt"]])
        expect(host.etags.get("data/notes.txt")).toBeDefined()
        expectFailure(
            await host.handle(req({method: "write", path: "data/notes.txt", body: "mine"})),
            "conflict",
        )
        expect(fake.calls.at(-1)?.ifMatch).toBeDefined()
    })
})

// ---------------------------------------------------------------------------------------------
// Part 3 — the MessageChannel path
// ---------------------------------------------------------------------------------------------

describe("createHtmlAppHost.attach", () => {
    /** A stand-in iframe: captures the hello and hands back the transferred port. */
    const fakeIframe = () => {
        let hello: Hello | null = null
        let port: MessagePort | null = null
        const iframe = {
            contentWindow: {
                postMessage(msg: Hello, _origin: string, transfer: MessagePort[]) {
                    hello = msg
                    port = transfer[0]
                },
            },
        } as unknown as HTMLIFrameElement
        return {
            iframe,
            get hello() {
                return hello
            },
            get port() {
                return port
            },
        }
    }

    const nextMessage = (port: MessagePort) =>
        new Promise<ParentToIframe>((resolve) => {
            port.onmessage = (event: MessageEvent) => resolve(event.data as ParentToIframe)
        })

    const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

    it("sends hello with the port, serves requests over it, and forwards nav/error", async () => {
        const {host} = make(seed, {
            grant: "read-write",
            dir: "apps/board",
            tokens: {"--ag-bg": "#fff"},
        })
        const fake = fakeIframe()
        host.attach(fake.iframe)
        expect(host.attached).toBe(true)
        expect(fake.hello).toEqual({
            v: 1,
            type: "hello",
            dir: "apps/board",
            canWrite: true,
            visible: true,
            tokens: {"--ag-bg": "#fff"},
        })
        const port = fake.port as MessagePort

        const navs: string[] = []
        const errors: string[] = []
        host.onNav((href) => navs.push(href))
        host.onError((e) => errors.push(`${e.kind}:${e.message}`))

        const reply = nextMessage(port)
        port.postMessage({v: 1, id: 7, method: "read", path: "index.html"})
        const res = (await reply) as FsResponse
        expect(res).toMatchObject({v: 1, id: 7, ok: true, result: "<h1>hi</h1>"})

        port.postMessage({v: 1, type: "nav", href: "https://example.com"})
        port.postMessage({v: 1, type: "error", message: "boom", line: 3})
        port.postMessage({v: 1, type: "hello-ack"})
        port.postMessage({junk: true})
        await settle()
        expect(navs).toEqual(["https://example.com"])
        expect(errors).toEqual(["script:boom"])

        const visibility = nextMessage(port)
        host.setVisible(false)
        expect(await visibility).toEqual({v: 1, type: "visibility", visible: false})

        const theme = nextMessage(port)
        host.setTheme({"--ag-bg": "#000"})
        expect(await theme).toEqual({v: 1, type: "theme", tokens: {"--ag-bg": "#000"}})

        const notified = nextMessage(port)
        host.notifyChanged(["a.txt", "b.txt"])
        expect(await notified).toEqual({v: 1, type: "changed", paths: ["a.txt", "b.txt"]})

        host.detach()
        expect(host.attached).toBe(false)
        port.close()
    })

    it("hello reports canWrite=false and the initial visibility under a read grant", () => {
        const host = createHtmlAppHost(
            {mountId: "m", projectId: "p", dir: "d", grant: "read", tokens: {}, visible: false},
            {client: fakeClient({}).client},
        )
        const fake = fakeIframe()
        host.attach(fake.iframe)
        expect(fake.hello).toMatchObject({canWrite: false, visible: false, dir: "d"})
        host.detach()
        fake.port?.close()
    })

    it("flushes changes queued while detached right after hello", async () => {
        const {host} = make(seed)
        host.notifyChanged(["data/notes.txt"])
        const fake = fakeIframe()
        host.attach(fake.iframe)
        const port = fake.port as MessagePort
        const first = await nextMessage(port)
        expect(first).toEqual({v: 1, type: "changed", paths: ["data/notes.txt"]})
        host.detach()
        port.close()
    })

    it("ignores window messages: only the port is served", async () => {
        const {host, fake: transport} = rw()
        const fake = fakeIframe()
        host.attach(fake.iframe)
        // A hostile page posting to the parent window must not reach the host.
        if (typeof window !== "undefined") {
            window.postMessage({v: 1, id: 1, method: "read", path: "index.html"}, "*")
        }
        await settle()
        expect(transport.calls).toEqual([])
        host.detach()
        fake.port?.close()
    })

    it("after detach, late messages do nothing and no reply is sent", async () => {
        const {host, fake: transport} = rw()
        const fake = fakeIframe()
        host.attach(fake.iframe)
        const port = fake.port as MessagePort
        const replies: unknown[] = []
        port.onmessage = (event: MessageEvent) => replies.push(event.data)

        host.detach()
        port.postMessage({v: 1, id: 9, method: "read", path: "index.html"})
        port.postMessage({v: 1, type: "nav", href: "x.html"})
        await settle()
        expect(transport.calls).toEqual([])
        expect(replies).toEqual([])
        port.close()
    })

    it("a reply for a request in flight at detach time is dropped, not posted to a dead port", async () => {
        const {host, fake: transport} = rw()
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => {
            release = resolve
        })
        const realRead = transport.client.read
        transport.client.read = async (path) => {
            await gate
            return realRead(path)
        }
        const fake = fakeIframe()
        host.attach(fake.iframe)
        const port = fake.port as MessagePort
        const replies: unknown[] = []
        port.onmessage = (event: MessageEvent) => replies.push(event.data)
        port.postMessage({v: 1, id: 1, method: "read", path: "index.html"})
        await settle()
        host.detach()
        release()
        await settle()
        expect(replies).toEqual([])
        port.close()
    })

    it("re-attaching sends a fresh hello on a fresh port and retires the old one", async () => {
        const {host} = rw()
        const first = fakeIframe()
        host.attach(first.iframe)
        const oldPort = first.port as MessagePort
        const second = fakeIframe()
        host.attach(second.iframe)
        const newPort = second.port as MessagePort
        expect(newPort).not.toBe(oldPort)

        const stale: unknown[] = []
        oldPort.onmessage = (event: MessageEvent) => stale.push(event.data)
        const reply = nextMessage(newPort)
        newPort.postMessage({v: 1, id: 3, method: "exists", path: "index.html"})
        expect(await reply).toMatchObject({id: 3, ok: true, result: true})
        oldPort.postMessage({v: 1, id: 4, method: "exists", path: "index.html"})
        await settle()
        expect(stale).toEqual([])
        host.detach()
        oldPort.close()
        newPort.close()
    })
})
