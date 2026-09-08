/** The respelling that gets a bare relative link target past the harden gate (#6659). */
import {describe, expect, it} from "vitest"

import {
    decodeDriveHref,
    explicitRelativeHref,
    isExternalHref,
    isProtocolRelativeHref,
    rehypeExplicitRelativeLinks,
    withExplicitRelativeLinks,
} from "../../src/drive/chatFileLinkGate"
import {fileCandidate} from "../../src/drive/chatFileRefs"

describe("explicitRelativeHref", () => {
    it("respells the working-directory-relative path the platform prompt prescribes", () => {
        expect(explicitRelativeHref("agent-files/report.md")).toBe("./agent-files/report.md")
    })

    it("respells a bare filename", () => {
        expect(explicitRelativeHref("report.md")).toBe("./report.md")
    })

    it("leaves a path harden already parses alone", () => {
        expect(explicitRelativeHref("/tmp/agenta/report.md")).toBeNull()
        expect(explicitRelativeHref("./agent-files/report.md")).toBeNull()
        expect(explicitRelativeHref("../report.md")).toBeNull()
    })

    it("refuses a dot segment that climbs to a host, which would become an off-site link", () => {
        // `./a/..//evil.com/x` has the pathname `//evil.com/x`; a browser reads that as a host.
        expect(explicitRelativeHref("a/..//evil.com/x")).toBeNull()
        expect(explicitRelativeHref("a/%2e%2e//evil.com/x")).toBeNull()
        expect(explicitRelativeHref("a/../b/report.md")).toBe("./a/../b/report.md")
    })

    it("leaves every non-path target to the gate", () => {
        expect(explicitRelativeHref("https://example.com/a")).toBeNull()
        expect(explicitRelativeHref("mailto:qa@agenta.ai")).toBeNull()
        expect(explicitRelativeHref("javascript:alert(1)")).toBeNull()
        expect(explicitRelativeHref("file:///tmp/report.md")).toBeNull()
        expect(explicitRelativeHref("//example.com/a")).toBeNull()
        expect(explicitRelativeHref("#section")).toBeNull()
        expect(explicitRelativeHref("")).toBeNull()
    })
})

describe("isExternalHref", () => {
    it("is true for a scheme URL, a protocol-relative host, and a fragment", () => {
        expect(isExternalHref("https://example.com")).toBe(true)
        expect(isExternalHref("MAILTO:qa@agenta.ai")).toBe(true)
        expect(isExternalHref("//example.com")).toBe(true)
        expect(isExternalHref("#section")).toBe(true)
        expect(isExternalHref(undefined)).toBe(true)
    })

    it("is false for a path, which may name a drive file", () => {
        expect(isExternalHref("/agent-files/report.md")).toBe(false)
        expect(isExternalHref("agent-files/report.md")).toBe(false)
    })
})

describe("isProtocolRelativeHref", () => {
    it("refuses the target harden hands back for a dot segment that climbs to a host (#6666)", () => {
        // What the anchor actually receives: harden resolved `..//evil.com/x` to its pathname.
        expect(isProtocolRelativeHref("//evil.com/x")).toBe(true)
        // And the target as written, in case a pipeline change stops resolving it first.
        expect(isProtocolRelativeHref("..//evil.com/x")).toBe(true)
        expect(isProtocolRelativeHref("a/..//evil.com/x")).toBe(true)
        expect(isProtocolRelativeHref(".././/evil.com/x")).toBe(true)
    })

    it("refuses the encoded spellings of the same target", () => {
        expect(isProtocolRelativeHref("%2F%2Fevil.com")).toBe(true)
        expect(isProtocolRelativeHref("%2f%2fevil.com")).toBe(true)
        expect(isProtocolRelativeHref("%252F%252Fevil.com")).toBe(true)
        expect(isProtocolRelativeHref("/%2F%2Fevil.com")).toBe(true)
    })

    it("refuses the backslash spellings a browser reads as slashes", () => {
        expect(isProtocolRelativeHref("\\\\evil.com")).toBe(true)
        expect(isProtocolRelativeHref("/\\evil.com")).toBe(true)
        expect(isProtocolRelativeHref("\\/evil.com")).toBe(true)
        expect(isProtocolRelativeHref("/%5Cevil.com")).toBe(true)
        expect(isProtocolRelativeHref("%5C%5Cevil.com")).toBe(true)
    })

    it("refuses a target hidden behind the whitespace a browser strips", () => {
        expect(isProtocolRelativeHref("  //evil.com/x")).toBe(true)
        expect(isProtocolRelativeHref("\n//evil.com/x")).toBe(true)
        expect(isProtocolRelativeHref("\t\\\\evil.com")).toBe(true)
        expect(isProtocolRelativeHref("\u0000//evil.com/x")).toBe(true)
    })

    it("does not care how the host is cased", () => {
        expect(isProtocolRelativeHref("//EVIL.com/x")).toBe(true)
        expect(isProtocolRelativeHref("%2F%2FEVIL.com")).toBe(true)
    })

    it("lets an ordinary web link through, double slashes in its path included", () => {
        expect(isProtocolRelativeHref("https://example.com")).toBe(false)
        expect(isProtocolRelativeHref("https://example.com//deep/path")).toBe(false)
        expect(isProtocolRelativeHref("HTTPS://example.com")).toBe(false)
        expect(isProtocolRelativeHref("mailto:qa@agenta.ai")).toBe(false)
    })

    it("lets every file path through", () => {
        expect(isProtocolRelativeHref("agent-files/report.md")).toBe(false)
        expect(isProtocolRelativeHref("/agent-files/report.md")).toBe(false)
        expect(isProtocolRelativeHref("./agent-files/report.md")).toBe(false)
        expect(isProtocolRelativeHref("../report.md")).toBe(false)
        expect(isProtocolRelativeHref("/tmp/agenta/mounts/p/m/agent-files/report.md")).toBe(false)
        expect(isProtocolRelativeHref("/agent-files/my%20report.md")).toBe(false)
        expect(isProtocolRelativeHref("/a//b/report.md")).toBe(false)
        expect(isProtocolRelativeHref("#section")).toBe(false)
    })

    it("survives a malformed escape and a missing href instead of throwing", () => {
        expect(isProtocolRelativeHref("/agent-files/100%.md")).toBe(false)
        expect(isProtocolRelativeHref("%")).toBe(false)
        expect(isProtocolRelativeHref("")).toBe(false)
        expect(isProtocolRelativeHref(undefined)).toBe(false)
        expect(isProtocolRelativeHref(null)).toBe(false)
    })
})

describe("fileCandidate", () => {
    it("refuses a mention that names a host, so the resolver never treats it as a file (#6666)", () => {
        expect(fileCandidate("//evil.com/x")).toBeNull()
        expect(fileCandidate("\\\\evil.com")).toBeNull()
        expect(fileCandidate("%2F%2Fevil.com")).toBeNull()
    })

    it("still accepts an ordinary file mention", () => {
        expect(fileCandidate("agent-files/report.md")).toBe("agent-files/report.md")
        expect(fileCandidate("./report.md")).toBe("report.md")
        expect(fileCandidate("/tmp/agenta/report.md")).toBe("/tmp/agenta/report.md")
    })
})

const anchor = (href: unknown) => ({
    type: "element",
    tagName: "a",
    properties: {href},
    children: [{type: "text", value: "report.md"}],
})

describe("rehypeExplicitRelativeLinks", () => {
    it("rewrites a nested anchor and leaves the rest of the tree intact", () => {
        const bare = anchor("agent-files/report.md")
        const web = anchor("https://example.com/a")
        const tree = {
            type: "root",
            children: [{type: "element", tagName: "p", properties: {}, children: [bare, web]}],
        }
        rehypeExplicitRelativeLinks()(tree)
        expect(bare.properties.href).toBe("./agent-files/report.md")
        expect(web.properties.href).toBe("https://example.com/a")
    })

    it("ignores an element that is not an anchor, and an anchor with no string href", () => {
        const img = {
            type: "element",
            tagName: "img",
            properties: {src: "agent-files/shot.png"},
            children: [],
        }
        const hrefless = anchor(undefined)
        const tree = {type: "root", children: [img, hrefless]}
        expect(() => rehypeExplicitRelativeLinks()(tree)).not.toThrow()
        expect(img.properties.src).toBe("agent-files/shot.png")
        expect(hrefless.properties.href).toBeUndefined()
    })
})

describe("decodeDriveHref", () => {
    it("undoes the percent-encoding harden's URL round-trip adds", () => {
        expect(decodeDriveHref("/agent-files/my%20report.md")).toBe("/agent-files/my report.md")
    })

    it("returns a malformed escape unchanged rather than throwing", () => {
        expect(decodeDriveHref("/agent-files/100%.md")).toBe("/agent-files/100%.md")
    })
})

describe("withExplicitRelativeLinks", () => {
    it("keeps every default and puts the respelling immediately before harden", () => {
        const defaults = {raw: "raw", sanitize: "sanitize", harden: "harden"}
        expect(withExplicitRelativeLinks(defaults)).toEqual([
            "raw",
            "sanitize",
            rehypeExplicitRelativeLinks,
            "harden",
        ])
    })

    it("carries a default this code has never heard of", () => {
        // Hand-listing the keys dropped any plugin Streamdown adds later.
        const defaults = {raw: "raw", sanitize: "sanitize", harden: "harden", future: "future"}
        expect(withExplicitRelativeLinks(defaults)).toContain("future")
    })
})
