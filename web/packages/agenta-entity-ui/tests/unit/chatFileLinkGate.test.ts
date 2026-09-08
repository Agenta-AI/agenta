/** The respelling that gets a bare relative link target past the harden gate (#6659). */
import {describe, expect, it} from "vitest"

import {
    decodeDriveHref,
    explicitRelativeHref,
    isExternalHref,
    rehypeExplicitRelativeLinks,
    withExplicitRelativeLinks,
} from "../../src/drive/chatFileLinkGate"

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
        expect(decodeDriveHref("/agent-files/my report.md".replace(" ", "%20"))).toBe(
            "/agent-files/my report.md",
        )
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
