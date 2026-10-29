/**
 * `remoteHref` and `parseRemote` used patterns CodeQL flagged as polynomial ReDoS
 * (js/polynomial-redos): `\/+(.+)$` and `\/+$` let two quantifiers compete for the same run of
 * slashes, and `^url\s*=\s*(.+)$` let two whitespace runs compete with the value. The rewrites are
 * character walks and non-overlapping patterns. These tests pin both halves of the claim — the
 * accepted input and the results are unchanged, and the new code is linear.
 */
import {describe, expect, it} from "vitest"

import {parseRemote, remoteHref, sanitizeRemoteUrl} from "../../src/drive/driveRepo"

/** `remoteHref` as it was before the rewrite. */
const legacyRemoteHref = (url: string): string | null => {
    const clean = sanitizeRemoteUrl(url).trim()
    if (!clean) return null
    let host: string
    let path: string
    const scheme = clean.match(
        /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/\s]*@)?([^:/\s]+)(?::\d+)?\/+(.+)$/i,
    )
    if (scheme) {
        if (!["http", "https", "ssh", "git"].includes(scheme[1].toLowerCase())) return null
        host = scheme[2]
        path = scheme[3]
    } else {
        const scp = clean.match(/^[^@/\s]+@([^:/\s]+):(.+)$/)
        if (!scp) return null
        host = scp[1]
        path = scp[2]
    }
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host)) return null
    const rel = path
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
    if (!rel || /\s/.test(rel)) return null
    return `https://${host}/${rel}`
}

const URLS = [
    // Browsable.
    "https://github.com/agenta-ai/agenta.git",
    "https://github.com/agenta-ai/agenta",
    "http://gitlab.example.com/group/sub/repo.git",
    "http://gitlab.example.com:8080/group/sub/repo.git",
    "ssh://git@github.com/owner/repo.git",
    "git://github.com/owner/repo.git",
    "https://token@github.com/owner/repo.git",
    "https://user:pass@github.com/owner/repo",
    "git@github.com:owner/repo.git",
    "HTTPS://GitHub.com/Owner/Repo.git",
    // Slash shapes: the strip order matters.
    "https://github.com//owner//repo.git",
    "https://github.com/owner/repo.git/",
    "https://github.com/owner/repo.git//",
    "https://github.com////",
    "https://github.com/",
    "https://github.com",
    // Not browsable.
    "file:///home/me/repo",
    "javascript://github.com/x",
    "/home/me/repo",
    "https://localhost/owner/repo",
    "https://server:path",
    "C:/Users/me/repo",
    "git@localhost:owner/repo.git",
    "https://github.com:notaport/owner/repo",
    "https://@github.com/owner/repo",
    "https://github.com/owner/ repo",
    "https://github.com/owner/repo\nx",
    "",
    "   ",
    // The shape CodeQL named, at a length the old pattern still handles quickly.
    `https://github.com/${"/".repeat(40)}\nx`,
    `a://!/${"//".repeat(40)}`,
]

describe("remoteHref", () => {
    it("returns exactly what the patterns it replaced returned", () => {
        for (const url of URLS) {
            expect({url, href: remoteHref(url)}).toEqual({url, href: legacyRemoteHref(url)})
        }
        // The table is not vacuous: most of its first half resolves to a link.
        expect(URLS.filter((url) => remoteHref(url) !== null).length).toBeGreaterThan(8)
    })

    it("still links the two forms a clone writes", () => {
        expect(remoteHref("https://github.com/agenta-ai/agenta.git")).toBe(
            "https://github.com/agenta-ai/agenta",
        )
        expect(remoteHref("git@github.com:agenta-ai/agenta.git")).toBe(
            "https://github.com/agenta-ai/agenta",
        )
    })

    it("stays linear on a path made of slashes", () => {
        // The witness for `\/+$`: a long run of slashes that is not at the end, so the old
        // pattern retried from every one of them. Measured quadratic: 129ms at 20k slashes,
        // 604ms at 40k.
        const pathological = `https://github.com/a${"/".repeat(40_000)}b`

        const started = performance.now()
        const result = remoteHref(pathological)
        const elapsed = performance.now() - started

        expect(result).toBe(`https://github.com/a${"/".repeat(40_000)}b`)
        expect(elapsed).toBeLessThan(100)
    })

    it("stays linear on the input the old patterns backtracked on", () => {
        // The witness for `\/+(.+)$`: a URL of repeated slashes that cannot match, because a
        // newline sits where the pattern needed the end of the string. Measured quadratic on the
        // old pattern: 1.6ms at 2000 slashes, 6.3ms at 4000.
        const pathological = `https://github.com/${"/".repeat(40_000)}\nx`

        const started = performance.now()
        const result = remoteHref(pathological)
        const elapsed = performance.now() - started

        expect(result).toBeNull()
        expect(elapsed).toBeLessThan(100)
    })
})

/** The `url = ...` line matcher as it was before the rewrite. */
const legacyParseRemoteUrls = (cfg: string): {first: string | null; origin: string | null} => {
    let section: string | null = null
    let originUrl: string | null = null
    let firstUrl: string | null = null
    for (const raw of cfg.split("\n")) {
        const line = raw.trim()
        const sec = line.match(/^\[(.+?)\]$/)
        if (sec) {
            section = sec[1].trim()
            continue
        }
        const m = line.match(/^url\s*=\s*(.+)$/)
        if (m) {
            const url = m[1].trim()
            if (!firstUrl) firstUrl = url
            if (section && /^remote\s+"origin"$/.test(section)) originUrl = url
        }
    }
    return {first: firstUrl, origin: originUrl}
}

const CONFIGS = [
    '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n\tfetch = +refs/heads/*',
    '[remote "upstream"]\n\turl=https://github.com/other/repo.git',
    '[remote "upstream"]\n\turl = https://github.com/other/repo.git\n[remote "origin"]\n\turl = git@github.com:owner/repo.git',
    "[core]\n\turlfoo = https://github.com/owner/repo.git",
    "[core]\n\tnoturl = https://github.com/owner/repo.git",
    '[remote "origin"]\n\turl =',
    '[remote "origin"]\n\turl',
    '[remote "origin"]\n\turl   =   https://github.com/owner/repo.git',
    "",
    // The shape CodeQL named, at a length the old pattern still handles quickly.
    `[remote "origin"]\n\turl=${" ".repeat(40)}`,
    `[remote "origin"]\n\turl=${" ".repeat(40)}x`,
]

describe("parseRemote", () => {
    it("reads the same url lines the pattern it replaced read", () => {
        for (const cfg of CONFIGS) {
            const legacy = legacyParseRemoteUrls(cfg)
            const expectedUrl = legacy.origin ?? legacy.first
            const expected = expectedUrl
                ? {
                      url: sanitizeRemoteUrl(expectedUrl),
                      href: remoteHref(expectedUrl),
                  }
                : null
            const actual = parseRemote(cfg)
            expect({
                cfg,
                remote: actual ? {url: actual.url, href: actual.href} : null,
            }).toEqual({cfg, remote: expected})
        }
    })

    it("prefers origin and strips credentials", () => {
        const remote = parseRemote(
            '[remote "origin"]\n\turl = https://ghp_secret@github.com/owner/repo.git',
        )
        expect(remote).toEqual({
            url: "https://github.com/owner/repo.git",
            label: "github.com/owner/repo",
            href: "https://github.com/owner/repo",
        })
    })

    it("stays linear on a url line padded with whitespace", () => {
        const cfg = `[remote "origin"]\n\turl${" ".repeat(20_000)}= https://github.com/owner/repo.git`

        const started = performance.now()
        const remote = parseRemote(cfg)
        const elapsed = performance.now() - started

        expect(remote?.href).toBe("https://github.com/owner/repo")
        expect(elapsed).toBeLessThan(100)
    })
})
