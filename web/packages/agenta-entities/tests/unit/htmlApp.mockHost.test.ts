import {describe, expect, it} from "vitest"

import {
    computeEtag,
    createMockHtmlAppHost,
    normalizeAppPath,
    READ_CAP,
    WRITE_CAP,
    type FsFailure,
    type FsRequest,
    type FsResponse,
    type Hello,
    type ParentToIframe,
} from "../../src/drive/htmlApp"

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

const rw = () => createMockHtmlAppHost(seed, {grant: "read-write"})

const expectFailure = (res: FsResponse | FsFailure, code: string): FsFailure => {
    expect(res.ok).toBe(false)
    const failed = res as FsFailure
    expect(failed.error.code).toBe(code)
    return failed
}

const expectOk = (res: FsResponse | FsFailure): FsResponse => {
    expect(res.ok).toBe(true)
    return res as FsResponse
}

describe("normalizeAppPath", () => {
    it("accepts ordinary relative paths and strips a trailing slash", () => {
        expect(normalizeAppPath("data/cards.json")).toBe("data/cards.json")
        expect(normalizeAppPath("data/")).toBe("data")
        expect(normalizeAppPath("a b.txt")).toBe("a b.txt")
    })

    it("rejects absolute, empty, dot segments, backslashes, control chars, encoded dots", () => {
        for (const bad of [
            "",
            "/",
            "/etc/passwd",
            ".",
            "..",
            "../x",
            "a/../b",
            "a/./b",
            "a//b",
            "a\\b",
            "a\x00b",
            "a\nb",
            "%2e%2e/x",
            "a/%2E%2E/b",
            "%2e",
            "%zz",
        ]) {
            expect(normalizeAppPath(bad), bad).toBeNull()
        }
    })

    it("allows the root only when asked", () => {
        expect(normalizeAppPath("", {allowRoot: true})).toBe("")
        expect(normalizeAppPath("/", {allowRoot: true})).toBeNull()
    })
})

describe("createMockHtmlAppHost.handle", () => {
    it("echoes the request id and logs it", async () => {
        const host = rw()
        const res = await host.handle(req({id: 42, method: "exists", path: "index.html"}))
        expect(res.id).toBe(42)
        expect(res.v).toBe(1)
        expect(host.log).toHaveLength(1)
        expect(host.log[0].id).toBe(42)
    })

    it("rejects out-of-scope paths on every method", async () => {
        const host = rw()
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
        const host = rw()
        const res = expectOk(await host.handle(req({method: "read", path: "index.html"})))
        expect(res.result).toBe("<h1>hi</h1>")
        expect(res.etag).toBe(computeEtag("<h1>hi</h1>"))
        expect(host.etags.get("index.html")).toBe(res.etag)

        expectFailure(await host.handle(req({method: "read", path: "nope.txt"})), "not_found")
        expectFailure(await host.handle(req({method: "stat", path: "nope.txt"})), "not_found")
        expectFailure(await host.handle(req({method: "remove", path: "nope.txt"})), "not_found")
    })

    it("readJSON parses, and rejects invalid JSON with bad_request", async () => {
        const host = rw()
        const res = expectOk(await host.handle(req({method: "readJSON", path: "data/cards.json"})))
        expect(res.result).toEqual([{id: 1}])
        expectFailure(
            await host.handle(req({method: "readJSON", path: "index.html"})),
            "bad_request",
        )
    })

    it("read of an oversized file is too_large", async () => {
        const host = createMockHtmlAppHost({"big.txt": "x".repeat(READ_CAP + 1)})
        expectFailure(await host.handle(req({method: "read", path: "big.txt"})), "too_large")
    })

    it("write methods are read_only under the default grant", async () => {
        const host = createMockHtmlAppHost(seed)
        expectFailure(
            await host.handle(req({method: "write", path: "a.txt", body: "a"})),
            "read_only",
        )
        expectFailure(
            await host.handle(req({method: "writeJSON", path: "a.json", body: "{}"})),
            "read_only",
        )
        expectFailure(await host.handle(req({method: "remove", path: "index.html"})), "read_only")
        expect(host.files.has("index.html")).toBe(true)
        expect(host.files.has("a.txt")).toBe(false)
    })

    it("write stores the body and returns {path, size, etag}", async () => {
        const host = rw()
        const res = expectOk(
            await host.handle(req({method: "write", path: "new.txt", body: "héllo"})),
        )
        expect(res.result).toEqual({path: "new.txt", size: 6, etag: computeEtag("héllo")})
        expect(res.etag).toBe(computeEtag("héllo"))
        expect(host.files.get("new.txt")).toBe("héllo")
        expect(host.etags.get("new.txt")).toBe(computeEtag("héllo"))
    })

    it("writeJSON validates the body and write requires one", async () => {
        const host = rw()
        expectFailure(
            await host.handle(req({method: "writeJSON", path: "a.json", body: "{oops"})),
            "bad_request",
        )
        expectFailure(await host.handle(req({method: "write", path: "a.txt"})), "bad_request")
        expectOk(await host.handle(req({method: "writeJSON", path: "a.json", body: '{"a":1}'})))
        expect(host.files.get("a.json")).toBe('{"a":1}')
    })

    it("write of an oversized body is too_large", async () => {
        const host = rw()
        expectFailure(
            await host.handle(
                req({method: "write", path: "big.txt", body: "x".repeat(WRITE_CAP + 1)}),
            ),
            "too_large",
        )
        expect(host.files.has("big.txt")).toBe(false)
    })

    it("a write without a prior read is unconditional", async () => {
        const host = rw()
        expectOk(await host.handle(req({method: "write", path: "index.html", body: "v2"})))
        expect(host.files.get("index.html")).toBe("v2")
    })

    it("externalWrite reports changed unless silent; both leave the cached etag alone", async () => {
        const host = rw()
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        const seen: string[][] = []
        const off = host.onChanged?.((paths) => seen.push(paths))

        host.externalWrite("data/notes.txt", "announced")
        host.externalWrite("data/notes.txt", "quiet", {silent: true})
        expect(seen).toEqual([["data/notes.txt"]])
        expect(host.files.get("data/notes.txt")).toBe("quiet")
        expect(host.etags.get("data/notes.txt")).toBe(computeEtag("n"))
        expectFailure(
            await host.handle(req({method: "write", path: "data/notes.txt", body: "mine"})),
            "conflict",
        )

        off?.()
        host.externalWrite("data/notes.txt", "after off")
        expect(seen).toHaveLength(1)
    })

    it("emitNav and emitError reach the subscribers the port would", () => {
        const host = rw()
        const navs: string[] = []
        const errors: string[] = []
        const offNav = host.onNav((href) => navs.push(href))
        host.onError((e) => errors.push(`${e.kind}:${e.message}`))

        host.emitNav("guide.html")
        host.emitError({kind: "script", message: "boom", line: 3})
        offNav()
        host.emitNav("ignored.html")

        expect(navs).toEqual(["guide.html"])
        expect(errors).toEqual(["script:boom"])
    })

    it("externalWrite after a read makes the next write conflict; force bypasses", async () => {
        const host = rw()
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))

        host.externalWrite("data/notes.txt", "agent edit")
        const conflict = expectFailure(
            await host.handle(req({method: "write", path: "data/notes.txt", body: "mine"})),
            "conflict",
        )
        expect(conflict.error.etag).toBe(computeEtag("agent edit"))
        expect(host.files.get("data/notes.txt")).toBe("agent edit")

        const forced = expectOk(
            await host.handle(
                req({method: "write", path: "data/notes.txt", body: "mine", force: true}),
            ),
        )
        expect(forced.etag).toBe(computeEtag("mine"))
        expect(host.files.get("data/notes.txt")).toBe("mine")

        // The forced write refreshed the cache, so the next plain write goes through.
        expectOk(await host.handle(req({method: "write", path: "data/notes.txt", body: "again"})))
    })

    it("re-reading after an external change clears the conflict", async () => {
        const host = rw()
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        host.externalWrite("data/notes.txt", "agent edit")
        expectOk(await host.handle(req({method: "read", path: "data/notes.txt"})))
        expectOk(await host.handle(req({method: "write", path: "data/notes.txt", body: "ok"})))
    })

    it("remove honours If-Match too and reports the current etag (null when gone)", async () => {
        const host = rw()
        expectOk(await host.handle(req({method: "stat", path: "data/notes.txt"})))
        host.externalWrite("data/notes.txt", "changed")
        const conflict = expectFailure(
            await host.handle(req({method: "remove", path: "data/notes.txt"})),
            "conflict",
        )
        expect(conflict.error.etag).toBe(computeEtag("changed"))

        const removed = expectOk(
            await host.handle(req({method: "remove", path: "data/notes.txt", force: true})),
        )
        expect(removed.result).toEqual({deleted: true})
        expect(host.files.has("data/notes.txt")).toBe(false)
        expect(host.etags.has("data/notes.txt")).toBe(false)

        // A cached etag for a file that vanished underneath the app conflicts with etag null.
        expectOk(await host.handle(req({method: "read", path: "index.html"})))
        host.files.delete("index.html")
        const gone = expectFailure(
            await host.handle(req({method: "write", path: "index.html", body: "x"})),
            "conflict",
        )
        expect(gone.error.etag).toBeNull()
    })

    it("list returns direct children with folders derived from deeper keys", async () => {
        const host = rw()
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
        expect(host.etags.has("data")).toBe(false)

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
        const host = rw()
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

    it("failWith forces an error code for a method", async () => {
        const host = createMockHtmlAppHost(seed, {failWith: {read: "unavailable"}})
        expectFailure(await host.handle(req({method: "read", path: "index.html"})), "unavailable")
        expectOk(await host.handle(req({method: "exists", path: "index.html"})))
    })

    it("latencyMs delays the reply", async () => {
        const host = createMockHtmlAppHost(seed, {latencyMs: 20})
        const started = Date.now()
        await host.handle(req({method: "exists", path: "index.html"}))
        expect(Date.now() - started).toBeGreaterThanOrEqual(15)
    })

    it("reports bridge failures through onError and stops after unsubscribe", async () => {
        const host = createMockHtmlAppHost(seed)
        const seen: string[] = []
        const off = host.onError((e) => seen.push(`${e.kind}:${e.method}:${e.path}`))
        await host.handle(req({method: "read", path: "missing.txt"}))
        off()
        await host.handle(req({method: "read", path: "missing.txt"}))
        expect(seen).toEqual(["bridge:read:missing.txt"])
    })
})

describe("createMockHtmlAppHost.attach", () => {
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

    it("sends hello with the port, serves requests over it, and forwards nav/error", async () => {
        const host = createMockHtmlAppHost(seed, {
            grant: "read-write",
            dir: "apps/board",
            tokens: {"--ag-bg": "#fff"},
        })
        const fake = fakeIframe()
        host.attach(fake.iframe)
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
        await new Promise((resolve) => setTimeout(resolve, 10))
        expect(navs).toEqual(["https://example.com"])
        expect(errors).toEqual(["script:boom"])

        const visibility = nextMessage(port)
        host.setVisible(false)
        expect(await visibility).toEqual({v: 1, type: "visibility", visible: false})

        const theme = nextMessage(port)
        host.setTheme({"--ag-bg": "#000"})
        expect(await theme).toEqual({v: 1, type: "theme", tokens: {"--ag-bg": "#000"}})

        const changed = nextMessage(port)
        host.externalWrite("data/notes.txt", "agent")
        expect(await changed).toEqual({v: 1, type: "changed", paths: ["data/notes.txt"]})

        const notified = nextMessage(port)
        host.notifyChanged(["a.txt", "b.txt"])
        expect(await notified).toEqual({v: 1, type: "changed", paths: ["a.txt", "b.txt"]})

        host.detach()
        port.close()
    })

    it("flushes changes queued while detached right after hello", async () => {
        const host = createMockHtmlAppHost(seed)
        host.externalWrite("data/notes.txt", "before attach")
        const fake = fakeIframe()
        host.attach(fake.iframe)
        const port = fake.port as MessagePort
        const first = await nextMessage(port)
        expect(first).toEqual({v: 1, type: "changed", paths: ["data/notes.txt"]})
        host.detach()
        port.close()
    })
})
