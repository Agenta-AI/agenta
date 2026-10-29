import {describe, expect, it} from "vitest"

import {
    isScopeFailure,
    joinAppPath,
    normalizeAppDir,
    resolveScoped,
    toAppRelative,
} from "../../src/drive/htmlApp/scope"

const DIR = "apps/board"

describe("resolveScoped", () => {
    it("joins an ordinary relative path onto the app dir", () => {
        expect(resolveScoped(DIR, "data/cards.json")).toBe("apps/board/data/cards.json")
        expect(resolveScoped(DIR, "index.html")).toBe("apps/board/index.html")
        expect(resolveScoped(DIR, "data/")).toBe("apps/board/data")
    })

    it("tolerates slashes around the dir and a root dir", () => {
        expect(resolveScoped("/apps/board/", "a.txt")).toBe("apps/board/a.txt")
        expect(resolveScoped("", "a.txt")).toBe("a.txt")
    })

    it("accepts unicode and spaces in names", () => {
        expect(resolveScoped(DIR, "données/été.json")).toBe("apps/board/données/été.json")
        expect(resolveScoped(DIR, "my notes.txt")).toBe("apps/board/my notes.txt")
        expect(resolveScoped(DIR, "日本語/ファイル.md")).toBe("apps/board/日本語/ファイル.md")
    })

    it("rejects every traversal and malformed shape with a scope failure", () => {
        const table = [
            "",
            "/",
            "/etc/passwd",
            "/apps/board/a.txt",
            ".",
            "..",
            "../x",
            "a/../..",
            "a/../b",
            "a/./b",
            "a//b",
            "%2e%2e/x",
            "a/%2E%2E/b",
            "%2e",
            "%2f..%2fx",
            "%zz",
            "a\\b",
            "..\\x",
            "a\x00b",
            "a\nb",
            "a\x7fb",
        ]
        for (const bad of table) {
            const res = resolveScoped(DIR, bad)
            expect(isScopeFailure(res), JSON.stringify(bad)).toBe(true)
            expect((res as {code: string}).code).toBe("scope")
        }
    })

    it("allows the empty path only for list (allowRoot) and maps it to the dir itself", () => {
        expect(resolveScoped(DIR, "", {allowRoot: true})).toBe("apps/board")
        expect(resolveScoped("", "", {allowRoot: true})).toBe("")
        expect(isScopeFailure(resolveScoped(DIR, ""))).toBe(true)
        expect(isScopeFailure(resolveScoped(DIR, "/", {allowRoot: true}))).toBe(true)
    })

    it("never lets a resolved path leave the dir", () => {
        const probes = ["../../secrets", "..%2fsecrets", "%2e%2e%2fsecrets", "a/../../secrets"]
        for (const probe of probes) {
            const res = resolveScoped(DIR, probe)
            if (typeof res === "string") expect(res.startsWith(`${DIR}/`)).toBe(true)
            else expect(res.code).toBe("scope")
        }
    })
})

describe("path helpers", () => {
    it("normalizeAppDir strips surrounding slashes", () => {
        expect(normalizeAppDir("/a/b/")).toBe("a/b")
        expect(normalizeAppDir("a")).toBe("a")
        expect(normalizeAppDir("///")).toBe("")
    })

    it("trims long slash runs without backtracking or changing interior slashes", () => {
        const slashes = "/".repeat(100_000)
        expect(normalizeAppDir(slashes)).toBe("")
        expect(normalizeAppDir(`${slashes}apps/board${slashes}`)).toBe("apps/board")
        expect(normalizeAppDir(`a${slashes}b`)).toBe(`a${slashes}b`)
        expect(normalizeAppDir("")).toBe("")
    })

    it("joinAppPath handles the root dir and the root path", () => {
        expect(joinAppPath("", "x")).toBe("x")
        expect(joinAppPath("d", "")).toBe("d")
        expect(joinAppPath("d/", "x/y")).toBe("d/x/y")
    })

    it("toAppRelative inverts the join and rejects paths outside the dir", () => {
        expect(toAppRelative(DIR, "apps/board/data/x.json")).toBe("data/x.json")
        expect(toAppRelative(DIR, "/apps/board/x")).toBe("x")
        expect(toAppRelative(DIR, "apps/board")).toBe("")
        expect(toAppRelative(DIR, "apps/boardroom/x")).toBeNull()
        expect(toAppRelative(DIR, "other/x")).toBeNull()
        expect(toAppRelative("", "any/where")).toBe("any/where")
    })
})
